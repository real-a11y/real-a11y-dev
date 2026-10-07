import {
  nativeSelectOptions,
  type NativeNode,
} from "../native/native-actions.js";
import type { NativeAction } from "../native/native-core.js";

import { describeAction, describeSelection } from "./action-feedback.js";

/**
 * The action-feedback line for a native action that landed, worded by the
 * same `describeAction` as the DOM tree's. A native click on a link is that
 * link's navigation, which the DOM tree words as "Navigate"; a reveal is a
 * focus.
 *
 * `node` is the node as it was BEFORE the action, so a checkbox that was
 * checked reads "Unchecked". Null for a slider or spinbutton step.
 *
 * Selecting an option row names the option only when its field's value
 * isn't withheld ({@link selectFeedback}): which option was chosen in a
 * sensitive select IS its value. `nodes` is the tree, to find that field.
 */
export function nativeActionFeedback(
  node: NativeNode | undefined,
  action: NativeAction,
  nodes?: ReadonlyMap<string, NativeNode>,
): string | null {
  if (action === "select" && node?.role === "option") {
    return selectFeedback(node, nodes);
  }
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

/**
 * The feedback for selecting `option` straight from its row, worded as the
 * picker words it (`describeSelection`): the option, or, when the field's
 * value is withheld, only the field. A drop-down's options take the select's
 * classification, and fail closed: only a select classified as not
 * sensitive names its option, as `pickerCurrentOption` marks one. An option
 * outside any drop-down (a list box's) names itself unless it sits inside a
 * sensitive field. A redaction gate — `scripts/pr-risk.mjs` lists it.
 */
export function selectFeedback(
  option: NativeNode,
  nodes?: ReadonlyMap<string, NativeNode>,
): string {
  let select: NativeNode | undefined;
  for (const candidate of nodes?.values() ?? []) {
    if (
      candidate.role === "combobox" &&
      nativeSelectOptions(candidate, nodes as Map<string, NativeNode>).some(
        (o) => o.id === option.id,
      )
    ) {
      select = candidate;
      break;
    }
  }
  const withheld = select
    ? select.valueWithheld !== false
    : option.valueWithheld === true;
  return describeSelection(
    select?.name || select?.role || "this field",
    option.name || "option",
    withheld,
  );
}
