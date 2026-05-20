import type { ActionType } from "../types.js";

/** Human-readable labels for action types */
export const ACTION_LABELS: Record<ActionType, string> = {
  click: "Click",
  focus: "Focus",
  type: "Type",
  submit: "Submit",
  navigate: "Navigate",
  toggle: "Toggle",
  select: "Select",
  scroll: "Scroll",
  increment: "Increment",
  decrement: "Decrement",
};

/** Get the primary action for a list of available actions */
export function getPrimaryAction(actions: ActionType[]): ActionType | null {
  if (actions.length === 0) return null;

  // Priority order: navigate > click > submit > toggle > select > increment > type > focus > scroll
  // "select" before "focus" so native <select> shows "Select" not "Focus".
  // "increment" before "type"/"focus" so slider/spinbutton rows surface
  // the value-adjust action (▲/▼) as the primary affordance — the panel
  // pairs increment with decrement when both are present.
  const priority: ActionType[] = [
    "navigate",
    "click",
    "submit",
    "toggle",
    "select",
    "increment",
    "type",
    "focus",
    "scroll",
  ];

  for (const action of priority) {
    if (actions.includes(action)) return action;
  }

  return actions[0];
}
