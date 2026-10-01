import { ACTION_LABELS } from "@real-a11y-dev/core";

import type { NativeNode } from "../native/native-actions.js";
import type { NativeAction } from "../native/native-core.js";

/**
 * The action-feedback line for a native action that landed, in the words the
 * DOM tree uses for its own (`App.tsx`'s `handleActivate` and
 * `handleInputSubmit`): the node's name, never its id.
 *
 * `node` is the node as it was BEFORE the action, so a checkbox that was
 * checked reads "Unchecked". Null for a slider or spinbutton step: as in the
 * DOM tree, the value changing on the page is the confirmation, and a banner
 * flashing on every rapid step would push the tree around under the pointer.
 */
export function nativeActionFeedback(
  node: NativeNode | undefined,
  action: NativeAction,
): string | null {
  if (action === "increment" || action === "decrement") return null;
  const name = node?.name || node?.role || "element";
  switch (action) {
    case "type":
      return `Typed in ${name}`;
    case "select":
      return `Selected: ${name}`;
    case "focus":
    case "reveal":
      return `${ACTION_LABELS.focus}: ${name}`;
  }
  const role = node?.role;
  if (role === "checkbox" || role === "switch" || role === "menuitemcheckbox") {
    return node?.states?.["checked"] === true
      ? `Unchecked: ${name}`
      : `Checked: ${name}`;
  }
  if (role === "radio" || role === "menuitemradio") return `Selected: ${name}`;
  return `${ACTION_LABELS.click}: ${name}`;
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
