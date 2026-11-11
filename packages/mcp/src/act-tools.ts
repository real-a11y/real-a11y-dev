/**
 * The act tools: `click_element`, `type_text` and `focus_element`, the write
 * side of the native producer.
 *
 * Moved out of `server.ts`: the schemas and handler bodies are as they were;
 * only the wiring changed, so the per-instance state they used to close over
 * arrives through {@link ActToolContext}. `server.test.ts` covers the tools.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  actFailure,
  describeTarget,
  refuseIfDisabled,
  resolveActTarget,
} from "./act-target.js";
import type { SessionRecord } from "./sessions.js";
import { actName, actNth, actRole, errText, text } from "./tool-output.js";

/** What the act tools borrow from `buildServer`'s closure. */
export interface ActToolContext {
  server: McpServer;
  sessionParam: z.ZodDefault<z.ZodString>;
  withSession: <R>(
    name: string,
    fn: (rec: SessionRecord) => Promise<R>,
  ) => Promise<R | ReturnType<typeof errText>>;
  readTree: (
    rec: SessionRecord,
  ) => ReturnType<SessionRecord["session"]["nativeTree"]>;
}

/**
 * Targets resolve against a FRESH native tree per dispatch (read here, so
 * strict mode applies and a target is aimed at by the name the agent was
 * shown). Node ids never cross the tool boundary, so staleness shrinks to the
 * instant between resolution and dispatch.
 */
const resolveTargetFresh =
  (readTree: ActToolContext["readTree"]) =>
  async (
    rec: SessionRecord,
    role: string,
    name: string | undefined,
    nth: number | undefined,
  ) =>
    resolveActTarget(await readTree(rec), role, name, nth);

// The diff loop is the payoff of acting at all — steer every success to it.
const diffSteer = (rec: SessionRecord) =>
  rec.treeCheckpoint !== undefined
    ? " Call diff_tree to see what this changed."
    : " Tip: call checkpoint_tree before acting, then diff_tree after, to see exactly what an action changed for a screen reader.";

function registerClick(ctx: ActToolContext): void {
  const { server, sessionParam, withSession, readTree } = ctx;
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
          await resolveTargetFresh(readTree)(rec, role, name, nth),
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
}

function registerTypeText(ctx: ActToolContext): void {
  const { server, sessionParam, withSession, readTree } = ctx;
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
          await resolveTargetFresh(readTree)(rec, role, name, nth),
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
}

function registerFocus(ctx: ActToolContext): void {
  const { server, sessionParam, withSession, readTree } = ctx;
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
          await resolveTargetFresh(readTree)(rec, role, name, nth),
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
}

export function registerActTools(ctx: ActToolContext): void {
  registerClick(ctx);
  registerTypeText(ctx);
  registerFocus(ctx);
}
