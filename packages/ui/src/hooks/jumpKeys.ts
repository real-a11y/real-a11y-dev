/**
 * The keyboard path to a tree's `aria-controls` jump chips, which sit outside
 * the Tab order like every row control. One implementation for every tree:
 * {@link useTreeKeyboard} applies it for each panel that mounts the tree (the
 * inspector, the Storybook addon, the Chrome extension's DOM tree), and the
 * extension's native tree calls it directly, so no two drift apart.
 *
 * - `Alt`+`J` follows the selected row's first `aria-controls` link. Pressed
 *   again while still on that target, it moves on to the origin's next one,
 *   wrapping, so every link a row has is reachable from the keyboard.
 * - `Alt`+`Shift`+`J` on a row a jump landed on goes back to the row the jump
 *   came from. Anywhere else, it goes to the first row that controls this one.
 *
 * @internal — shared with the extension; not a stability promise.
 */

import type { ControlsIndex } from "@real-a11y-dev/core";

/** The two keys, as chip titles name them. */
export const JUMP_KEYS = { forward: "Alt+J", back: "Alt+Shift+J" } as const;

/** Both keys, as a tree's `aria-keyshortcuts` lists them. */
export const JUMP_KEYSHORTCUTS = `${JUMP_KEYS.forward} ${JUMP_KEYS.back}`;

/** A row's jump targets each way: `forward` to the rows it controls,
 *  `reverse` to the rows that control it. */
export type JumpLinks = Pick<ControlsIndex, "forward" | "reverse">;

/** A run of Alt+J presses from one row through the rows it controls. */
export interface JumpCycle {
  /** The row the run started from, where Alt+Shift+J goes back to. */
  origin: string;
  /** Every row `origin` controls that a jump can land on, in order. */
  targets: string[];
  /** Which of `targets` the last press landed on. */
  index: number;
}

/**
 * Alt+J or Alt+Shift+J. Matched on the physical key (`code`), since Option+J
 * types a symbol on a Mac, and on the character too (`key`), so the key
 * labelled J works on a Dvorak or Colemak layout, where Alt leaves it alone.
 * Ctrl or Meta with it is some other shortcut, never a jump.
 */
export function isJumpKey(
  e: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "code" | "key">,
): boolean {
  return (
    e.altKey &&
    !e.ctrlKey &&
    !e.metaKey &&
    (e.code === "KeyJ" || e.key.toLowerCase() === "j")
  );
}

/**
 * Where a jump key goes from `selectedId`, and the cycle after it; `null`
 * when there is nowhere to go. `canLand` says whether a row can take the
 * jump — one no longer in the tree can't.
 */
export function nextJump(
  selectedId: string,
  cycle: JumpCycle | null,
  back: boolean,
  links: JumpLinks,
  canLand: (id: string) => boolean,
): { target: string; cycle: JumpCycle | null } | null {
  const onCycle = cycle !== null && cycle.targets[cycle.index] === selectedId;
  if (back) {
    if (onCycle && canLand(cycle.origin)) {
      return { target: cycle.origin, cycle: null };
    }
    const first = (links.reverse.get(selectedId) ?? []).find(canLand);
    return first === undefined ? null : { target: first, cycle: null };
  }
  if (onCycle) {
    // The origin's links as they are now, not as the cycle began: the DOM
    // tree updates live, so a target may have left the tree, or the origin's
    // `aria-controls` may name different rows.
    const targets = (links.forward.get(cycle.origin) ?? []).filter(canLand);
    const at = targets.indexOf(selectedId);
    if (at !== -1 && targets.length > 1) {
      const index = (at + 1) % targets.length;
      return {
        target: targets[index]!,
        cycle: { origin: cycle.origin, targets, index },
      };
    }
  }
  const targets = (links.forward.get(selectedId) ?? []).filter(canLand);
  if (targets.length === 0) return null;
  return {
    target: targets[0]!,
    cycle: { origin: selectedId, targets, index: 0 },
  };
}
