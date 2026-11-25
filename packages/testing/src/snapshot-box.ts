/**
 * The snapshot-serializer box — a tiny branded wrapper around a serialized
 * string so `expect(box).toMatchSnapshot()` / `.toMatchInlineSnapshot()` prints
 * it verbatim through the registered pretty-format plugin, instead of the
 * framework's default object dump.
 *
 * Lives on its own (not in `matchers.ts`) so `a11yDiff` and the boxed snapshots
 * (`boxedTreeSnapshot` and its tab-sequence and outline twins) all produce
 * boxes the SAME serializer renders, without the diff/capture API
 * pulling in the jest matcher augmentation or `@real-a11y-dev/validate`.
 *
 * Without the serializer registered, a box still snapshots as its text: its
 * `toJSON` returns it, and pretty-format calls `toJSON` on any value no plugin
 * claims. The text then lands quoted, as a `treeSnapshot` string does, rather
 * than as this object with its brand key, which nothing would flag.
 */

import type { ExtractionResult } from "@real-a11y-dev/core";

import { recordSnapshot } from "./snapshot-record.js";

const SNAPSHOT_BRAND = "@real-a11y-dev/a11y-snapshot";

/**
 * Where a box keeps the trees behind its text, for the snapshot viewer
 * (`snapshot-record.ts`). A non-enumerable symbol, so neither pretty-format nor
 * a framework's equality ever sees it.
 */
const SNAPSHOT_TREES = Symbol.for("@real-a11y-dev/a11y-snapshot.trees");

/** What a record takes from the snapshot's own options. */
interface SnapshotPrinting {
  /** Applied to what the page supplied in a record, as to the text. */
  redact?: RegExp[];
}

/**
 * Which of the panel's views a tree's record opens on, for a snapshot that
 * printed only part of the tree: `"tab"`, the TAB view, for a tab sequence,
 * and `"headings"`, the headings filter, for an outline. Left out, the tree.
 */
export type SnapshotView = "tab" | "headings";

/** The trees a box's text was printed from, as the snapshot viewer draws them. */
export type SnapshotTrees =
  | ({
      kind: "tree";
      tree: ExtractionResult;
      view?: SnapshotView;
    } & SnapshotPrinting)
  | ({
      kind: "diff";
      before: ExtractionResult;
      after: ExtractionResult;
      /** Node ids focused on each side; `undefined` when a side had no focus
       *  context (a bare `ExtractionResult`). */
      focusBefore?: string | null;
      focusAfter?: string | null;
    } & SnapshotPrinting);

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

/**
 * Wrap a pre-serialized string as a snapshot box. `trees`, when given, is
 * called only if the snapshot report's recorder is on, so a run that doesn't
 * record pays nothing for it. It records only through the serializer: a box
 * snapshotted through its `toJSON` writes no record.
 */
export function boxSnapshot(
  text: string,
  trees?: () => SnapshotTrees,
): A11ySnapshotBox {
  const box = Object.defineProperty(
    { [SNAPSHOT_BRAND]: true, text },
    "toJSON",
    { value: boxText },
  ) as A11ySnapshotBox;
  if (trees) Object.defineProperty(box, SNAPSHOT_TREES, { value: trees });
  return box;
}

/** The trees behind `box`, if it was made with them. */
export function snapshotTreesOf(
  box: A11ySnapshotBox,
): (() => SnapshotTrees) | undefined {
  return (box as unknown as Record<symbol, (() => SnapshotTrees) | undefined>)[
    SNAPSHOT_TREES
  ];
}

/**
 * pretty-format plugin recognised by both Jest and Vitest. Registered via
 * `registerA11yMatchers` (from `@real-a11y-dev/testing/matchers`) or each
 * framework's `snapshotSerializers` config. Renders any {@link boxSnapshot} —
 * whether it came from a boxed snapshot (a tree, its tab sequence or its
 * outline) or `a11yDiff` (a change list).
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
    const trees = snapshotTreesOf(val);
    if (trees) recordSnapshot(val, trees);
    return val.text;
  },
};
