/**
 * The snapshot-serializer box — a tiny branded wrapper around a serialized
 * string so `expect(box).toMatchSnapshot()` / `.toMatchInlineSnapshot()` prints
 * it verbatim through the registered pretty-format plugin, instead of the
 * framework's default object dump.
 *
 * Lives on its own (not in `matchers.ts`) so `a11yDiff` and `a11ySnapshot` can
 * both produce boxes the SAME serializer renders, without the diff/capture API
 * pulling in the jest matcher augmentation or `@real-a11y-dev/validate`.
 */

const SNAPSHOT_BRAND = "@real-a11y-dev/a11y-snapshot";

export interface A11ySnapshotBox {
  readonly [SNAPSHOT_BRAND]: true;
  readonly text: string;
}

/** Wrap a pre-serialized string as a snapshot box. */
export function boxSnapshot(text: string): A11ySnapshotBox {
  return { [SNAPSHOT_BRAND]: true, text };
}

/**
 * pretty-format plugin recognised by both Jest and Vitest. Registered via
 * `registerA11yMatchers` (from `@real-a11y-dev/testing/matchers`) or each
 * framework's `snapshotSerializers` config. Renders any {@link boxSnapshot} —
 * whether it came from `a11ySnapshot` (a tree) or `a11yDiff` (a change list).
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
