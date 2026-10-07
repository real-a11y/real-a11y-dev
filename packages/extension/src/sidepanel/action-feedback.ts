import { ACTION_LABELS, type ActionType } from "@real-a11y-dev/core";

/** What the feedback line needs to know about the node an action landed on,
 *  as it was BEFORE the action. */
export interface FeedbackTarget {
  role: string;
  /** The node's name, or whatever stands in for one; never its id. */
  name: string;
  /** Its `checked` state, so a checked checkbox reads "Unchecked". */
  checked?: string | boolean;
}

/**
 * The action-feedback line for an action that landed on the page, in one
 * wording for both trees: the DOM tree's `handleActivate` and the native
 * tree's `nativeActionFeedback` both call it, so the two can't drift apart.
 *
 * A checkbox or switch says what it became, read from the state it had
 * before. A mixed one gets the plain label: a click checks or unchecks it by
 * a checkedness "mixed" hides, so the tree can't say which. A radio says
 * "Selected". Anything else says the action's label ("Click", "Navigate").
 *
 * Null for a slider or spinbutton step: the value changing on the page is
 * the confirmation, and a banner flashing on every rapid step would push the
 * tree around under the pointer.
 */
/**
 * The feedback line after an option is chosen in a select: the option, or,
 * for a field whose value is withheld (a sensitive select, ADR-0001), only
 * the field — which option was chosen IS the value. Shared by both trees.
 */
export function describeSelection(
  field: string,
  option: string,
  valueWithheld: boolean,
): string {
  return valueWithheld
    ? `Selected an option in ${field}`
    : `Selected: ${option}`;
}

export function describeAction(
  { role, name, checked }: FeedbackTarget,
  action: ActionType,
): string | null {
  if (action === "increment" || action === "decrement") return null;
  if (action === "type") return `Typed in ${name}`;
  if (action === "select") return `Selected: ${name}`;
  if ((role === "checkbox" || role === "switch") && checked !== "mixed") {
    return checked === true ? `Unchecked: ${name}` : `Checked: ${name}`;
  }
  if (role === "radio") return `Selected: ${name}`;
  return `${ACTION_LABELS[action]}: ${name}`;
}
