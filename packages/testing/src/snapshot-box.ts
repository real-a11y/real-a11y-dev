/**
 * The snapshot-serializer box — a tiny branded wrapper around a serialized
 * string so `expect(box).toMatchSnapshot()` / `.toMatchInlineSnapshot()` prints
 * it verbatim through the registered pretty-format plugin, instead of the
 * framework's default object dump.
 *
 * Lives on its own (not in `matchers.ts`) so `a11yDiff` and `boxedTreeSnapshot` can
 * both produce boxes the SAME serializer renders, without the diff/capture API
 * pulling in the jest matcher augmentation or `@real-a11y-dev/validate`.
 *
 * Without the serializer registered, a box still snapshots as its text: its
 * `toJSON` returns it, and pretty-format calls `toJSON` on any value no plugin
 * claims. The text then lands quoted, as a `treeSnapshot` string does, rather
 * than as this object with its brand key, which nothing would flag.
 */

const SNAPSHOT_BRAND = "@real-a11y-dev/a11y-snapshot";

export interface A11ySnapshotBox {
  readonly [SNAPSHOT_BRAND]: true;
  readonly text: string;
  /** The text, for a snapshot taken without the serializer registered. */
  toJSON(): string;
}

/**
 * Every box's `toJSON`: one shared function, and not enumerable, so two boxes
 * holding the same text stay `toEqual` and list the same keys.
 */
function boxText(this: A11ySnapshotBox): string {
  return this.text;
}

/** Wrap a pre-serialized string as a snapshot box. */
export function boxSnapshot(text: string): A11ySnapshotBox {
  return Object.defineProperty({ [SNAPSHOT_BRAND]: true, text }, "toJSON", {
    value: boxText,
  }) as A11ySnapshotBox;
}

/**
 * pretty-format plugin recognised by both Jest and Vitest. Registered via
 * `registerA11yMatchers` (from `@real-a11y-dev/testing/matchers`) or each
 * framework's `snapshotSerializers` config. Renders any {@link boxSnapshot} —
 * whether it came from `boxedTreeSnapshot` (a tree) or `a11yDiff` (a change list).
 */
export const a11ySnapshotSerializer = {
  test(val: unknown): val is A11ySnapshotBox {
    return (
      typeof val === "object" &&
      val !== null &&
      (val as Record<string, unknown>)[SNAPSHOT_BRAND] === true
    );
  },
  serialize(val: A11ySnapshotBox): string {
    return val.text;
  },
};
