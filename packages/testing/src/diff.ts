import type { ExtractionResult, SemanticNode } from "@real-a11y-dev/core";
import { diffTrees } from "@real-a11y-dev/core";

import { serializeTreeDiff } from "@real-a11y-dev/serialize";

import { capture, type A11yCapture } from "./capture.js";
import { boxSnapshot, type A11ySnapshotBox } from "./snapshot-box.js";

export interface A11yDiffOptions {
  /** Redact matching substrings from names/values (passed to serializeTreeDiff). */
  redact?: RegExp[];
}

/** A tree + its focus context, or `undefined` focus for a plain tree. */
interface Side {
  tree: ExtractionResult;
  focus: SemanticNode | null | undefined;
}

function sideOf(input: A11yCapture | ExtractionResult | Element): Side {
  if (input instanceof Element) {
    const cap = capture(input);
    return { tree: cap.tree, focus: cap.focus };
  }
  // A11yCapture carries `.tree`; a bare ExtractionResult does not — and has no
  // focus context, so a diff against/for it renders no `focus:` line.
  if ("tree" in input) return { tree: input.tree, focus: input.focus };
  return { tree: input, focus: undefined };
}

/**
 * Diff two captures of the a11y tree and box the result for
 * `expect(...).toMatchSnapshot()` / `.toMatchInlineSnapshot()`. This is the
 * "assert what an interaction changed" primitive — the same
 * {@link serializeTreeDiff} output as a committable snapshot:
 *
 * ```ts
 * const before = capture(container);
 * await userEvent.click(screen.getByRole("button", { name: "Country" }));
 * expect(a11yDiff(before, container)).toMatchInlineSnapshot(`
 *   + option "Spain"
 *   ~ combobox "Country": a11y.states.expanded false → true
 *   focus: button "Country" → listbox "Countries"
 * `);
 * ```
 *
 * `before` must be a pre-captured tree (a `capture()` or an `ExtractionResult`)
 * — extracting it at assert time would diff the tree against itself. `after`
 * may be a live `Element` (captured now, the common case). A `focus:` line
 * appears only when BOTH sides carry focus context (both `capture()`d, or an
 * `after` Element); a plain `ExtractionResult` on either side omits it.
 *
 * Requires the a11y snapshot serializer to be registered (via
 * `registerA11yMatchers` from `@real-a11y-dev/testing/matchers`, as for
 * `a11ySnapshot`).
 */
export function a11yDiff(
  before: A11yCapture | ExtractionResult,
  after: A11yCapture | ExtractionResult | Element,
  options: A11yDiffOptions = {},
): A11ySnapshotBox {
  const b = sideOf(before);
  const a = sideOf(after);
  return boxSnapshot(
    serializeTreeDiff(diffTrees(b.tree, a.tree), {
      redact: options.redact,
      focusBefore: b.focus,
      focusAfter: a.focus,
    }),
  );
}
