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
import {
  captureNativeCheckpoint,
  diffNativeCheckpoint,
  resolveTarget,
} from "@real-a11y-dev/browser";
import type { A11ySession, TargetCandidate } from "@real-a11y-dev/browser";
import { numberTabStops } from "@real-a11y-dev/serialize";
import { SessionRegistryError } from "@real-a11y-dev/session-registry";
import {
  assertFullArtifact,
  buildArtifact,
  buildSnapshotPage,
  parseSnapshotArtifact,
  projectNativeTree,
  redactUrl,
  redactUrlsIn,
  sanitizeText,
  serializeArtifact,
  SnapshotFormatError,
  viewsOfPage,
} from "@real-a11y-dev/snapshot";
import { z } from "zod";

import {
  type CheckpointStore,
  differentUrl,
  diffCheckpointPages,
  diffLabeledCheckpoints,
  renderDiff,
  scopeMismatch,
} from "./checkpoints.js";
import {
  DEFAULT_SESSION,
  singleSessionManager,
  type SessionManager,
  type SessionRecord,
} from "./sessions.js";

export {
  McpSessionManager,
  singleSessionManager,
  DEFAULT_SESSION,
  SESSION_NAME_RE,
  // The error contract of a custom `SessionManager`: this package bundles the
  // private registry, so these classes are only importable from HERE — an
  // embedder that can't reach them can only throw refusals the server won't
  // recognize as tool errors.
  SessionRegistryError,
  RegistryShutdownError,
  type SessionManager,
  type SessionRecord,
  type SessionInfo,
  type McpSessionManagerOptions,
} from "./sessions.js";

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
 * Only `get_tab_order` still takes it: tab SEQUENCE is layout work Chromium's
 * AX tree doesn't expose, so that one view is still an in-page walk. Everything
 * else — the tree checkpoints included, as of the native migration — reads
 * Chromium's own accessibility tree, which is whole-document: there is nothing
 * for a selector to scope, and a parameter that silently did nothing would be
 * worse than none at all.
 */
const rootSelector = z
  .string()
  .default("body")
  .describe("CSS selector for the extraction root. Defaults to 'body'.");

/**
 * Cap oversized tool output so a huge page can't blow the agent's context.
 *
 * The hint carries as much weight as the cap. Every truncation used to end
 * "narrow with rootSelector" — a parameter four of the five read tools no
 * longer accept, so the advice arrives attached to the one output where the
 * agent most needs a way forward and names a door that isn't there. Each caller
 * passes the lever IT actually has instead, and a tool with none passes nothing:
 * "this is the whole document" is a worse answer than a fix, and a better one
 * than a fix that doesn't exist.
 */
const MAX_OUTPUT_CHARS = 40_000;
function bounded(body: string, hint?: string): string {
  if (body.length <= MAX_OUTPUT_CHARS) return body;
  return (
    body.slice(0, MAX_OUTPUT_CHARS) +
    `\n\n… output truncated at ${MAX_OUTPUT_CHARS} chars.${hint ? ` ${hint}` : ""}`
  );
}

/**
 * A page-supplied title, made safe to print. Sanitized because `document.title`
 * is page-controlled — an escape sequence or a newline in it could forge result
 * lines — and capped because it is unbounded: a multi-megabyte title would
 * flood the agent's context on every open_page.
 */
const TITLE_CAP = 300;
function pageTitle(raw: string): string {
  const clean = sanitizeText(raw, { singleLine: true }).slice(0, TITLE_CAP);
  return clean || "(untitled)";
}

function text(body: string, hint?: string) {
  return { content: [{ type: "text" as const, text: bounded(body, hint) }] };
}

