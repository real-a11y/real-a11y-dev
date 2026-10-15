/**
 * Frames of another origin than the page's, in the in-page tree. Such a
 * frame can't read `window.frameElement`, so it can't mark the element
 * holding it (`src/frame-owner.ts`): the tree places it by its URL, matched
 * against each `<iframe>`'s `src` with the query string and then without,
 * and guesses an empty `<iframe>` for one whose URL names none.
 *
 * Which frames match loosely is what only a real browser shows. A hidden
 * frame's `<iframe>` (`display: none`, as a tracker's or a collapsed ad
 * slot's is) has no node in the a11y view, so its URL names none exactly,
 * and its frame announces in its own time, routinely before the embeds the
 * page shows.
 */

import { expect, frameOf, test, treeWhen } from "./harness";

const FIXTURE = "frame-placement.html";

test("a frame lands under the <iframe> its URL names, though hidden frames announced before it", async ({
  nav,
}) => {
  const { page, tabId } = await nav.open(FIXTURE);
  // Both hidden frames are in the page's tree, so both announced. Asking
  // each frame for its tree again leaves the order they first announced in
  // as it was.
  await expect
    .poll(
      async () => {
        const tree = new Map((await nav.domTree(tabId)).nodes);
        return ["Pixel button", "Slot 1 button"].every(
          (name) => frameOf(tree, name) !== undefined,
        );
      },
      { timeout: 15_000 },
    )
    .toBe(true);

  const from = await nav.panelMessageCount();
  await page.evaluate(() =>
    (window as typeof window & { showSlot(): void }).showSlot(),
  );
  // The hidden frame that announced first took the shown slot's <iframe>:
  // the pixel by the last-resort guess, the hidden slot by its URL without
  // the query. The shown slot's own content was left under none.
  const tree = await treeWhen(
    nav,
    tabId,
    from,
    (t) => frameOf(t, "Slot 2 button") === "Second slot",
  );
  const shown = [...tree.values()].find(
    (n) => n.dom?.attributes?.["title"] === "Second slot",
  );
  expect(shown?.childIds).toHaveLength(1);
  for (const name of ["Pixel button", "Slot 1 button"]) {
    expect([undefined, null], name).toContain(frameOf(tree, name));
  }
});
