/**
 * Real A11y MCP server.
 *
 * Exposes the semantic accessibility tree — and, more importantly, the audit
 * results — to AI agents over the Model Context Protocol.
 *
 * Design: audit-first. The `audit_page` tool is the reason this server exists;
 * the `get_*` tools are perception primitives that also let it stand alone
 * without a separate browser-automation MCP.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ALL_RULES } from "@real-a11y-dev/audit";
import type { A11yRule, Finding } from "@real-a11y-dev/audit";
import type { A11ySession, PageSnapshot } from "@real-a11y-dev/browser";
import {
  assertFullArtifact,
  buildArtifact,
  buildSnapshotPage,
  fingerprintFindings,
  parseSnapshotArtifact,
  projectSnapshot,
  serializeArtifact,
  SnapshotFormatError,
} from "@real-a11y-dev/snapshot";
import { z } from "zod";

import {
  CheckpointStore,
  diffCheckpointPages,
  diffLabeledCheckpoints,
  renderDiff,
} from "./checkpoints.js";

export { BrowserSession } from "@real-a11y-dev/browser";
export type {
  A11ySession,
  BrowserSessionOptions,
  PageSnapshot,
  SnapshotOptions,
} from "@real-a11y-dev/browser";

// Built from testing's ALL_RULES so the tool schema can never drift from the
// rules the engine actually runs (a hand-maintained copy dropped `image-alt`).
const RULES = ALL_RULES as unknown as [A11yRule, ...A11yRule[]];

/** This package's version, read at runtime — never hand-maintained in code. */
function packageVersion(): string {
  try {
    const p = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "package.json",
    );
    return (JSON.parse(readFileSync(p, "utf8")).version as string) ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const rootSelector = z
  .string()
  .default("body")
  .describe("CSS selector for the audit/extraction root. Defaults to 'body'.");

/** Cap oversized tool output so a huge page can't blow the agent's context. */
const MAX_OUTPUT_CHARS = 40_000;
function bounded(body: string): string {
  if (body.length <= MAX_OUTPUT_CHARS) return body;
  return (
    body.slice(0, MAX_OUTPUT_CHARS) +
    `\n\n… output truncated at ${MAX_OUTPUT_CHARS} chars — narrow with rootSelector.`
  );
}

function text(body: string) {
  return { content: [{ type: "text" as const, text: bounded(body) }] };
}

const SEVERITY_ORDER: Record<Finding["severity"], number> = {
  error: 0,
  warning: 1,
};
const MAX_LOCATORS = 8;

/**
 * Render findings as a compact agent-readable report plus a JSON block.
 * Identical findings (same severity/rule/message) are grouped with a count and
 * their per-instance locators, so "17 unlabeled links" is one row, not 17.
 */
export function renderAudit(findings: Finding[]): string {
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.length - errors;
  if (findings.length === 0) return "No accessibility issues found.";

  const header = `${findings.length} issue(s) — ${errors} error(s), ${warnings} warning(s):`;

  type Group = {
    severity: Finding["severity"];
    rule: string;
    message: string;
    count: number;
    where: string[];
  };
  const groups = new Map<string, Group>();
  for (const f of findings) {
    const key = `${f.severity}|${f.rule}|${f.message}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        severity: f.severity,
        rule: f.rule,
        message: f.message,
        count: 0,
        where: [],
      };
      groups.set(key, g);
    }
    g.count += 1;
    if (f.locator) {
      g.where.push(f.context ? `${f.locator}  ${f.context}` : f.locator);
    }
  }

  const sorted = [...groups.values()].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      b.count - a.count,
  );

  const lines: string[] = [];
  for (const g of sorted) {
    const countStr = g.count > 1 ? ` (×${g.count})` : "";
    lines.push(`  [${g.severity}] ${g.rule}: ${g.message}${countStr}`);
    for (const w of g.where.slice(0, MAX_LOCATORS)) lines.push(`      ${w}`);
    if (g.where.length > MAX_LOCATORS) {
      lines.push(`      … +${g.where.length - MAX_LOCATORS} more`);
    }
  }

  // Cap the raw findings array so a page with thousands of issues can't blow
  // the agent's context; the grouped human summary above still covers them all.
  const MAX_JSON_FINDINGS = 200;
  const capped = findings.slice(0, MAX_JSON_FINDINGS);
  const json = JSON.stringify(
    {
      summary: {
        total: findings.length,
        errors,
        warnings,
        ...(findings.length > MAX_JSON_FINDINGS
          ? { findingsTruncatedTo: MAX_JSON_FINDINGS }
          : {}),
      },
      findings: capped,
    },
    null,
    2,
  );
  return `${header}\n${lines.join("\n")}\n\n\`\`\`json\n${json}\n\`\`\``;
}

/** Render a single-extraction snapshot: audit + all three views, consistent. */
export function renderSnapshot(snap: PageSnapshot): string {
  const treeNodes = snap.tree.split("\n").filter(Boolean).length;
  const tabStops = snap.tabOrder
    .split("\n")
    .filter((l) => /^\d/.test(l)).length;
  return [
    `Single-extraction snapshot — ${treeNodes} tree nodes, ${tabStops} tab stops. All sections below describe the same instant.`,
    "",
    renderAudit(snap.findings),
    "",
    "## Semantic tree",
    "```",
    snap.tree || "(empty)",
    "```",
    "",
    "## Heading outline",
    "```",
    snap.outline,
    "```",
    "",
    "## Tab order",
    "```",
    snap.tabOrder,
    "```",
  ].join("\n");
}

// Roles where the accessible name is meaningful and well-defined, so a custom
// vs. native disagreement is a real fidelity signal. Pure text/structure roles
// (paragraph, list, generic, StaticText…) are excluded — the two engines
// represent text differently by design, and comparing those is just noise.
const COMPARE_ROLES = new Set([
  // interactive controls
  "button",
  "link",
  "textbox",
  "searchbox",
  "combobox",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "spinbutton",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "tab",
  // named non-interactive
  "heading",
  "img",
  "dialog",
  "alertdialog",
  // landmarks
  "main",
  "navigation",
  "banner",
  "contentinfo",
  "complementary",
  "region",
  "form",
  "search",
]);

const roleOf = (line: string): string => line.trim().split(/[\s"]/)[0];

/**
 * Diff the custom tree against the native (Chromium) tree and report where they
 * disagree on role or accessible name — a fidelity oracle. Compares only
 * name-bearing roles ({@link COMPARE_ROLES}), order- and indent-insensitively,
 * so structural/text representation differences don't drown out real signal.
 */
export function renderCompare(
  customTree: string,
  native: { tree: string; pairs: string[] },
): string {
  // Single literal space (not `\s+`) — the tree serializer always emits exactly
  // one space before "(level N)", and an unbounded `\s+` on audited-page text is
  // a polynomial-ReDoS surface (CodeQL js/polynomial-redos).
  const norm = (l: string) => l.trim().replace(/ \(level \d+\)$/, "");
  const keep = (l: string) => COMPARE_ROLES.has(roleOf(l));
  const customPairs = customTree
    .split("\n")
    .filter(Boolean)
    .map(norm)
    .filter(keep);
  const nativePairs = native.pairs.filter(keep);

  const count = (arr: string[]) => {
    const m = new Map<string, number>();
    for (const s of arr) m.set(s, (m.get(s) ?? 0) + 1);
    return m;
  };
  const cc = count(customPairs);
  const nc = count(nativePairs);
  const onlyIn = (a: Map<string, number>, b: Map<string, number>) => {
    const out: string[] = [];
    for (const [k, n] of a) {
      for (let i = 0; i < n - (b.get(k) ?? 0); i++) out.push(k);
    }
    return out.sort();
  };
  const onlyCustom = onlyIn(cc, nc);
  const onlyNative = onlyIn(nc, cc);
  const total = onlyCustom.length + onlyNative.length;

  if (total === 0) {
    return "Custom and native accessibility trees agree — no role/name divergences.";
  }
  return [
    `Custom vs. native (Chromium) accessibility tree — ${total} divergence(s). These are role/name pairs the two disagree on — a signal of an engine fidelity gap (though some "only in native" entries are iframe / shadow-DOM content the custom engine doesn't traverse, not name bugs). Matching nodes are omitted.`,
    "",
    "Only in the CUSTOM tree (Real A11y engine):",
    ...(onlyCustom.length ? onlyCustom.map((l) => `  ${l}`) : ["  (none)"]),
    "",
    "Only in the NATIVE tree (Chromium):",
    ...(onlyNative.length ? onlyNative.map((l) => `  ${l}`) : ["  (none)"]),
  ].join("\n");
}

/**
 * Build the MCP server and register every tool against the given session.
 * The session is injected so the server can be exercised in tests with a fake
 * (no browser); production wires in a real {@link BrowserSession}.
 */
/** Hints for the read-only query tools (no side effects, closed world). */
const READ_ONLY = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export interface BuildServerOptions {
  /**
   * True when the server was started with a saved login session
   * (`REAL_A11Y_MCP_STORAGE_STATE`). Surfaces the fact to the agent — in
   * `open_page`'s description and result — so it doesn't try to "fix" a page
   * that's already authenticated. A boolean only; the path/contents are never
   * exposed through any tool.
   */
  authenticated?: boolean;
}

export function buildServer(
  session: A11ySession,
  options: BuildServerOptions = {},
): McpServer {
  const authenticated = options.authenticated === true;
  const server = new McpServer(
    {
      name: "real-a11y",
      title: "Real A11y — accessibility audits",
      version: packageVersion(),
    },
    {
      instructions:
        "Audit any web page's accessibility for AI agents. Call open_page(url) FIRST, then use audit_page (violations), inspect_page (findings + tree + outline + tab order from one consistent snapshot — prefer on dynamic pages), or the get_* / list_elements views. All tools share ONE browser page — issue calls sequentially, never in parallel.",
    },
  );

  // ── Checkpoints (Axis-B findings diff) ──────────────────────────────────
  // A named, in-memory store of a11y snapshots. Each is pure data (strings +
  // fingerprinted findings, no DOM references), so checkpoints deliberately
  // SURVIVE navigation — that enables the cross-deploy diff (checkpoint prod →
  // open preview → diff_findings). Only close_browser clears them, as session
  // hygiene. (Contrast Axis-A tree-checkpoints, which are page-instance-bound.)
  const checkpoints = new CheckpointStore();
  // Last-opened URL, recorded on a checkpoint's (cosmetic, redacted) url field.
  let currentUrl = "";
  // Axis-A tree checkpoint: the captured tree lives in the PAGE (node ids are
  // realm-bound). The server only remembers which root it was captured with, so
  // the diff re-extracts like-for-like instead of silently widening to <body>.
  let treeCheckpointRoot: string | undefined;

  // ── Session ────────────────────────────────────────────────────────────
  server.registerTool(
    "open_page",
    {
      title: "Open page",
      description:
        "Navigate the browser to a URL and prepare it for accessibility queries. Call this before any audit/get_* tool. For dynamic sites (SPAs, consent dialogs) set waitUntil='networkidle' and/or settleMs so the page settles first. To audit the MOBILE or TABLET layout — which can differ substantially from desktop (hamburger nav, hidden content, touch-only controls) — pass a `device`." +
        (authenticated
          ? " This server was started with a saved login session, so pages open ALREADY AUTHENTICATED — do not try to log in or navigate to a login page; open the destination directly."
          : ""),
      inputSchema: {
        url: z.string().url().describe("Absolute URL to open."),
        waitUntil: z
          .enum(["load", "domcontentloaded", "networkidle", "commit"])
          .default("load")
          .describe(
            "Navigation wait state. 'networkidle' is the most reliable 'SPA finished rendering' signal (slower).",
          ),
        settleMs: z
          .number()
          .int()
          .min(0)
          .max(15000)
          .default(0)
          .describe(
            "Extra wait (ms) after load for late JS / consent dialogs to settle.",
          ),
        timeoutMs: z
          .number()
          .int()
          .min(0)
          .max(120000)
          .optional()
          .describe("Navigation timeout in ms (default 30000)."),
        device: z
          .string()
          .optional()
          .describe(
            "Emulate a device so the tree reflects the mobile/tablet layout. A Playwright device name, e.g. 'iPhone 13', 'Pixel 7', 'iPad Pro 11'. Omit for desktop.",
          ),
        viewport: z
          .object({
            width: z.number().int().positive(),
            height: z.number().int().positive(),
          })
          .optional()
          .describe(
            "Explicit viewport override, e.g. { width: 375, height: 812 }. Layered on top of `device`.",
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ url, waitUntil, settleMs, timeoutMs, device, viewport }) => {
      const info = await session.open(url, {
        waitUntil,
        settleMs,
        timeoutMs,
        device,
        viewport,
      });
      currentUrl = info.url;
      // Navigation replaces the page bundle, which wipes the in-page tree
      // checkpoint — drop the remembered root so server state stays honest.
      treeCheckpointRoot = undefined;
      const emu = device
        ? ` [${device}]`
        : viewport
          ? ` [${viewport.width}×${viewport.height}]`
          : "";
      return text(
        `Opened ${info.url}${emu}\nTitle: ${info.title || "(untitled)"}` +
          (authenticated
            ? "\n(authenticated session: storage state loaded)"
            : ""),
      );
    },
  );

  server.registerTool(
    "close_browser",
    {
      title: "Close browser",
      description: "Close the browser session and free resources.",
      inputSchema: {},
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      await session.close();
      checkpoints.clear();
      treeCheckpointRoot = undefined;
      return text("Browser session closed.");
    },
  );

  // ── Audit (the differentiator) ───────────────────────────────────────────
  server.registerTool(
    "audit_page",
    {
      title: "Audit accessibility",
      annotations: READ_ONLY,
      description:
        "Run accessibility audits against the current page and return every violation — unlabeled interactive controls, skipped heading levels or missing/duplicate h1, unlabeled dialogs, and broken landmark structure. Reports what real assistive tech would announce as broken. This is the primary tool.",
      inputSchema: {
        rootSelector,
        rules: z
          .array(z.enum(RULES))
          .optional()
          .describe("Subset of rules to run. Omit to run all rules."),
      },
    },
    async ({ rootSelector, rules }) => {
      const findings = await session.call<Finding[]>(
        "collectFindings",
        rootSelector,
        rules && rules.length ? [rules] : [],
      );
      return text(renderAudit(findings));
    },
  );

  server.registerTool(
    "inspect_page",
    {
      title: "Inspect page (single snapshot)",
      annotations: READ_ONLY,
      description:
        "Return the audit findings AND the semantic tree, heading outline, and tab order — all derived from ONE extraction, so they are guaranteed internally consistent. The element focused at capture time is marked `[focused]` in each view. Prefer this over separate audit_page + get_* calls on dynamic pages (SPAs, pages with consent dialogs) where separate calls could catch different states.",
      inputSchema: {
        rootSelector,
        rules: z
          .array(z.enum(RULES))
          .optional()
          .describe("Subset of rules for the findings. Omit to run all."),
        includeGeneric: z
          .boolean()
          .default(false)
          .describe("Include generic container nodes in the tree."),
      },
    },
    async ({ rootSelector, rules, includeGeneric }) => {
      const snap = await session.snapshot(rootSelector, {
        rules,
        includeGeneric,
      });
      return text(renderSnapshot(snap));
    },
  );

  // ── Inspect (perception primitives) ───────────────────────────────────────
  server.registerTool(
    "get_semantic_tree",
    {
      title: "Get semantic tree",
      annotations: READ_ONLY,
      description:
        "Return the page's accessibility tree as a deterministic, indented role + accessible-name outline (what a screen reader would traverse). The element focused at capture time is marked `[focused]`. Token-efficient and stable across runs.",
      inputSchema: {
        rootSelector,
        includeGeneric: z
          .boolean()
          .default(false)
          .describe("Include generic container nodes (role=generic)."),
      },
    },
    async ({ rootSelector, includeGeneric }) => {
      const tree = await session.call<string>("auditSnapshot", rootSelector, [
        { includeGeneric },
      ]);
      return text(tree || "(empty tree)");
    },
  );

  server.registerTool(
    "get_heading_outline",
    {
      title: "Get heading outline",
      annotations: READ_ONLY,
      description:
        "Return the page's heading outline (h1..h6 in document order) as an indented list.",
      inputSchema: { rootSelector },
    },
    async ({ rootSelector }) => {
      const outline = await session.call<string>(
        "outlineSnapshot",
        rootSelector,
      );
      return text(outline);
    },
  );

  server.registerTool(
    "get_tab_order",
    {
      title: "Get tab order",
      annotations: READ_ONLY,
      description:
        "Return the focusable elements in the order a keyboard user encounters them when pressing Tab, numbered, with role + accessible name. The stop focused at capture time is marked `[focused]`.",
      inputSchema: { rootSelector },
    },
    async ({ rootSelector }) => {
      const seq = await session.call<string>(
        "tabSequenceSnapshot",
        rootSelector,
      );
      return text(seq);
    },
  );

  server.registerTool(
    "list_elements",
    {
      title: "List elements by category",
      annotations: READ_ONLY,
      description:
        "List every element of one category — links, buttons, form controls, landmarks, images, or headings — as role + accessible name + a CSS locator. A token-efficient way to review one kind of element (e.g. 'images' pairs with the image-alt rule, 'form' with labeling). Scope with rootSelector.",
      inputSchema: {
        filter: z
          .enum(["heading", "link", "button", "form", "landmark", "image"])
          .describe("Which category of element to list."),
        rootSelector,
      },
    },
    async ({ filter, rootSelector }) => {
      const list = await session.call<string>("listByRole", rootSelector, [
        filter,
      ]);
      return text(list || "(none)");
    },
  );

  // ── Native cross-check (Chromium only) ───────────────────────────────────
  server.registerTool(
    "get_native_tree",
    {
      title: "Get native accessibility tree",
      annotations: READ_ONLY,
      description:
        "Return Chromium's OWN accessibility tree (computed by Blink, read via CDP) as role + accessible name. This is the browser's authoritative tree, not Real A11y's custom extraction. Whole document. Chromium only.",
      inputSchema: {},
    },
    async () => {
      const native = await session.nativeAX();
      return text(native.tree || "(empty)");
    },
  );

  server.registerTool(
    "compare_trees",
    {
      title: "Compare custom vs. native tree",
      annotations: READ_ONLY,
      description:
        "Diff Real A11y's custom accessibility tree against Chromium's native tree and report where they disagree on role or accessible name — a fidelity oracle that surfaces custom-engine bugs (e.g. an unlabeled input the custom engine names by its typed value). Whole document. Chromium only.",
      inputSchema: {},
    },
    async () => {
      const [customTree, native] = await Promise.all([
        // markFocus:false — the native tree has no focus marker, so a `[focused]`
        // suffix would register as a spurious custom-vs-native divergence.
        session.call<string>("auditSnapshot", "body", [{ markFocus: false }]),
        session.nativeAX(),
      ]);
      return text(renderCompare(customTree, native));
    },
  );

  // ── Checkpoints (Axis-B findings diff) ───────────────────────────────────
  const errText = (msg: string) => ({
    content: [{ type: "text" as const, text: msg }],
    isError: true as const,
  });
  const checkpointName = z
    .string()
    .min(1)
    .max(64)
    .describe("Checkpoint label — the in-memory store key.");

  server.registerTool(
    "checkpoint_findings",
    {
      title: "Save a11y checkpoint",
      description:
        "Snapshot the CURRENT page's accessibility findings and store them under `name`. Later call diff_findings to see which findings are new / changed / fixed — the same identity semantics (fingerprints) the CI a11y-diff uses. Checkpoints survive navigation, so you can checkpoint one deploy and diff another: save 'prod', open the preview URL, then diff_findings('prod').",
      inputSchema: {
        name: checkpointName,
        rootSelector,
        rules: z
          .array(z.enum(RULES))
          .optional()
          .describe("Subset of rules for the findings. Omit to run all."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ name, rootSelector, rules }) => {
      const raw = await session.snapshot(rootSelector, { rules });
      const page = buildSnapshotPage(name, currentUrl, projectSnapshot(raw), {
        root: rootSelector,
      });
      checkpoints.save(name, { page, rules });
      const treeKb = (page.tree.length / 1024).toFixed(1);
      return text(
        `"${name}" saved: ${page.findings.length} finding(s) (tree ${treeKb} KB). ${checkpoints.size} checkpoint(s) stored.`,
      );
    },
  );

  server.registerTool(
    "diff_findings",
    {
      title: "Diff current page vs a checkpoint",
      annotations: READ_ONLY,
      description:
        "Re-snapshot the CURRENT page and diff it against the stored checkpoint `name`: which accessibility findings are NEW (these gate CI), CHANGED, or FIXED, plus an advisory structural summary. Use after a change (deploy, feature toggle, DOM edit) or after navigating to a different deploy of the same page.",
      inputSchema: {
        name: checkpointName,
        rootSelector: z
          .string()
          .optional()
          .describe(
            "CSS root for the re-snapshot. Defaults to the root the checkpoint was saved with.",
          ),
      },
    },
    async ({ name, rootSelector }) => {
      const base = checkpoints.get(name);
      if (!base) {
        return errText(
          `No checkpoint named "${name}". Save one first with checkpoint_findings.`,
        );
      }
      // Re-snapshot with the SAME root AND rule set the checkpoint was captured
      // with (unless the caller overrides the root), so findings from a wider
      // scope or from rules the base never ran don't read as spurious NEW.
      const root = rootSelector ?? base.page.root;
      const raw = await session.snapshot(root, { rules: base.rules });
      const head = buildSnapshotPage(name, currentUrl, projectSnapshot(raw), {
        root,
      });
      return text(renderDiff(diffCheckpointPages(base.page, head)));
    },
  );

  server.registerTool(
    "diff_checkpoints",
    {
      title: "Diff two stored checkpoints",
      annotations: READ_ONLY,
      description:
        "Diff two already-stored checkpoints against each other (no re-snapshot): which findings are new / changed / fixed going from `base` to `head`.",
      inputSchema: { base: checkpointName, head: checkpointName },
    },
    async ({ base, head }) => {
      const b = checkpoints.get(base);
      if (!b) return errText(`No checkpoint named "${base}".`);
      const h = checkpoints.get(head);
      if (!h) return errText(`No checkpoint named "${head}".`);
      return text(
        renderDiff(diffLabeledCheckpoints(b.page, h.page), { base, head }),
      );
    },
  );

  server.registerTool(
    "list_checkpoints",
    {
      title: "List checkpoints",
      annotations: READ_ONLY,
      description:
        "List the stored checkpoint labels with their finding counts and approximate tree sizes.",
      inputSchema: {},
    },
    async () => {
      if (checkpoints.size === 0) {
        return text("No checkpoints saved. Use checkpoint_findings first.");
      }
      const lines = checkpoints
        .entries()
        .map(
          ([name, cp]) =>
            `  ${name}: ${cp.page.findings.length} finding(s), tree ${(cp.page.tree.length / 1024).toFixed(1)} KB`,
        );
      return text(`${checkpoints.size} checkpoint(s):\n${lines.join("\n")}`);
    },
  );

  server.registerTool(
    "export_checkpoint",
    {
      title: "Export a checkpoint as JSON",
      annotations: READ_ONLY,
      description:
        "Return a stored checkpoint as a Real A11y snapshot artifact — the same a11y-snapshot.json the CLI writes (same schemaVersion, same fingerprints). Persist it to your own file to diff across sessions, or feed it to the CI a11y-diff. Output is capped, so it is best for small roots.",
      inputSchema: { name: checkpointName },
    },
    async ({ name }) => {
      const cp = checkpoints.get(name);
      if (!cp) return errText(`No checkpoint named "${name}".`);
      const artifact = buildArtifact([cp.page], {
        toolName: "@real-a11y-dev/mcp",
        toolVersion: packageVersion(),
        ...(cp.rules ? { rules: cp.rules } : {}),
      });
      const json = serializeArtifact(artifact);
      // Never truncate a JSON artifact into invalid JSON — the outer bounded()
      // cap would corrupt it. Fail cleanly so the agent narrows the root and
      // re-exports valid JSON instead of importing garbage.
      if (json.length > MAX_OUTPUT_CHARS) {
        return errText(
          `Checkpoint "${name}" is too large to export inline (${Math.round(json.length / 1024)} KB > ${MAX_OUTPUT_CHARS / 1024} KB cap). Re-save it with a narrower rootSelector.`,
        );
      }
      return text(json);
    },
  );

  server.registerTool(
    "import_checkpoint",
    {
      title: "Import a checkpoint from JSON",
      description:
        "Load an externally-held Real A11y snapshot artifact (e.g. a CLI-generated baseline) into the store under `name`, so a live page can be diffed against it. Input is validated strictly; the artifact's first page is stored.",
      inputSchema: {
        name: checkpointName,
        artifact: z
          .string()
          .describe("A serialized Real A11y snapshot artifact (JSON)."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ name, artifact }) => {
      try {
        const parsed = parseSnapshotArtifact(artifact);
        // Refuse a partial (`--only`) capture, exactly as `real-a11y diff` does:
        // an imported checkpoint becomes the diff BASE, and a filtered-away axis
        // would read as everything-new — reported as findings that "gate CI".
        assertFullArtifact(parsed, `artifact for "${name}"`);
        const src = parsed.pages[0];
        if (!src) return errText(`Artifact for "${name}" has no pages.`);
        // Store under `name` with the page renamed and re-fingerprinted to that
        // label — exactly as checkpoint_findings does — so a later diff_findings
        // (which builds the head under `name`) joins and matches. The artifact's
        // original page name would otherwise never equal the store label, and
        // the diff would report every finding as both NEW and FIXED.
        const page = {
          ...src,
          name,
          findings: fingerprintFindings(name, src.findings),
        };
        checkpoints.save(name, {
          page,
          rules: parsed.meta?.rules ?? undefined,
        });
        const extra =
          parsed.pages.length > 1
            ? ` (first of ${parsed.pages.length} pages)`
            : "";
        return text(
          `Imported "${name}": ${page.findings.length} finding(s)${extra}. ${checkpoints.size} checkpoint(s) stored.`,
        );
      } catch (err) {
        const msg =
          err instanceof SnapshotFormatError ? err.message : "invalid artifact";
        return errText(`Could not import "${name}": ${msg}`);
      }
    },
  );

  // ── Tree checkpoints (Axis-A interaction diff) ───────────────────────────
  server.registerTool(
    "checkpoint_tree",
    {
      title: "Checkpoint the tree (for an interaction diff)",
      description:
        "Capture the CURRENT accessibility tree in the page as a comparison point. Then interact — click, type, open a dialog — and call diff_tree to see exactly which nodes were added, removed, or changed, and where focus moved. Unlike checkpoint_findings (which stores findings and survives navigation), a tree checkpoint is bound to THIS page instance and is discarded when the page navigates.",
      inputSchema: { rootSelector },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ rootSelector }) => {
      const out = await session.call<string>("checkpointTree", rootSelector);
      treeCheckpointRoot = rootSelector;
      return text(out);
    },
  );

  server.registerTool(
    "diff_tree",
    {
      title: "Diff the tree since the checkpoint",
      annotations: READ_ONLY,
      description:
        "Diff the CURRENT accessibility tree against the one captured by checkpoint_tree: nodes added, removed, or changed, plus a focus move. This is the interaction diff — the precise answer to 'what did that click actually change for a screen reader?'. Re-extracts with the root the checkpoint used unless you override it.",
      inputSchema: {
        rootSelector: z
          .string()
          .optional()
          .describe(
            "CSS root for the re-extraction. Defaults to the root the checkpoint was captured with.",
          ),
      },
    },
    async ({ rootSelector }) => {
      // Like-for-like: re-extract from the checkpoint's root unless overridden,
      // so the diff can't silently widen to <body> and invent added nodes.
      const root = rootSelector ?? treeCheckpointRoot ?? "body";
      try {
        return text(await session.call<string>("diffSinceCheckpoint", root));
      } catch (err) {
        return errText(err instanceof Error ? err.message : String(err));
      }
    },
  );

  return server;
}
