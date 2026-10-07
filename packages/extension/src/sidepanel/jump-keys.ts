/**
 * Alt+J / Alt+Shift+J: the keyboard path to a row's `aria-controls` jump
 * chips, which sit outside the Tab order like every row control. Pure, so
 * each tree keeps only its own "reveal this row" step.
 */

/** A run of Alt+J presses from one row through the rows it controls. */
export interface JumpCycle {
  /** The row the run started from, where Alt+Shift+J goes back to. */
  origin: string;
  /** Every row `origin` controls, in order. */
  targets: string[];
  /** Which of `targets` the last press landed on. */
  index: number;
}

/**
 * Alt+J or Alt+Shift+J. Matched on the physical key (`code`), since Option+J
 * types a symbol on a Mac, and on the character too (`key`), so the key
 * labelled J works on a Dvorak or Colemak layout, where Alt leaves it alone.
 */
export function isJumpKey(e: KeyboardEvent): boolean {
  return (
    e.altKey &&
    !e.ctrlKey &&
    !e.metaKey &&
    (e.code === "KeyJ" || e.key.toLowerCase() === "j")
  );
}

/**
 * Where a jump key goes from `selectedId`, and the cycle after it.
 *
 * - **Alt+J** follows the row's first `aria-controls` link. Pressed again
 *   while still on that target, it moves on to the origin's next one,
 *   wrapping, so every link a row has is reachable from the keyboard.
 * - **Alt+Shift+J** on a row a jump landed on goes back to the row the jump
 *   came from. Anywhere else, it goes to the first row that controls this one.
 *
 * Null when there is nowhere to go.
 */
export function nextJump(
  selectedId: string,
  cycle: JumpCycle | null,
  back: boolean,
  controlsOf: (id: string) => string[],
  controlledBy: (id: string) => string[],
): { target: string; cycle: JumpCycle | null } | null {
  const onCycle = cycle !== null && cycle.targets[cycle.index] === selectedId;
  if (back) {
    if (onCycle) return { target: cycle.origin, cycle: null };
    const first = controlledBy(selectedId)[0];
    return first === undefined ? null : { target: first, cycle: null };
  }
  if (onCycle && cycle.targets.length > 1) {
    const index = (cycle.index + 1) % cycle.targets.length;
    return { target: cycle.targets[index]!, cycle: { ...cycle, index } };
  }
  const targets = controlsOf(selectedId);
  if (targets.length === 0) return null;
  return {
    target: targets[0]!,
    cycle: { origin: selectedId, targets, index: 0 },
  };
}
