import {
  ActionDispatcher,
  getElementRefs,
  getPrimaryAction,
  type ActionRequest,
  type ActionResult,
  type ActionType,
  type SemanticNode,
} from "@real-a11y-dev/core";

/**
 * Dispatch an action on a node.
 *
 * Uses the shared `ElementRefMap` populated by the most recent extraction —
 * call one of `extractDomTree` / `extractA11yTree` (or any of the helper
 * snapshots) before dispatching so the node's real DOM element is registered.
 *
 * If `action` is omitted the node's primary action is used.
 */
export async function dispatch(
  node: SemanticNode,
  action?: ActionType,
  payload?: Record<string, unknown>,
): Promise<ActionResult> {
  const refs = getElementRefs();
  const dispatcher = new ActionDispatcher(refs);

  const chosen = action ?? getPrimaryAction(node.interaction?.actions ?? []);
  if (!chosen) {
    return {
      success: false,
      error: `Node has no dispatchable action (role=${node.a11y.role}).`,
    };
  }

  const request: ActionRequest = {
    nodeId: node.id,
    action: chosen,
    ...(payload ? { payload } : {}),
  };
  return dispatcher.dispatch(request);
}
