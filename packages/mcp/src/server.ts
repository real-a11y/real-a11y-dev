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
import type { A11yRule, RoleFilter } from "@real-a11y-dev/audit";
import type { A11ySession } from "@real-a11y-dev/browser";
import { numberTabStops } from "@real-a11y-dev/serialize";
import { projectNativeTree, redactUrl } from "@real-a11y-dev/snapshot";
import { z } from "zod";

import {
  actFailure,
  describeTarget,
  refuseIfDisabled,
  resolveActTarget,
} from "./act-target.js";
import { registerCheckpointTools } from "./checkpoint-tools.js";
import type { CheckpointStore } from "./checkpoints.js";
import { renderAudit, renderSnapshot } from "./render.js";
import {
  serverInstructions,
  serverNotes,
  sessionErrText,
} from "./server-text.js";
import {
  DEFAULT_SESSION,
  singleSessionManager,
  type SessionManager,
  type SessionRecord,
} from "./sessions.js";
import {
  actName,
  actNth,
  actRole,
  errText,
  pageTitle,
  READ_ONLY,
  rootSelector,
  RULES_HINT,
  SCOPE_HINT,
  SLICE_HINT,
  text,
} from "./tool-output.js";

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

export { renderAudit, renderSnapshot } from "./render.js";

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
  /**
   * Strict mode (`REAL_A11Y_REDACT_INPUT=1`, ADR-0001's `redactInput`): no
   * field value and no rich-text editor content in any result. Off by
   * default: the live reads show what each field holds the way a screen
   * reader announces it, with sensitive fields (`type="password"`, a
   * credential or payment `autocomplete`) as `[redacted]`.
   */
  redactInput?: boolean;
}

