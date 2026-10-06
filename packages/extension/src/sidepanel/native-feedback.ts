import type { NativeNode } from "../native/native-actions.js";
import type { NativeAction } from "../native/native-core.js";

import { describeAction } from "./action-feedback.js";

/**
 * The action-feedback line for a native action that landed, worded by the
 * same `describeAction` as the DOM tree's. A native click on a link is that
 * link's navigation, which the DOM tree words as "Navigate"; a reveal is a
 * focus.
 *
 * `node` is the node as it was BEFORE the action, so a checkbox that was
 * checked reads "Unchecked". Null for a slider or spinbutton step.
 */
export function nativeActionFeedback(
  node: NativeNode | undefined,
  action: NativeAction,
): string | null {
  const role = node?.role ?? "";
  return describeAction(
    {
      role,
      name: node?.name || node?.role || "element",
      checked: node?.states?.["checked"],
    },
    action === "reveal"
      ? "focus"
      : action === "click" && role === "link"
        ? "navigate"
        : action,
  );
}

/**
 * The open modal dialog in a native tree, if there is one — what the DOM tree
 * shows as its dialog indicator. Chromium marks a modal `<dialog>` (and an
 * `aria-modal` one) with the `modal` state. The first one the read listed.
 */
export function findNativeModalDialog(
  nodes: Map<string, NativeNode>,
): NativeNode | undefined {
  for (const node of nodes.values()) {
    if (
      (node.role === "dialog" || node.role === "alertdialog") &&
      node.states?.["modal"] === true
    ) {
      return node;
    }
  }
  return undefined;
}
