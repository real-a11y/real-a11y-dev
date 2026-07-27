import type { ActionType } from "@real-a11y-dev/core";

/**
 * Map a keypress to a slider/spinbutton step when the selected node supports
 * it. The ▼/▲ pair in the tree is `tabIndex={-1}` (mouse-only); without these
 * bindings a keyboard user can only raise the value (Enter → primary
 * `increment`) and never lower it.
 *
 * | Key | Action |
 * |---|---|
 * | `+` / `=` | `increment` when available |
 * | `-` / `_` | `decrement` when available |
 * | `Shift+Enter` | `decrement` when available |
 *
 * Plain `Enter` is intentionally **not** mapped here — callers keep routing
 * it through `getPrimaryAction` so non-stepper nodes still activate normally.
 *
 * @internal Shared with the Chrome extension's forked FilteredList. Not part
 * of the versioned public API — see docs/STABILITY.md.
 */
export function resolveStepperKeyAction(
  e: KeyboardEvent,
  actions: readonly ActionType[],
): ActionType | null {
  if (e.ctrlKey || e.altKey || e.metaKey) return null;

  const hasInc = actions.includes("increment");
  const hasDec = actions.includes("decrement");

  if ((e.key === "+" || e.key === "=") && hasInc) return "increment";
  if ((e.key === "-" || e.key === "_") && hasDec) return "decrement";
  if (e.key === "Enter" && e.shiftKey && hasDec) return "decrement";

  return null;
}