/**
 * Build the MCP server and register every tool against the given session.
 * The session is injected so the server can be exercised in tests with a fake
 * (no browser); production wires in a real {@link BrowserSession}.
 */
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
  // What users entered into the page (ADR-0001). Every tree read goes through
  // `readTree`, so strict mode can't be forgotten at one call site; the live
  // views print values unless it is on. Persisted outputs (checkpoints, their
  // export) take their own opt-in `values` parameter.
  const redactInput = options.redactInput === true;
  const liveValues = !redactInput;
  const readTree = (rec: SessionRecord) =>
    rec.session.nativeTree({ redactInput });
  const { valuesNote, browserMode, authNote } = serverNotes({
    redactInput,
    cdpAttached,
    headful,
    authenticated,
  });
  const server = new McpServer(
    {
      name: "real-a11y",
      title: "Real A11y — accessibility audits",
      version: packageVersion(),
    },
    {
      instructions: serverInstructions(multiSession),
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
        "Run accessibility audits against the current page and return every violation — unlabeled interactive controls, form controls labeled only by title or aria-describedby, skipped heading levels or missing/duplicate h1, unlabeled dialogs, and broken landmark structure. Empty-name findings are what assistive tech would announce as unnamed; label-title-only is the axe-core best-practice extra (title still is a name). This is the primary tool. Audits Chromium's own accessibility tree, so it reaches structure no in-page walk can (a `<video controls>`'s user-agent-shadow media controls); findings carry CSS locators. Whole-document. Chromium only.",
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
        const snap = projectNativeTree(await readTree(rec), {
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
        "Return the audit findings AND the semantic tree and heading outline — all derived from ONE read of Chromium's accessibility tree, so they are guaranteed internally consistent. The element focused at capture time is marked `[focused]`." +
        valuesNote +
        " Prefer this over separate audit_page + get_* calls on dynamic pages (SPAs, pages with consent dialogs) where separate calls could catch different states. That tree carries no tab order, so there is no tab-order section here — call get_tab_order for the keyboard sequence. Whole-document. Chromium only.",
      inputSchema: {
        rules: z
          .array(z.enum(RULES))
          .optional()
          .describe("Subset of rules for the findings. Omit to run all."),
        includeGeneric: z
          .boolean()
          .default(false)
          .describe(
            "Include generic container nodes in the tree, among them a block of text, named from its own text.",
          ),
        session: sessionParam,
      },
    },
    async ({ rules, includeGeneric, session }) =>
      withSession(session, async (rec) => {
        const snap = projectNativeTree(await readTree(rec), {
          rules,
          includeGeneric,
          values: liveValues,
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
        "Return the page's accessibility tree as a deterministic, indented role + accessible-name outline (what a screen reader would traverse) — read from Chromium's own accessibility tree over CDP, so it reaches user-agent-shadow media controls an in-page walk never sees. The element focused at capture time is marked `[focused]`." +
        valuesNote +
        " Token-efficient and stable across runs. This is the vocabulary the act tools target in. Whole-document. Chromium only.",
      inputSchema: {
        includeGeneric: z
          .boolean()
          .default(false)
          .describe(
            "Include generic container nodes (role=generic), among them a block of text, named from its own text.",
          ),
        session: sessionParam,
      },
    },
    async ({ includeGeneric, session }) =>
      withSession(session, async (rec) => {
        const snap = projectNativeTree(await readTree(rec), {
          includeGeneric,
          values: liveValues,
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
        const snap = projectNativeTree(await readTree(rec));
        return text(snap.outline);
      }),
  );

  server.registerTool(
    "get_tab_order",
    {
      title: "Get tab order",
      annotations: READ_ONLY,
      description:
        "Return the focusable elements in the order a keyboard user encounters them when pressing Tab, numbered, with role + accessible name. The stop focused at capture time is marked `[focused]`." +
        (redactInput
          ? " In this server's strict mode no stop shows a field value."
          : ' A field shows what it holds (`textbox "Email" = "jane@x.com"`; a sensitive field "[redacted]").') +
        " Built from the in-page DOM walk — Chromium's accessibility tree knows whether a node is focusable but not the SEQUENCE (tabindex never reaches it), so this is the only source for tab order, and the one tool `rootSelector` still scopes.",
      inputSchema: { rootSelector, session: sessionParam },
    },
    async ({ rootSelector, session }) =>
      withSession(session, async (rec) => {
        const seq = await rec.session.call<string>(
          "tabSequenceSnapshot",
          rootSelector,
          [{ values: liveValues }],
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
        "List every element of one category — links, buttons, form controls, landmarks, images, or headings — as role + accessible name + a CSS locator" +
        (redactInput
          ? ""
          : ', and for a form field what it holds (a sensitive one "[redacted]")') +
        ". A token-efficient way to review one kind of element (e.g. 'images' pairs with the image-alt rule, 'form' with labeling). Listed from Chromium's own accessibility tree, so it agrees node for node with get_semantic_tree and audit_page. Whole-document. Chromium only.",
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
          listByRole(await readTree(rec), filter as RoleFilter, {
            values: liveValues,
          }),
        );
      }),
  );

  // ── Checkpoints (findings diff, export / import, interaction diff) ───────
  registerCheckpointTools({
    server,
    rules: RULES,
    version: packageVersion(),
    redactInput,
    liveValues,
    sessionParam,
    withSession,
    withCheckpoints,
    readTree,
    pageUrl,
  });

  // ── Act (the write side of the native producer) ──────────────────────────
  // Targets resolve against a FRESH native tree per dispatch, so node ids
  // never cross the tool boundary and staleness shrinks to the instant
  // between resolution and dispatch.
  // Targets resolve against a FRESH native tree per dispatch (read here, so
  // strict mode applies and a target is aimed at by the name the agent was
  // shown).
  const resolveTargetFresh = async (
    rec: SessionRecord,
    role: string,
    name: string | undefined,
    nth: number | undefined,
  ) => resolveActTarget(await readTree(rec), role, name, nth);

  // The diff loop is the payoff of acting at all — steer every success to it.
  const diffSteer = (rec: SessionRecord) =>
    rec.treeCheckpoint !== undefined
      ? " Call diff_tree to see what this changed."
      : " Tip: call checkpoint_tree before acting, then diff_tree after, to see exactly what an action changed for a screen reader.";

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
        const target = refuseIfDisabled(
          await resolveTargetFresh(rec, role, name, nth),
          "click",
        );
        if (!target.ok) return target.res;
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
        "Set the value of the text field matched by role + accessible name in the native accessibility tree (role is usually 'textbox', 'searchbox', or 'combobox'). REPLACES the field's current value — via the prototype value setter plus input/change events, so framework-controlled inputs (React et al.) register it. The result NEVER echoes the typed text or any field content; diff_tree afterwards shows what the field holds the way a screen reader announces it (a sensitive field as \"[redacted]\"; nothing at all when the server runs with REAL_A11Y_REDACT_INPUT=1). There is deliberately NO credential parameter and this tool must NOT be used to log in — a password or token typed here would enter the agent's context; for pages behind auth the user starts the server with REAL_A11Y_MCP_STORAGE_STATE or REAL_A11Y_MCP_CDP instead. Pair with checkpoint_tree / diff_tree to see what the input changed (a combobox popping options, an inline error appearing). Chromium only.",
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
        const target = refuseIfDisabled(
          await resolveTargetFresh(rec, role, name, nth),
          "input",
        );
        if (!target.ok) return target.res;
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
        const target = refuseIfDisabled(
          await resolveTargetFresh(rec, role, name, nth),
          "focus",
        );
        if (!target.ok) return target.res;
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
      // A strict Zod OBJECT, not the `{}` raw shape: the SDK wraps a raw shape
      // in a non-strict object that drops unknown keys (the other tools rely on
      // that, so a stale `rootSelector` from an older client still works), and
      // this is exactly the tool an agent will call with `{session: "alpha"}`
      // expecting a filter. A rejected extra property beats one that is
      // silently ignored.
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
