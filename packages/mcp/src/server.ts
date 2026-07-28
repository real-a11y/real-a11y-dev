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
import { ALL_RULES, listByRole } from "@real-a11y-dev/audit";
import type { A11yRule, Finding, RoleFilter } from "@real-a11y-dev/audit";
import { resolveTarget } from "@real-a11y-dev/browser";
import type { A11ySession, TargetCandidate } from "@real-a11y-dev/browser";
import { numberTabStops } from "@real-a11y-dev/serialize";
import {
  assertFullArtifact,
  buildArtifact,
  buildSnapshotPage,
  fingerprintFindings,
  parseSnapshotArtifact,
  projectNativeTree,
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

/**
 * A CSS scope for the in-page walk.
 *
 * Only the tools still built on that walk take it: `get_tab_order` (tab
 * SEQUENCE is layout work Chromium's AX tree doesn't expose) and the tree
 * checkpoints. Everything else reads Chromium's own accessibility tree, which
 * is whole-document — there is nothing for a selector to scope, and a parameter
 * that silently did nothing would be worse than none at all.
 */
const rootSelector = z
  .string()
  .default("body")
  .describe("CSS selector for the extraction root. Defaults to 'body'.");

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

// ── Act-tool targeting fragments ─────────────────────────────────────────
// Targets are described in the tree's own vocabulary — role + accessible
// name — never a node id. Ids are internal and realm-bound; resolution runs
// against a fresh native tree immediately before each dispatch.
const actRole = z
  .string()
  .min(1)
  .describe(
    "ARIA role of the target, exactly as the tree prints it — e.g. 'button', " +
      "'link', 'textbox', 'checkbox', 'menuitem'.",
  );
const actName = z
  .string()
  .optional()
  .describe(
    "Accessible name of the target — case-insensitive, whitespace-normalized " +
      "EXACT match against the tree get_semantic_tree returns. Pass '' to " +
      "target an unlabeled control. Omit to match any name; if several nodes " +
      "match, the error lists them so you can pass nth.",
  );
const actNth = z
  .number()
  .int()
  .min(1)
  .optional()
  .describe(
    "1-based pick among the matching nodes in document order, evaluated among " +
      "the role+name-filtered matches. Use after an ambiguity error lists the " +
      "candidates.",
  );

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

/**
 * Render a single-extraction snapshot: audit + the tree and outline, all from
 * one read of Chromium's own accessibility tree, so they describe one instant.
 *
 * No tab-order section: that tree carries none, and printing an empty block
 * would read as "nothing on this page is focusable" — a very different claim
 * from "not measured here". `get_tab_order` is the tab sequence.
 */
type ViewSnapshot = {
  findings: Finding[];
  tree: string;
  outline: string;
};
export function renderSnapshot(snap: ViewSnapshot): string {
  const treeNodes = snap.tree.split("\n").filter(Boolean).length;
  return [
    `Single-extraction snapshot — ${treeNodes} tree nodes. All sections below describe the same instant. (Tab order is not part of this tree — call get_tab_order for the keyboard sequence.)`,
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
  /**
   * True when the browser was launched visibly (`REAL_A11Y_MCP_HEADFUL=1`).
   * The decision is made in the bin, so the server can only report it if it's
   * told — and it must report it, because "headless" is the default and a
   * human watching for a window otherwise concludes the browser never opened.
   *
   * Meaningless when `cdpAttached` is set — see below.
   */
  headful?: boolean;
  /**
   * True when the server attaches to an already-running Chrome
   * (`REAL_A11Y_MCP_CDP`) instead of launching one. Then `headful` describes a
   * launch that never happened: `BrowserSession` ignores `headless` entirely
   * over CDP, so the window state is whatever the user's browser already is.
   * Reporting "headless — set REAL_A11Y_MCP_HEADFUL=1 to see a window" there
   * is doubly wrong: there usually *is* a window, and that variable can't make
   * one. Say so instead of guessing.
   */
  cdpAttached?: boolean;
}

export function buildServer(
  session: A11ySession,
  options: BuildServerOptions = {},
): McpServer {
  const authenticated = options.authenticated === true;
  const cdpAttached = options.cdpAttached === true;
  const headful = options.headful === true;
  // Over CDP the window state belongs to the browser we attached to, and
  // REAL_A11Y_MCP_HEADFUL is inert — never offer it as a fix there.
  const browserMode = cdpAttached
    ? "attached to your running Chrome (its own window state; REAL_A11Y_MCP_HEADFUL has no effect over CDP)"
    : headful
      ? "headful (a window is open)"
      : "headless (no window — set REAL_A11Y_MCP_HEADFUL=1 to see one)";
  // Three auth states, not two. A CDP attach never carries a storage state
  // (they're mutually exclusive), but `ensurePage` reuses the attached
  // browser's own context — so its pages inherit whatever that profile is
  // signed into. "NO saved login, expect a logged-out view" is wrong there,
  // and "restart with REAL_A11Y_MCP_CDP" prescribes the setup already in use.
  // It's still not a promise of auth: that browser may be signed into nothing,
  // and only the human at that window can change it.
  const authNote = authenticated
    ? " This server was started with a saved login session, so pages open ALREADY AUTHENTICATED — do not try to log in or navigate to a login page; open the destination directly."
    : cdpAttached
      ? " This server is attached to a Chrome the user is already running, so pages open with whatever sessions THAT browser holds — a page behind auth may well open already authenticated; check what you actually got rather than assuming either way. Don't try to log in through the tools — there is no credential parameter, deliberately. If a page does come up logged out, the user has to sign in in that Chrome window; the server cannot do it for them, and no environment variable changes it."
      : " This server has NO saved login, so a page behind auth will open as a logged-out view. Don't try to log in through the tools — there is no credential parameter, deliberately. Tell the user to restart the server with REAL_A11Y_MCP_STORAGE_STATE (a saved session from `real-a11y login`) or REAL_A11Y_MCP_CDP (attach to a Chrome they're already signed into).";
  const server = new McpServer(
    {
      name: "real-a11y",
      title: "Real A11y — accessibility audits",
      version: packageVersion(),
    },
    {
      instructions:
        "Audit any web page's accessibility for AI agents. Call open_page(url) FIRST, then use audit_page (violations), inspect_page (findings + tree + outline + tab order from one consistent snapshot — prefer on dynamic pages), or the get_* / list_elements views. To interact: checkpoint_tree, then click_element / type_text / focus_element (target by role + accessible name), then diff_tree to see exactly what changed. All tools share ONE browser page — issue calls sequentially, never in parallel.",
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
        authNote,
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
          `\nBrowser: ${browserMode}` +
          (authenticated
            ? "\n(authenticated session: storage state loaded)"
            : cdpAttached
              ? "\n(session: whatever the attached Chrome holds — verify rather than assume)"
              : ""),
      );
    },
  );

  server.registerTool(
    "close_browser",
    {
      title: "Close browser",
      description:
        "Close the browser session and free resources. This also DISCARDS every saved findings checkpoint — export_checkpoint anything you still need first. Only call it when you're done; the other tools reopen nothing on their own.",
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
        "Run accessibility audits against the current page and return every violation — unlabeled interactive controls, skipped heading levels or missing/duplicate h1, unlabeled dialogs, and broken landmark structure. Reports what real assistive tech would announce as broken. This is the primary tool. Audits Chromium's own accessibility tree, so it reaches structure no in-page walk can (a `<video controls>`'s user-agent-shadow media controls); findings carry CSS locators. Whole-document. Chromium only.",
      inputSchema: {
        rules: z
          .array(z.enum(RULES))
          .optional()
          .describe("Subset of rules to run. Omit to run all rules."),
      },
    },
    async ({ rules }) => {
      // Findings are computed in Node over Chromium's own tree.
      const snap = projectNativeTree(await session.nativeTree(), { rules });
      return text(renderAudit(snap.findings));
    },
  );

  server.registerTool(
    "inspect_page",
    {
      title: "Inspect page (single snapshot)",
      annotations: READ_ONLY,
      description:
        "Return the audit findings AND the semantic tree and heading outline — all derived from ONE read of Chromium's accessibility tree, so they are guaranteed internally consistent. The element focused at capture time is marked `[focused]`. Prefer this over separate audit_page + get_* calls on dynamic pages (SPAs, pages with consent dialogs) where separate calls could catch different states. That tree carries no tab order, so there is no tab-order section here — call get_tab_order for the keyboard sequence. Whole-document. Chromium only.",
      inputSchema: {
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
    async ({ rules, includeGeneric }) => {
      const snap = projectNativeTree(await session.nativeTree(), {
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
        "Return the page's accessibility tree as a deterministic, indented role + accessible-name outline (what a screen reader would traverse) — read from Chromium's own accessibility tree over CDP, so it reaches user-agent-shadow media controls an in-page walk never sees. The element focused at capture time is marked `[focused]`. Token-efficient and stable across runs. This is the vocabulary the act tools target in. Whole-document. Chromium only.",
      inputSchema: {
        includeGeneric: z
          .boolean()
          .default(false)
          .describe("Include generic container nodes (role=generic)."),
      },
    },
    async ({ includeGeneric }) => {
      const snap = projectNativeTree(await session.nativeTree(), {
        includeGeneric,
      });
      return text(snap.tree || "(empty tree)");
    },
  );

  server.registerTool(
    "get_heading_outline",
    {
      title: "Get heading outline",
      annotations: READ_ONLY,
      description:
        "Return the page's heading outline (h1..h6 in document order) as an indented list, derived from Chromium's own accessibility tree. Whole-document. Chromium only.",
      inputSchema: {},
    },
    async () => {
      const snap = projectNativeTree(await session.nativeTree());
      return text(snap.outline);
    },
  );

  server.registerTool(
    "get_tab_order",
    {
      title: "Get tab order",
      annotations: READ_ONLY,
      description:
        "Return the focusable elements in the order a keyboard user encounters them when pressing Tab, numbered, with role + accessible name. The stop focused at capture time is marked `[focused]`. Built from the in-page DOM walk — Chromium's accessibility tree knows whether a node is focusable but not the SEQUENCE (tabindex never reaches it), so this is the only source for tab order, and the one tool `rootSelector` still scopes.",
      inputSchema: { rootSelector },
    },
    async ({ rootSelector }) => {
      const seq = await session.call<string>(
        "tabSequenceSnapshot",
        rootSelector,
      );
      // Number at render — the page bundle produces the canonical unnumbered
      // form; the ordinals help an agent reference "stop 7" and are never stored.
      return text(numberTabStops(seq));
    },
  );

  server.registerTool(
    "list_elements",
    {
      title: "List elements by category",
      annotations: READ_ONLY,
      description:
        "List every element of one category — links, buttons, form controls, landmarks, images, or headings — as role + accessible name + a CSS locator. A token-efficient way to review one kind of element (e.g. 'images' pairs with the image-alt rule, 'form' with labeling). Listed from Chromium's own accessibility tree, so it agrees node for node with get_semantic_tree and audit_page. Whole-document. Chromium only.",
      inputSchema: {
        filter: z
          .enum(["heading", "link", "button", "form", "landmark", "image"])
          .describe("Which category of element to list."),
      },
    },
    async ({ filter }) => {
      // Node-side listing over the native tree — the same category engine the
      // page bundle runs.
      const list = listByRole(await session.nativeTree(), filter as RoleFilter);
      return text(list || "(none)");
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
        "Snapshot the CURRENT page's accessibility findings and store them under `name`. Later call diff_findings to see which findings are new / changed / fixed — the same identity semantics (fingerprints) the CI a11y-diff uses. Checkpoints survive navigation, so you can checkpoint one deploy and diff another: save 'prod', open the preview URL, then diff_findings('prod'). They are held in memory and do NOT survive close_browser — call export_checkpoint first if you need one to outlive the session. Whole-document. Chromium only.",
      inputSchema: {
        name: checkpointName,
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
    async ({ name, rules }) => {
      // Native, like `real-a11y snapshot`. These two write the SAME artifact
      // shape through the same assembler so a checkpoint captured by one can be
      // diffed by the other — which only holds while both read the same
      // producer. `tabOrder: false` is the other half: a native page omits the
      // tabs view rather than storing an empty one.
      const snap = projectNativeTree(await session.nativeTree(), { rules });
      const page = buildSnapshotPage(name, currentUrl, snap, {
        root: "body",
        tabOrder: false,
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
      inputSchema: { name: checkpointName },
    },
    async ({ name }) => {
      const base = checkpoints.get(name);
      if (!base) {
        return errText(
          `No checkpoint named "${name}". Save one first with checkpoint_findings.`,
        );
      }
      // Re-snapshot with the SAME rule set the checkpoint was captured with, so
      // findings from rules the base never ran don't read as spurious NEW.
      const snap = projectNativeTree(await session.nativeTree(), {
        // Stored loosely as `string[]`; validated against the rule enum when
        // the checkpoint was saved.
        rules: base.rules as A11yRule[] | undefined,
      });
      const head = buildSnapshotPage(name, currentUrl, snap, {
        root: "body",
        tabOrder: false,
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
        // Declare what was measured. A checkpoint is native, so it has no tabs
        // view — and an artifact that stayed silent about that would be read as
        // "every tab stop is gone" by whatever diffs it next.
        views: ["tree", "outline"],
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

  // ── Act (the write side of the native producer) ──────────────────────────
  // Targets resolve against a FRESH native tree per dispatch, so node ids
  // never cross the tool boundary and staleness shrinks to the instant
  // between resolution and dispatch.
  const describeTarget = (c: TargetCandidate) => `${c.role} "${c.name}"`;
  const MAX_CANDIDATES = 10;

  async function resolveActTarget(
    role: string,
    name: string | undefined,
    nth: number | undefined,
  ): Promise<
    | { ok: true; nodeId: string; candidate: TargetCandidate }
    | { ok: false; res: ReturnType<typeof errText> }
  > {
    const tree = await session.nativeTree();
    const resolved = resolveTarget(tree, { role, name, nth });
    switch (resolved.kind) {
      case "resolved":
        return {
          ok: true,
          nodeId: resolved.nodeId,
          candidate: resolved.candidate,
        };
      case "not-found": {
        const label = name !== undefined ? `${role} named "${name}"` : role;
        if (resolved.matchesForRole > 0) {
          return {
            ok: false,
            res: errText(
              `No ${label} in the accessibility tree — but ${resolved.matchesForRole} ${role}(s) with other ` +
                `names exist. Check the name with get_semantic_tree, or omit name to list the candidates.`,
            ),
          };
        }
        return {
          ok: false,
          res: errText(
            `No ${label} in the accessibility tree. Re-read it with get_semantic_tree — ` +
              `the page may have changed, or the element may not be exposed to assistive tech at all ` +
              `(which is itself an accessibility finding).`,
          ),
        };
      }
      case "ambiguous": {
        const shown = resolved.candidates.slice(0, MAX_CANDIDATES);
        const lines = shown.map(
          (c) =>
            `  nth=${c.nth} · ${describeTarget(c)}${c.disabled ? " (disabled)" : ""}`,
        );
        const more = resolved.candidates.length - shown.length;
        if (more > 0) lines.push(`  … +${more} more`);
        return {
          ok: false,
          res: errText(
            `${resolved.candidates.length} ${role}(s) match — pass nth (1-based, document order) to pick one:\n` +
              lines.join("\n"),
          ),
        };
      }
      case "nth-out-of-range":
        return {
          ok: false,
          res: errText(
            `nth=${resolved.nth}, but only ${resolved.matchCount} node(s) match.`,
          ),
        };
      case "no-dom-node":
        return {
          ok: false,
          res: errText(
            `Matched ${describeTarget(resolved.candidate)}, but it has no backing DOM element ` +
              `(a synthesized node) — it can't be acted on.`,
          ),
        };
    }
  }

  // A disabled control swallows the action silently — el.click() "succeeds"
  // and fires nothing, so the agent would see success plus an empty diff and
  // draw the wrong conclusion. Refuse with the cause instead.
  function disabledRefusal(candidate: TargetCandidate, verb: string) {
    return errText(
      `${describeTarget(candidate)} is disabled — the page would ignore the ${verb}. ` +
        `If enabling it is the point of the flow, act on whatever enables it first ` +
        `(diff_tree after that action will show the state change).`,
    );
  }

  // The diff loop is the payoff of acting at all — steer every success to it.
  const diffSteer = () =>
    treeCheckpointRoot !== undefined
      ? " Call diff_tree to see what this changed."
      : " Tip: call checkpoint_tree before acting, then diff_tree after, to see exactly what an action changed for a screen reader.";

  function actFailure(toolName: string, error: string | undefined) {
    // The backend's "re-read the tree and retry" remedy presumes a caller
    // holding node ids. Here the target resolved from a fresh tree
    // microseconds ago, so a resolution miss means the page mutated mid-action
    // — and the re-read IS a retry of this tool.
    if (error !== undefined && /could not resolve node/.test(error)) {
      return errText(
        `The target changed or disappeared mid-action — the page mutated. Retry ${toolName}.`,
      );
    }
    return errText(error ?? "the action failed");
  }

  server.registerTool(
    "click_element",
    {
      title: "Click an element (by role + name)",
      description:
        "Dispatch a REAL click against the element matched by role + accessible name in Chromium's native accessibility tree — the same view get_semantic_tree { producer: \"native\" } prints. Targeting is deliberately role+name only: if a control can't be reached that way, assistive technology can't reach it either, and that is itself an accessibility finding. For the full story call checkpoint_tree FIRST, then this, then diff_tree — the diff answers 'what did that click change for a screen reader?'. THE CLICK IS REAL: it can submit forms, toggle state, and NAVIGATE — navigation discards the page's tree checkpoint. If several nodes match, the error lists them; pass nth to pick one. Chromium only. See also type_text and focus_element.",
      inputSchema: { role: actRole, name: actName, nth: actNth },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ role, name, nth }) => {
      const target = await resolveActTarget(role, name, nth);
      if (!target.ok) return target.res;
      if (target.candidate.disabled) {
        return disabledRefusal(target.candidate, "click");
      }
      const result = await session.act({
        nodeId: target.nodeId,
        action: "click",
      });
      if (!result.success) return actFailure("click_element", result.error);
      return text(`Clicked ${describeTarget(target.candidate)}.` + diffSteer());
    },
  );

  server.registerTool(
    "type_text",
    {
      title: "Type into a text field (by role + name)",
      description:
        "Set the value of the text field matched by role + accessible name in the native accessibility tree (role is usually 'textbox', 'searchbox', or 'combobox'). REPLACES the field's current value — via the prototype value setter plus input/change events, so framework-controlled inputs (React et al.) register it. The result NEVER echoes the typed text or any field content. There is deliberately NO credential parameter and this tool must NOT be used to log in — a password or token typed here would enter the agent's context; for pages behind auth the user starts the server with REAL_A11Y_MCP_STORAGE_STATE or REAL_A11Y_MCP_CDP instead. Pair with checkpoint_tree / diff_tree to see what the input changed (a combobox popping options, an inline error appearing). Chromium only.",
      inputSchema: {
        role: actRole,
        name: actName,
        nth: actNth,
        text: z
          .string()
          .describe(
            "The text to enter. Replaces the field's current value. Never echoed back in the result.",
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ role, name, nth, text: value }) => {
      const target = await resolveActTarget(role, name, nth);
      if (!target.ok) return target.res;
      if (target.candidate.disabled) {
        return disabledRefusal(target.candidate, "input");
      }
      const result = await session.act({
        nodeId: target.nodeId,
        action: "type",
        payload: { value },
      });
      if (!result.success) return actFailure("type_text", result.error);
      return text(
        `Typed into ${describeTarget(target.candidate)} — the field's previous value was replaced.` +
          diffSteer(),
      );
    },
  );

  server.registerTool(
    "focus_element",
    {
      title: "Focus an element (by role + name)",
      description:
        "Move REAL keyboard focus to the element matched by role + accessible name in the native accessibility tree. The result says whether the target is a text field, so a type_text can follow. Useful alongside get_tab_order for focus-order work, and for checking what a keyboard user would land on. Chromium only. See also click_element and type_text.",
      inputSchema: { role: actRole, name: actName, nth: actNth },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ role, name, nth }) => {
      const target = await resolveActTarget(role, name, nth);
      if (!target.ok) return target.res;
      if (target.candidate.disabled) {
        return disabledRefusal(target.candidate, "focus");
      }
      const result = await session.act({
        nodeId: target.nodeId,
        action: "focus",
      });
      if (!result.success) return actFailure("focus_element", result.error);
      const inputNote = result.requiresInput
        ? ` It is a text field (${result.inputType ?? "text"}) — follow with type_text to enter a value.`
        : "";
      return text(
        `Focused ${describeTarget(target.candidate)}.` +
          inputNote +
          diffSteer(),
      );
    },
  );

  return server;
}
