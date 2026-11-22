import {
  ACTION_LABELS,
  isChoiceState,
  type ActionType,
} from "@real-a11y-dev/core";

/** What the feedback line needs to know about the node an action landed on,
 *  as it was BEFORE the action. */
export interface FeedbackTarget {
  role: string;
  /** The node's name, or whatever stands in for one; never its id. */
  name: string;
  /** Its `checked` state, so a checked checkbox reads "Unchecked". */
  checked?: string | boolean;
  /** Its states, when `checked` isn't given: a TAB row's. */
  states?: Readonly<Record<string, unknown>>;
  /** Whether the tree withholds its choice, set inside a sensitive field and
   *  where its choice is made: a native row's own `valueWithheld`, a TAB
   *  row's from the content script's reply (`dispatchTabAction`). */
  valueWithheld?: boolean;
}

/**
 * The item the action landed on is one whose choice the tree withholds (a
 * choice item, core's `isChoiceState`, in a sensitive field's popup,
 * ADR-0001): naming the item a user picked says what the field holds. Only
 * the row's verdict says so (`valueWithheld`): a missing state can't, since
 * an option or tree item often carries none.
 */
function choiceWithheld({ role, valueWithheld }: FeedbackTarget) {
  return isChoiceState("checked", role) && valueWithheld === true;
}

/**
 * The feedback line after an option is chosen in a select: the option, or,
 * for a field whose value is withheld (a sensitive select, ADR-0001), only
 * the field — which option was chosen IS the value. Shared by the tree and
 * the TAB view's rows.
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

/**
 * The action-feedback line for an action that landed on the page, in one
 * wording for the tree and the TAB view: a TAB row's `handleActivate` and the
 * native tree's `nativeActionFeedback` both call it, so the two can't drift
 * apart.
 *
 * A checkbox or switch says what it became, read from the state it had
 * before. A mixed one gets the plain label: a click checks or unchecks it by
 * a checkedness "mixed" hides, so the tree can't say which. A radio says
 * "Selected". A choice item whose choice is withheld names only that a choice
 * was made ({@link describeSelection}). Anything else says the action's label
 * ("Click", "Navigate").
 *
 * Null for a slider or spinbutton step: the value changing on the page is
 * the confirmation, and a banner flashing on every rapid step would push the
 * tree around under the pointer.
 */
export function describeAction(
  target: FeedbackTarget,
  action: ActionType,
): string | null {
  const { role, name } = target;
  const checked = target.checked ?? target.states?.["checked"];
  if (action === "increment" || action === "decrement") return null;
  if (action === "type") return `Typed in ${name}`;
  if (choiceWithheld(target))
    return describeSelection("this field", name, true);
  if (action === "select") return `Selected: ${name}`;
  if ((role === "checkbox" || role === "switch") && checked !== "mixed") {
    return checked === true ? `Unchecked: ${name}` : `Checked: ${name}`;
  }
  if (role === "radio") return `Selected: ${name}`;
  return `${ACTION_LABELS[action]}: ${name}`;
}
