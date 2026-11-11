/**
 * The read-only inspection tools: `audit_page`, `inspect_page`,
 * `get_semantic_tree`, `get_heading_outline`, `get_tab_order` and
 * `list_elements`.
 *
 * Moved out of `server.ts`: the schemas and handler bodies are as they were;
 * only the wiring changed, so the per-instance state they used to close over
 * arrives through {@link InspectToolContext}. `server.test.ts` covers the tools.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listByRole } from "@real-a11y-dev/audit";
import type { A11yRule, RoleFilter } from "@real-a11y-dev/audit";
import { numberTabStops } from "@real-a11y-dev/serialize";
import { projectNativeTree } from "@real-a11y-dev/snapshot";
import { z } from "zod";

import { renderAudit, renderSnapshot } from "./render.js";
import type { SessionRecord } from "./sessions.js";
import {
  errText,
  READ_ONLY,
  rootSelector,
  RULES_HINT,
  SCOPE_HINT,
  SLICE_HINT,
  text,
} from "./tool-output.js";

/** What the inspection tools borrow from `buildServer`'s closure. */
export interface InspectToolContext {
  server: McpServer;
  /** The `rules` enum source, built from the audit package's rule list. */
  rules: [A11yRule, ...A11yRule[]];
  redactInput: boolean;
  liveValues: boolean;
  /** Describes what a field's value shows, appended to tree-reading tools. */
  valuesNote: string;
  sessionParam: z.ZodDefault<z.ZodString>;
  withSession: <R>(
    name: string,
    fn: (rec: SessionRecord) => Promise<R>,
  ) => Promise<R | ReturnType<typeof errText>>;
  readTree: (
    rec: SessionRecord,
  ) => ReturnType<SessionRecord["session"]["nativeTree"]>;
}

function registerAudit(ctx: InspectToolContext): void {
  const { server, rules: RULES, sessionParam, withSession, readTree } = ctx;
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
}

function registerInspect(ctx: InspectToolContext): void {
  const {
    server,
    rules: RULES,
    liveValues,
    valuesNote,
    sessionParam,
    withSession,
    readTree,
  } = ctx;
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
}

function registerSemanticTree(ctx: InspectToolContext): void {
  const {
    server,
    liveValues,
    valuesNote,
    sessionParam,
    withSession,
    readTree,
  } = ctx;
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
}

function registerHeadingOutline(ctx: InspectToolContext): void {
  const { server, sessionParam, withSession, readTree } = ctx;
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
}

function registerTabOrder(ctx: InspectToolContext): void {
  const { server, redactInput, liveValues, sessionParam, withSession } = ctx;
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
}

function registerListElements(ctx: InspectToolContext): void {
  const {
    server,
    redactInput,
    liveValues,
    sessionParam,
    withSession,
    readTree,
  } = ctx;
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
}

export function registerInspectTools(ctx: InspectToolContext): void {
  registerAudit(ctx);
  registerInspect(ctx);
  registerSemanticTree(ctx);
  registerHeadingOutline(ctx);
  registerTabOrder(ctx);
  registerListElements(ctx);
}