// The three levers that survive the migration, named once so a tool can't
// advertise one it doesn't take.
/** The one tool still built on the in-page walk: `get_tab_order`. */
const SCOPE_HINT = "Pass a narrower `rootSelector` to scope the walk.";
/** Anything whose bulk is findings. Narrows the findings, never the tree. */
const RULES_HINT = "Pass a `rules` subset to report fewer findings.";
/** The whole-document reads, which have no scope parameter at all. */
const SLICE_HINT =
  "This read is whole-document and takes no `rootSelector` — `get_heading_outline` and `list_elements` return smaller slices of the same tree.";

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
  sessionOrManager: A11ySession | SessionManager,
  options: BuildServerOptions = {},
): McpServer {
  if (sessionOrManager === null || typeof sessionOrManager !== "object") {
    // Fail here, by name, instead of letting the first property probe throw
    // "Cannot use 'in' operator" (or worse, a late "manager.run is not a
    // function") with no mention of which argument was wrong.
    throw new TypeError(
      `buildServer requires an A11ySession or a SessionManager, got ${
        sessionOrManager === null ? "null" : typeof sessionOrManager
      }`,
    );
  }
  // Back-compat: embedders that pass one A11ySession get the old single-page
  // behavior under the default session name. Discriminate POSITIVELY on the
  // manager shape — a session-like object must not be misclassified just
  // because a property probe on it behaves unusually (e.g. a Proxy).
  const candidate = sessionOrManager as Partial<SessionManager>;
  const isManager =
    typeof candidate.run === "function" &&
    typeof candidate.stopAll === "function" &&
    typeof candidate.checkpoints === "function";
  const manager: SessionManager = isManager
    ? (sessionOrManager as SessionManager)
    : singleSessionManager(sessionOrManager as A11ySession);
  // The one page-visible difference between the two paths: whether named
  // sessions exist. Descriptions must not promise isolation a
  // `buildServer(session)` embedder can't deliver.
  const multiSession = isManager;
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
        "Audit any web page's accessibility for AI agents. Call open_page(url) FIRST, then use audit_page (violations), inspect_page (findings + tree + outline + tab order from one consistent snapshot — prefer on dynamic pages), or the get_* / list_elements views. To interact: checkpoint_tree, then click_element / type_text / focus_element (target by role + accessible name), then diff_tree to see exactly what changed. " +
        (multiSession
          ? "Every page tool takes an optional `session` — separate names are independent live pages with their own checkpoints; calls within one session are serialized automatically, and different sessions may run in parallel. Omit `session` to keep using the one default page."
          : 'This server manages a SINGLE browser session — always omit the `session` parameter (or pass "default"); other names are refused.'),
    },
  );

  // ── Sessions ─────────────────────────────────────────────────────────────
  // Per-session state (the browser session, the last opened URL, the tree
  // checkpoint) lives in a SessionRecord owned by the manager;
  // tools reach it only through `withSession`, which is what makes the
  // per-session single-flight guarantee structural. Findings checkpoints
  // deliberately SURVIVE navigation (cross-deploy diffs) AND the idle
  // timeout closing the browser (the store lives outside the record, see
  // `SessionManager.checkpoints`); the one thing that discards them is
  // close_browser.
  // Every client-visible error goes through here, so the boundary lives here
  // rather than at each thrower: `import_checkpoint` and the session refusals
  // build through it too, and a redaction that only guards the paths someone
  // remembered is the shape this PR keeps finding.
  const errText = (msg: string) => ({
    content: [
      {
        type: "text" as const,
        text: bounded(sanitizeText(redactUrlsIn(msg), { singleLine: true })),
      },
    ],
    isError: true as const,
  });
  // No zod `.regex()` here on purpose: the SDK enforces the schema BEFORE the
  // handler runs, so a schema-level regex would reject bad names as a
  // protocol-level InvalidParams (a raw zod issue array) — the manager's own
  // check turns the same mistake into a tool error with the remedy attached.
  // The grammar lives in the description and in `SESSION_NAME_RE`.
  const sessionDescription = multiSession
    ? "Named browser session to use (1-32 characters from A-Z, a-z, 0-9, _ and -). Separate names are independent live pages with their own checkpoints; calls within one session run one at a time, different sessions run in parallel. Omit for the default session."
    : 'This server manages a single browser session — omit this parameter (or pass "default").';
  const sessionParam = z
    .string()
    .default(DEFAULT_SESSION)
    .describe(sessionDescription);
  // Session-level refusals (bad name, session cap, shutdown) are expected,
  // user-fixable conditions — surface them as tool errors with the remedy,
  // not as protocol-level exceptions.
  const sessionErrText = (err: unknown) => {
    if (err instanceof SessionRegistryError) {
      return errText(err.hint ? `${err.message} — ${err.hint}` : err.message);
    }
    // Non-Error throws reach the SDK's `String(error)` fallback raw, so they
    // need the same treatment as an Error's message.
    if (!(err instanceof Error)) {
      throw new Error(
        redactUrlsIn(sanitizeText(String(err), { singleLine: true })),
      );
    }
    // Anything else escapes as a protocol error, and the SDK relays its message
    // to the client verbatim. Playwright quotes the full target URL in a
    // navigation failure — `page.goto: net::ERR_ABORTED at https://…#token=…` —
    // so a failed open leaks what a successful one now redacts. The CLI already
    // guards its equivalent path with `redactUrlsIn`; this is the MCP side of
    // the same boundary. The message is rewritten in place so the error keeps
    // its class and stack.
    err.message = sanitizeText(redactUrlsIn(err.message), { singleLine: true });
    throw err;
  };
  const withSession = async <R>(
    name: string,
    fn: (rec: SessionRecord) => Promise<R>,
  ): Promise<R | ReturnType<typeof errText>> => {
    try {
      return await manager.run(name, fn);
    } catch (err) {
      return sessionErrText(err);
    }
  };
  /**
   * Checkpoint-only tools (list / diff / export / import) never touch the
   * page, so they read the store WITHOUT reserving a session: a typo'd
   * `session` on `list_checkpoints` must not burn a `maxSessions` slot or
   * launch anything.
   */
  const withCheckpoints = async <R>(
    name: string,
    fn: (checkpoints: CheckpointStore) => Promise<R> | R,
  ): Promise<R | ReturnType<typeof errText>> => {
    try {
      return await fn(manager.checkpoints(name));
    } catch (err) {
      return sessionErrText(err);
    }
  };
  /**
   * The address a checkpoint should record — read at extraction time, not at
   * open time.
   *
   * `click_element` can navigate, and after it does, `openedUrl` names the page
   * the session STARTED on. Recording that would put the wrong address on the
   * page, and — since `differentUrl` compares these — would leave a diff across
   * two genuinely different pages looking like one page twice.
   */
  const pageUrl = (rec: SessionRecord) =>
    rec.session.currentUrl() ?? rec.openedUrl;

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
        session: sessionParam,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      url,
      waitUntil,
      settleMs,
      timeoutMs,
      device,
      viewport,
      session,
    }) =>
      withSession(session, async (rec) => {
        const info = await rec.session.open(url, {
          waitUntil,
          settleMs,
          timeoutMs,
          device,
          viewport,
        });
        rec.openedUrl = info.url;
        // The tree checkpoint is deliberately NOT dropped here. It is now
        // Node-side data, and `diffNativeCheckpoint` detects a replaced
        // document on its own — from zero overlap in the backend ids, not from
        // the URL. Letting it do that keeps one answer for every navigation:
        // an explicit `open_page` and a click that happened to navigate both
        // report where the checkpoint was captured and where the page is now.
        // Clearing it here would make the explicit case the one that says
        // "checkpoint first" instead, which is the shape README, the tools
        // page and R10's step 9 all promise is gone.
        const emu = device
          ? ` [${device}]`
          : viewport
            ? ` [${viewport.width}×${viewport.height}]`
            : "";
        return text(
          // `info.url` is where the page LANDED, not what was asked for — a
          // redirect chain ends here, and an OAuth one ends with the token in
          // the fragment. The failure path leaks the same URL through
          // Playwright's message; `sessionErrText` redacts that one.
          // `info.title` is `document.title` — page-controlled, straight from
          // the page realm. Redacting the URL beside it and leaving this raw
          // let a page inject an OSC-8 terminal hyperlink and forge extra
          // result lines, including a second `Opened <url>`. `singleLine` is
          // what kills the forgery half, so it matters as much as the escape
          // stripping. The question was never which URLs print raw — it is
          // which page-realm strings do.
          `Opened ${redactUrl(info.url)}${emu}\nTitle: ${pageTitle(info.title)}` +
            `\nBrowser: ${browserMode}` +
            (authenticated
              ? "\n(authenticated session: storage state loaded)"
              : cdpAttached
                ? "\n(session: whatever the attached Chrome holds — verify rather than assume)"
                : ""),
        );
      }),
  );

  server.registerTool(
    "close_browser",
    {
      title: "Close browser session(s)",
      description:
        "Close a named browser session (default: the default session) and free its resources, or pass all=true to close every live session — not both. Closing a session DISCARDS its saved findings checkpoints — export_checkpoint anything you still need first. Only call it when you're done; the other tools reopen nothing on their own.",
      inputSchema: {
        // No `.default()` here, unlike the shared sessionParam: this handler
        // must see whether `session` was actually passed, because passing it
        // TOGETHER with all=true is refused rather than silently widened to
        // "close everything".
        session: z
          .string()
          .optional()
          .describe(
            "Session to close. Omit for the default session. Not combinable with all=true.",
          ),
        all: z
          .boolean()
          .default(false)
          .describe("Close every live session instead of just one."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ session, all }) => {
      try {
        if (all && session !== undefined) {
          // A destructive tool must not do more than what was asked: closing
          // everything when a single session was named is exactly that.
          return errText(
            `Pass either session or all=true, not both. all=true closes EVERY live session; drop it to close just "${session}".`,
          );
        }
        if (all) {
          const count = manager.list().length;
          await manager.stopAll();
          return text(
            count === 0
              ? "No sessions were open."
              : `Closed ${count} session(s).`,
          );
        }
        const name = session ?? DEFAULT_SESSION;
        // Read before stop clears the store: the reply should say when saved
        // checkpoints went away with the session — including checkpoints that
        // outlived an idle-timeout browser close.
        const discarded = manager.checkpoints(name).size;
        const stopped = await manager.stop(name);
        const checkpointNote =
          discarded > 0 ? ` ${discarded} stored checkpoint(s) discarded.` : "";
        return text(
          stopped
            ? `Session "${name}" closed.${checkpointNote}`
            : `Session "${name}" was not open.${checkpointNote}`,
        );
      } catch (err) {
        return sessionErrText(err);
      }
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
        session: sessionParam,
      },
    },
    async ({ rules, session }) =>
      withSession(session, async (rec) => {
        // Findings are computed in Node over Chromium's own tree.
        const snap = projectNativeTree(await rec.session.nativeTree(), {
          rules,
        });
        return text(renderAudit(snap.findings), RULES_HINT);
      }),
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
        session: sessionParam,
      },
    },
    async ({ rules, includeGeneric, session }) =>
      withSession(session, async (rec) => {
        const snap = projectNativeTree(await rec.session.nativeTree(), {
          rules,
          includeGeneric,
        });
        return text(renderSnapshot(snap), `${RULES_HINT} ${SLICE_HINT}`);
      }),
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
        session: sessionParam,
      },
    },
    async ({ includeGeneric, session }) =>
      withSession(session, async (rec) => {
        const snap = projectNativeTree(await rec.session.nativeTree(), {
          includeGeneric,
        });
        return text(snap.tree || "(empty tree)", SLICE_HINT);
      }),
  );

  server.registerTool(
    "get_heading_outline",
    {
      title: "Get heading outline",
      annotations: READ_ONLY,
      description:
        "Return the page's heading outline (h1..h6 in document order) as an indented list, derived from Chromium's own accessibility tree. Whole-document. Chromium only.",
      inputSchema: { session: sessionParam },
    },
    async ({ session }) =>
      withSession(session, async (rec) => {
        const snap = projectNativeTree(await rec.session.nativeTree());
        return text(snap.outline);
      }),
  );

  server.registerTool(
    "get_tab_order",
    {
      title: "Get tab order",
      annotations: READ_ONLY,
      description:
        "Return the focusable elements in the order a keyboard user encounters them when pressing Tab, numbered, with role + accessible name. The stop focused at capture time is marked `[focused]`. Built from the in-page DOM walk — Chromium's accessibility tree knows whether a node is focusable but not the SEQUENCE (tabindex never reaches it), so this is the only source for tab order, and the one tool `rootSelector` still scopes.",
      inputSchema: { rootSelector, session: sessionParam },
    },
    async ({ rootSelector, session }) =>
      withSession(session, async (rec) => {
        const seq = await rec.session.call<string>(
          "tabSequenceSnapshot",
          rootSelector,
        );
        // Number at render — the page bundle produces the canonical unnumbered
        // form; the ordinals help an agent reference "stop 7" and are never stored.
        return text(numberTabStops(seq), SCOPE_HINT);
      }),
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
        session: sessionParam,
      },
    },
    async ({ filter, session }) =>
      withSession(session, async (rec) => {
        // Node-side listing over the native tree — the same category engine the
        // page bundle runs.
        // `listByRole` never returns "" — an empty category comes back as a line
        // saying why (0 of N nodes matched, and which roles it looked for), so
        // there is no sentinel for this caller to supply.
        return text(
          listByRole(await rec.session.nativeTree(), filter as RoleFilter),
        );
      }),
  );

  // ── Checkpoints (Axis-B findings diff) ───────────────────────────────────
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
        "Snapshot the CURRENT page's accessibility findings and store them under `name`. Later call diff_findings to see which findings are new / changed / fixed — the same identity semantics (fingerprints) the CI a11y-diff uses. Checkpoints survive navigation AND the session idle timeout (the browser may close and relaunch between saving and diffing; checkpoints remain), so you can checkpoint one deploy and diff another: save 'prod', open the preview URL, then diff_findings('prod'). They are held in memory and do NOT survive close_browser — call export_checkpoint first if you need one to outlive the session. Whole-document. Chromium only.",
      inputSchema: {
        name: checkpointName,
        rules: z
          .array(z.enum(RULES))
          .optional()
          .describe("Subset of rules for the findings. Omit to run all."),
        session: sessionParam,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ name, rules, session }) =>
      withSession(session, async (rec) => {
        // Native, like `real-a11y snapshot`. These two write the SAME artifact
        // shape through the same assembler so a checkpoint captured by one can be
        // diffed by the other — which only holds while both read the same
        // producer. `tabOrder: false` is the other half: a native page omits the
        // tabs view rather than storing an empty one.
        const snap = projectNativeTree(await rec.session.nativeTree(), {
          rules,
        });
        const page = buildSnapshotPage(name, pageUrl(rec), snap, {
          root: "body",
          tabOrder: false,
        });
        rec.checkpoints.save(name, { page, rules });
        const treeKb = (page.tree.length / 1024).toFixed(1);
        return text(
          `"${name}" saved: ${page.findings.length} finding(s) (tree ${treeKb} KB). ${rec.checkpoints.size} checkpoint(s) stored.`,
        );
      }),
  );

  server.registerTool(
    "diff_findings",
    {
      title: "Diff current page vs a checkpoint",
      annotations: READ_ONLY,
      description:
        "Re-snapshot the CURRENT page and diff it against the stored checkpoint `name`: which accessibility findings are NEW (these gate CI), CHANGED, or FIXED, plus an advisory structural summary. Use after a change (deploy, feature toggle, DOM edit) or after navigating to a different deploy of the same page.",
      inputSchema: { name: checkpointName, session: sessionParam },
    },
    async ({ name, session }) =>
      withSession(session, async (rec) => {
        const base = rec.checkpoints.get(name);
        if (!base) {
          return errText(
            `No checkpoint named "${name}". Save one first with checkpoint_findings.`,
          );
        }
        // Re-snapshot with the SAME rule set the checkpoint was captured with, so
        // findings from rules the base never ran don't read as spurious NEW.
        const snap = projectNativeTree(await rec.session.nativeTree(), {
          // Stored loosely as `string[]`; validated against the rule enum when
          // the checkpoint was saved.
          rules: base.rules as A11yRule[] | undefined,
        });
        const head = buildSnapshotPage(name, pageUrl(rec), snap, {
          root: "body",
          tabOrder: false,
        });
        // An imported base may have been captured at a narrow root; this side is
        // always whole-document. Say so — silently widening turns everything
        // outside the old subtree into NEW findings, the class that gates CI.
        const note = scopeMismatch(base.page, head);
        // Checkpoints survive navigation by design, so the agent may well have
        // moved to another page between saving and diffing.
        const body = renderDiff(diffCheckpointPages(base.page, head), {
          source: { kind: "live", checkpoint: name },
          differentUrl: differentUrl(base.page, head),
        });
        return text(note ? `${note}\n\n${body}` : body, RULES_HINT);
      }),
  );

  server.registerTool(
    "diff_checkpoints",
    {
      title: "Diff two stored checkpoints",
      annotations: READ_ONLY,
      description:
        "Diff two already-stored checkpoints against each other (no re-snapshot): which findings are new / changed / fixed going from `base` to `head`.",
      inputSchema: {
        base: checkpointName,
        head: checkpointName,
        session: sessionParam,
      },
    },
    async ({ base, head, session }) =>
      withCheckpoints(session, (checkpoints) => {
        const b = checkpoints.get(base);
        if (!b) return errText(`No checkpoint named "${base}".`);
        const h = checkpoints.get(head);
        if (!h) return errText(`No checkpoint named "${head}".`);
        // Two stored checkpoints can disagree on scope just as easily — either
        // side may have been imported from a scoped, DOM-era artifact.
        const note = scopeMismatch(b.page, h.page);
        const rendered = renderDiff(diffLabeledCheckpoints(b.page, h.page), {
          source: { kind: "stored", base, head },
          differentUrl: differentUrl(b.page, h.page),
        });
        return text(note ? `${note}\n\n${rendered}` : rendered, RULES_HINT);
      }),
  );

  server.registerTool(
    "list_checkpoints",
    {
      title: "List checkpoints",
      annotations: READ_ONLY,
      description:
        "List the stored checkpoint labels with their finding counts and approximate tree sizes.",
      inputSchema: { session: sessionParam },
    },
    async ({ session }) =>
      withCheckpoints(session, (checkpoints) => {
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
      }),
  );

  server.registerTool(
    "export_checkpoint",
    {
      title: "Export a checkpoint as JSON",
      annotations: READ_ONLY,
      description:
        "Return a stored checkpoint as a Real A11y snapshot artifact — the same a11y-snapshot.json the CLI writes (same schemaVersion, same fingerprints). Persist it to your own file to diff across sessions, or feed it to the CI a11y-diff. Checkpoints are whole-document, and the artifact has to come back as one valid JSON string, so a large page can exceed the output cap and fail — use the CLI's `real-a11y snapshot --output` for those.",
      inputSchema: { name: checkpointName, session: sessionParam },
    },
    async ({ name, session }) =>
      withCheckpoints(session, (checkpoints) => {
        const cp = checkpoints.get(name);
        if (!cp) return errText(`No checkpoint named "${name}".`);
        const artifact = buildArtifact([cp.page], {
          toolName: "@real-a11y-dev/mcp",
          toolVersion: packageVersion(),
          // Declare what was measured, reading it off the PAGE rather than
          // assuming. A checkpoint captured here is native and has no tabs view —
          // but one loaded by import_checkpoint may be a DOM-era artifact that
          // does. Hardcoding "no tabs" would silently drop that page's tab data
          // on re-export; hardcoding "tabs" would tell the next reader every stop
          // vanished. The page is the only honest source.
          views: viewsOfPage(cp.page),
          ...(cp.rules ? { rules: cp.rules } : {}),
        });
        const json = serializeArtifact(artifact);
        // Never truncate a JSON artifact into invalid JSON — the outer bounded()
        // cap would corrupt it. Fail cleanly so the agent gets no artifact rather
        // than an unparseable one.
        //
        // What the failure SAYS is the harder half. Checkpoints are whole-document
        // now, so the old "re-save it with a narrower rootSelector" names a
        // parameter `checkpoint_findings` no longer has: an agent that follows it
        // gets a schema error, and one that doesn't has nothing left to try. The
        // levers that do exist are worth naming precisely — `rules` shrinks the
        // findings and NOT the tree, so it only helps when findings are the bulk,
        // which is why the sizes are broken out rather than summed. And the honest
        // answer for a genuinely large page is that this tool is the wrong one:
        // the CLI writes the identical artifact to a file, with no inline cap.
        if (json.length > MAX_OUTPUT_CHARS) {
          const kb = (n: number) => Math.round(n / 1024);
          return errText(
            `Checkpoint "${name}" is too large to export inline (${kb(json.length)} KB > ${kb(MAX_OUTPUT_CHARS)} KB cap; the tree alone is ${kb(cp.page.tree.length)} KB, ${cp.page.findings.length} finding(s)). ` +
              `Checkpoints are whole-document, so there is no scope to narrow — a \`rules\` subset shrinks the findings but never the tree. ` +
              `To compare it, diff in-session (diff_findings / diff_checkpoints need no export). ` +
              `To keep it, capture the page with the CLI instead: \`real-a11y snapshot <url> --output a11y-snapshot.json\` writes the same artifact to a file, uncapped.`,
          );
        }
        return text(json);
      }),
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
        session: sessionParam,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ name, artifact, session }) =>
      withCheckpoints(session, (checkpoints) => {
        try {
          const parsed = parseSnapshotArtifact(artifact);
          // Refuse a partial (`--only`) capture, exactly as `real-a11y diff` does:
          // an imported checkpoint becomes the diff BASE, and a filtered-away axis
          // would read as everything-new — reported as findings that "gate CI".
          assertFullArtifact(parsed, `artifact for "${name}"`);
          const src = parsed.pages[0];
          if (!src) return errText(`Artifact for "${name}" has no pages.`);
          // Stored exactly as it arrived. This used to rename the page to the
          // store label and re-fingerprint under it, because the label WAS the
          // identity and an artifact's own page name would never equal it — so
          // without the rewrite every finding read as both NEW and FIXED.
          //
          // Pages carry an `id` derived from their URL now, so the artifact
          // already agrees with a live re-snapshot of the same route, and
          // rewriting would break the very join it once repaired. The store key
          // and the page's own name are free to differ, which is what they are.
          checkpoints.save(name, {
            page: src,
            rules: parsed.meta?.rules ?? undefined,
          });
          const extra =
            parsed.pages.length > 1
              ? ` (first of ${parsed.pages.length} pages)`
              : "";
          return text(
            `Imported "${name}": ${src.findings.length} finding(s)${extra}. ${checkpoints.size} checkpoint(s) stored.`,
          );
        } catch (err) {
          const msg =
            err instanceof SnapshotFormatError
              ? err.message
              : "invalid artifact";
          return errText(`Could not import "${name}": ${msg}`);
        }
      }),
  );

  // ── Tree checkpoints (Axis-A interaction diff) ───────────────────────────
  server.registerTool(
    "checkpoint_tree",
    {
      title: "Checkpoint the tree (for an interaction diff)",
      description:
        "Capture the CURRENT accessibility tree as a comparison point. Then interact — click, type, open a dialog — and call diff_tree to see exactly which nodes were added, removed, or changed, and where focus moved. Reads the whole document with the same native producer the act tools target, so the diff speaks one vocabulary. If a step navigates, diff_tree says the document was replaced rather than reporting the entire page as changed.",
      inputSchema: { session: sessionParam },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ session }) =>
      withSession(session, async (rec) => {
        const tree = await rec.session.nativeTree();
        rec.treeCheckpoint = captureNativeCheckpoint(tree, pageUrl(rec));
        return text(
          `Tree checkpoint captured — ${tree.nodes.size} node(s). Interact, then call diff_tree.`,
        );
      }),
  );

  server.registerTool(
    "diff_tree",
    {
      title: "Diff the tree since the checkpoint",
      annotations: READ_ONLY,
      description:
        "Diff the CURRENT accessibility tree against the one captured by checkpoint_tree: nodes added, removed, or changed, plus a focus move. This is the interaction diff — the precise answer to 'what did that click actually change for a screen reader?'.",
      inputSchema: { session: sessionParam },
    },
    async ({ session }) =>
      withSession(session, async (rec) => {
        const checkpoint = rec.treeCheckpoint;
        if (!checkpoint) {
          return errText(
            "No tree checkpoint in this session — call checkpoint_tree first, then interact, then diff_tree.",
          );
        }
        const outcome = diffNativeCheckpoint(
          checkpoint,
          await rec.session.nativeTree(),
          pageUrl(rec),
        );
        // A navigation is a real outcome of a real click, not a failure. The
        // checkpoint itself survived — it lives here, not in the page — but the
        // node identity it was written in did not, so there is nothing left to
        // compare against. Saying so beats reporting the whole page added.
        if (outcome.kind === "replaced") {
          // The checkpoint is NOT consumed here. `diff_tree` is annotated
          // read-only and idempotent, and a client that retries it — after a
          // transport hiccup, or simply twice — must get the same answer
          // rather than "call checkpoint_tree first", which would drop the
          // one piece of information the retry was after.
          //
          // That obliges wording that stays true on the second call as much as
          // the first: the checkpoint's own address never moves, and "the page
          // is now" is read fresh each time, so a further navigation reads as
          // the new address rather than as a second event being announced.
          //
          // Redact like every other URL this server prints. A click can land
          // on a one-time token or a userinfo URL, and this string goes
          // straight into an agent's context.
          return text(
            `The page navigated (or reloaded), so the checkpoint describes a document that no longer exists — no diff available.\n` +
              `Checkpoint captured on: ${redactUrl(outcome.from)}\n` +
              `The page is now: ${redactUrl(outcome.to)}\n` +
              `Call checkpoint_tree again to start a new comparison.`,
          );
        }
        return text(
          outcome.changed
            ? outcome.rendered
            : "No tree changes since the checkpoint.",
        );
      }),
  );

  // ── Act (the write side of the native producer) ──────────────────────────
  // Targets resolve against a FRESH native tree per dispatch, so node ids
  // never cross the tool boundary and staleness shrinks to the instant
  // between resolution and dispatch.
  const describeTarget = (c: TargetCandidate) => `${c.role} "${c.name}"`;
  const MAX_CANDIDATES = 10;

  async function resolveActTarget(
    rec: SessionRecord,
    role: string,
    name: string | undefined,
    nth: number | undefined,
  ): Promise<
    | { ok: true; nodeId: string; candidate: TargetCandidate }
    | { ok: false; res: ReturnType<typeof errText> }
  > {
    const tree = await rec.session.nativeTree();
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
  const diffSteer = (rec: SessionRecord) =>
    rec.treeCheckpoint !== undefined
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
        "Dispatch a REAL click against the element matched by role + accessible name in Chromium's accessibility tree — the same view get_semantic_tree prints. Targeting is deliberately role+name only: if a control can't be reached that way, assistive technology can't reach it either, and that is itself an accessibility finding. For the full story call checkpoint_tree FIRST, then this, then diff_tree — the diff answers 'what did that click change for a screen reader?'. THE CLICK IS REAL: it can submit forms, toggle state, and NAVIGATE — if it navigates, diff_tree reports the document was replaced rather than a diff, and you re-checkpoint. If several nodes match, the error lists them; pass nth to pick one. Chromium only. See also type_text and focus_element.",
      inputSchema: {
        role: actRole,
        name: actName,
        nth: actNth,
        session: sessionParam,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ role, name, nth, session }) =>
      withSession(session, async (rec) => {
        const target = await resolveActTarget(rec, role, name, nth);
        if (!target.ok) return target.res;
        if (target.candidate.disabled) {
          return disabledRefusal(target.candidate, "click");
        }
        const result = await rec.session.act({
          nodeId: target.nodeId,
          action: "click",
        });
        if (!result.success) return actFailure("click_element", result.error);
        return text(
          `Clicked ${describeTarget(target.candidate)}.` + diffSteer(rec),
        );
      }),
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
        session: sessionParam,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ role, name, nth, text: value, session }) =>
      withSession(session, async (rec) => {
        const target = await resolveActTarget(rec, role, name, nth);
        if (!target.ok) return target.res;
        if (target.candidate.disabled) {
          return disabledRefusal(target.candidate, "input");
        }
        const result = await rec.session.act({
          nodeId: target.nodeId,
          action: "type",
          payload: { value },
        });
        if (!result.success) return actFailure("type_text", result.error);
        return text(
          `Typed into ${describeTarget(target.candidate)} — the field's previous value was replaced.` +
            diffSteer(rec),
        );
      }),
  );

  server.registerTool(
    "focus_element",
    {
      title: "Focus an element (by role + name)",
      description:
        "Move REAL keyboard focus to the element matched by role + accessible name in the native accessibility tree. The result says whether the target is a text field, so a type_text can follow. Useful alongside get_tab_order for focus-order work, and for checking what a keyboard user would land on. Chromium only. See also click_element and type_text.",
      inputSchema: {
        role: actRole,
        name: actName,
        nth: actNth,
        session: sessionParam,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ role, name, nth, session }) =>
      withSession(session, async (rec) => {
        const target = await resolveActTarget(rec, role, name, nth);
        if (!target.ok) return target.res;
        if (target.candidate.disabled) {
          return disabledRefusal(target.candidate, "focus");
        }
        const result = await rec.session.act({
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
            diffSteer(rec),
        );
      }),
  );

  // ── Sessions (lifecycle view) ────────────────────────────────────────────
  server.registerTool(
    "list_sessions",
    {
      title: "List browser sessions",
      annotations: READ_ONLY,
      description:
        "List every live named browser session: name, current URL (redacted), created/last-used times, and whether a call is running on it right now. Sessions are created lazily by the first tool call that names them and closed by close_browser or the idle timeout (which keeps their checkpoints).",
      // A Zod OBJECT, not the `{}` raw shape: an empty raw shape skips the
      // strictness every other tool's schema carries (additionalProperties:
      // false), and this is exactly the tool an agent will call with
      // `{session: "alpha"}` expecting a filter. A rejected extra property
      // beats one that is silently ignored.
      inputSchema: z.object({}).strict(),
    },
    async () => {
      const sessions = manager.list();
      if (sessions.length === 0) {
        return text(
          "No sessions. The first tool call (e.g. open_page) creates one.",
        );
      }
      const lines = sessions.map(
        (s) =>
          `  ${s.name}: ${s.url ?? "(no page open)"}${s.busy ? " [busy]" : ""} — created ${new Date(s.createdAt).toISOString()}, last used ${new Date(s.lastUsedAt).toISOString()}`,
      );
      return text(`${sessions.length} session(s):\n${lines.join("\n")}`);
    },
  );

  return server;
}
