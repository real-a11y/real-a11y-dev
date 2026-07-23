/**
 * APG-style first-character / multi-character type-ahead for composite widgets
 * (tree, listbox). See https://www.w3.org/WAI/ARIA/apg/patterns/treeview/
 *
 * Typing printable characters moves selection to the next item whose label
 * starts with the typed buffer. Keys pressed within {@link TYPE_AHEAD_TIMEOUT_MS}
 * append to the buffer; after the timeout the buffer resets. Repeating the
 * same character cycles through matches for that character (so `b` `b` visits
 * every item starting with "b", not items starting with "bb").
 *
 * @internal Shared with the Chrome extension's forked listboxes. Not part of
 * the versioned public API — see docs/STABILITY.md.
 */

/** @internal */
export const TYPE_AHEAD_TIMEOUT_MS = 500;

/** @internal */
export interface TypeAheadBuffer {
  /** Append a character, reset the idle timer, return the current buffer. */
  push(char: string): string;
  /** Clear the buffer and cancel the idle timer. */
  clear(): void;
  /** Current buffer contents (lowercase). */
  get(): string;
}

/** @internal */
export function createTypeAheadBuffer(
  timeoutMs: number = TYPE_AHEAD_TIMEOUT_MS,
): TypeAheadBuffer {
  let buffer = "";
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = () => {
    buffer = "";
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    push(char: string): string {
      buffer += char.toLowerCase();
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(clear, timeoutMs);
      return buffer;
    },
    clear,
    get: () => buffer,
  };
}

/** @internal True for a single printable key with no ctrl/alt/meta modifier. */
export function isTypeAheadKey(e: KeyboardEvent): boolean {
  return (
    e.key.length === 1 &&
    !e.ctrlKey &&
    !e.altKey &&
    !e.metaKey &&
    // Space is reserved for toggle/activate in tree/listbox patterns.
    e.key !== " "
  );
}

/**
 * Index of the next label matching `buffer`, wrapping around the list.
 * Returns `-1` when nothing matches.
 *
 * Search start follows APG type-ahead:
 * - First character, or a same-letter cycle (`bbb` → treat as `b`): start
 *   after `currentIndex` so repeated keys visit successive matches.
 * - Multi-character prefix (`ap`, `blu`): start at `currentIndex` inclusive
 *   so refining a prefix keeps a still-matching selection instead of
 *   flickering through other matches (and re-highlighting the host page).
 *
 * @internal
 */
export function findTypeAheadIndex(
  labels: readonly string[],
  buffer: string,
  currentIndex: number,
): number {
  if (!buffer || labels.length === 0) return -1;

  const sameLetterCycle =
    buffer.length > 1 && [...buffer].every((c) => c === buffer[0]);
  const needle = sameLetterCycle ? buffer[0] : buffer;
  const advancePastCurrent = buffer.length === 1 || sameLetterCycle;

  const start =
    currentIndex < 0
      ? 0
      : advancePastCurrent
        ? (currentIndex + 1) % labels.length
        : currentIndex;
  for (let i = 0; i < labels.length; i++) {
    const idx = (start + i) % labels.length;
    if (labels[idx].toLowerCase().startsWith(needle)) return idx;
  }
  return -1;
}
