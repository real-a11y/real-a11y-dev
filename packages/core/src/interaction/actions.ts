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
};

/** Get the primary action for a list of available actions */
export function getPrimaryAction(actions: ActionType[]): ActionType | null {
  if (actions.length === 0) return null;

  // Priority order: navigate > click > submit > toggle > select > type > focus > scroll
  // "select" comes before "focus" so native <select> elements show "Select" not "Focus"
  const priority: ActionType[] = [
    "navigate",
    "click",
    "submit",
    "toggle",
    "select",
    "type",
    "focus",
    "scroll",
  ];

  for (const action of priority) {
    if (actions.includes(action)) return action;
  }

  return actions[0];
}
