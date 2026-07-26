/**
 * CDP action backend — the first *write* capability of the native producer.
 *
 * The native producer (`nativeTree`) reads Chromium's own accessibility tree
 * over CDP and gives every node an id derived from its `backendDOMNodeId`:
 * `ax-dom-<n>` when a DOM element backs the AX node (Chromium backs even
 * user-agent-shadow controls, so a `<video controls>`'s scrubber usually has
 * one), or `ax-<n>` when nothing does — a synthesized document root, or an AX
 * node Chromium exposes with no backend DOM node at all. This backend takes
 * such a node id, resolves it back to its DOM element over CDP
 * (`DOM.resolveNode`), and dispatches an action against it
 * (`Runtime.callFunctionOn`) — graduating the Phase-2 spike.
 *
 * It acts only on nodes with a backing DOM element (`ax-dom-<n>`). A node with
 * none can't be resolved, so it's rejected rather than guessed at.
 *
 * The code that actually runs in the page lives in `./page-actions.ts` and is
 * sent as `String(fn)` — see that module for why those functions are written
 * self-contained, and for how they stay in step with core's `ActionDispatcher`.
 *
 * ## Safety
 *
 * This writes to a live page, so it holds to the producer's redaction
 * discipline (R1): an {@link ActionResult} never carries the value typed into a
 * field, nor any of the field's content. The in-page function returns only a
 * structural `{ ok, reason? }`; the typed text and the element's `.value` never
 * cross back to Node. Errors are generic and never embed page text.
 */

import type {
  ActionRequest,
  ActionResult,
  ActionType,
} from "@real-a11y-dev/core";
import type { CDPSession } from "playwright";

import { pageClick, pageFocus, pageType } from "./page-actions.js";
import type { PageActionMarker } from "./page-actions.js";

/** Actions this backend can dispatch today. Others are rejected, not guessed. */
const SUPPORTED_ACTIONS: ReadonlySet<ActionType> = new Set<ActionType>([
  "click",
  "type",
  "focus",
]);

/**
 * Parse a native node id (`ax-dom-<n>`) to its `backendDOMNodeId`. Returns
 * `null` for `ax-<n>` (no backing DOM element) or any unrecognized shape.
 */
export function backendNodeIdFrom(nodeId: string): number | null {
  const match = /^ax-dom-(\d+)$/.exec(nodeId);
  return match ? Number(match[1]) : null;
}

/**
 * Dispatch actions against nodes read from the native AX tree, over an
 * already-open CDP session. Nodes with no backing DOM element (`ax-<n>`) are
 * refused; sensitive field content never crosses back to Node.
 */
export class CdpActionBackend {
  constructor(private readonly client: CDPSession) {}

  async dispatch(request: ActionRequest): Promise<ActionResult> {
    if (!SUPPORTED_ACTIONS.has(request.action)) {
      return {
        success: false,
        error: `the native action backend does not support "${request.action}" yet (supported: ${[...SUPPORTED_ACTIONS].join(", ")})`,
      };
    }

    const backendNodeId = backendNodeIdFrom(request.nodeId);
    if (backendNodeId === null) {
      return {
        success: false,
        error: `node "${request.nodeId}" has no backing DOM element — it can't be acted on (e.g. a synthesized document root)`,
      };
    }

    const objectId = await this.resolveObjectId(backendNodeId);
    if (objectId === null) {
      return {
        success: false,
        // The DOM node is gone (the tree was read before a mutation) — a stale
        // id, not page content.
        error: `could not resolve node "${request.nodeId}" to a live DOM element — re-read the tree and retry`,
      };
    }

    switch (request.action) {
      case "click":
        return this.click(objectId);
      case "focus":
        return this.focus(objectId);
      case "type":
        return this.type(objectId, request.payload);
      /* c8 ignore next 2 -- SUPPORTED_ACTIONS guards this exhaustively */
      default:
        return { success: false, error: `unsupported action` };
    }
  }

  /** backendDOMNodeId → a Runtime object handle, or null if the node is gone. */
  private async resolveObjectId(backendNodeId: number): Promise<string | null> {
    try {
      // DOM must be enabled before backend node ids resolve.
      await this.client.send("DOM.enable");
      const resolved = (await this.client.send("DOM.resolveNode", {
        backendNodeId,
      })) as { object?: { objectId?: string } };
      return resolved.object?.objectId ?? null;
    } catch {
      return null;
    }
  }

  private async click(objectId: string): Promise<ActionResult> {
    try {
      const res = (await this.client.send("Runtime.callFunctionOn", {
        objectId,
        // Returns only a structural marker — never page text.
        functionDeclaration: String(pageClick),
        returnByValue: true,
      })) as { result?: { value?: PageActionMarker } };
      return toResult(res.result?.value);
    } catch (err) {
      return { success: false, error: cdpError(err) };
    }
  }

  private async focus(objectId: string): Promise<ActionResult> {
    try {
      const res = (await this.client.send("Runtime.callFunctionOn", {
        objectId,
        // `inputType` (a field's `type` attribute, e.g. "email") is structural,
        // not the field's value — safe to return. `requiresInput` mirrors core's
        // ActionDispatcher so a caller knows a `type` should follow.
        functionDeclaration: String(pageFocus),
        returnByValue: true,
      })) as { result?: { value?: PageActionMarker } };
      return toResult(res.result?.value);
    } catch (err) {
      return { success: false, error: cdpError(err) };
    }
  }

  private async type(
    objectId: string,
    payload: ActionRequest["payload"],
  ): Promise<ActionResult> {
    const value =
      typeof payload?.value === "string" ? payload.value : undefined;
    if (value === undefined) {
      return {
        success: false,
        error: `the "type" action requires a string payload.value`,
      };
    }
    try {
      const res = (await this.client.send("Runtime.callFunctionOn", {
        objectId,
        // Mirrors core's ActionDispatcher: the prototype value setter + input/
        // change events, so framework-controlled inputs (React et al.) see it.
        // Crucially, the return value is structural only — the typed text and
        // the resulting `.value` NEVER cross back to Node.
        functionDeclaration: String(pageType),
        arguments: [{ value }],
        returnByValue: true,
      })) as { result?: { value?: PageActionMarker } };
      return toResult(res.result?.value);
    } catch (err) {
      return { success: false, error: cdpError(err) };
    }
  }
}

/** Map the in-page `{ ok, reason?, ... }` marker to an {@link ActionResult}. */
function toResult(marker: PageActionMarker | undefined): ActionResult {
  if (marker?.ok) {
    return {
      success: true,
      ...(marker.requiresInput ? { requiresInput: true } : {}),
      ...(marker.inputType ? { inputType: marker.inputType } : {}),
    };
  }
  return { success: false, error: marker?.reason ?? "action failed" };
}

/**
 * A CDP error message can quote page state, so never surface it verbatim.
 * Keep a stable, content-free string.
 */
function cdpError(_err: unknown): string {
  return "the action could not be dispatched over CDP";
}
