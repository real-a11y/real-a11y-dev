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

import { expect, test, type DomNode, type NativeHarness } from "./harness";

const FIXTURE = "frame-placement.html";

type DomTree = Map<string, DomNode>;

/** The title of the <iframe> the node named `name` sits under, or null when
 *  it is under none: in no frame, or in a frame the tree couldn't place. */
function frameOf(tree: DomTree, name: string): string | null | undefined {
  const node = [...tree.values()].find((n) => n.a11y?.name === name);
  if (!node) return undefined;
  for (
    let at = node.parentId ? tree.get(node.parentId) : undefined;
    at;
    at = at.parentId ? tree.get(at.parentId) : undefined
  ) {
    if (at.dom?.tagName.toLowerCase() === "iframe") {
      return at.dom.attributes?.["title"] ?? "";
    }
  }
  return null;
}

/** The latest merged tree pushed to the panel since `from`, once `ready`. */
async function treeWhen(
  nav: NativeHarness,
  tabId: number,
  from: number,
  ready: (tree: DomTree) => boolean,
): Promise<DomTree> {
  let tree: DomTree = new Map();
  await expect
    .poll(
      async () => {
        const pushes = (await nav.panelMessages("TREE_DATA", from)).filter(
          (m) => m.tabId === tabId,
        );
        const last = pushes[pushes.length - 1]?.payload as
          { nodes: [string, DomNode][] } | undefined;
        tree = new Map(last?.nodes ?? []);
        return ready(tree);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return tree;
}

test("a frame lands under the <iframe> its URL names, though hidden frames announced before it", async ({
  nav,
}) => {
  const { page, tabId } = await nav.open(FIXTURE);
  // Both hidden frames are in the page's tree: theirs are the only nodes a
  // frame's id prefixes yet. Asking each frame for its tree again leaves
  // the order they first announced in as it was.
  await expect
    .poll(
      async () => {
        const { nodes } = await nav.domTree(tabId);
        return new Set(nodes.map(([id]) => /^f\d+-/.exec(id)?.[0])).size;
      },
      { timeout: 15_000 },
    )
    // Two frames' prefixes, and `undefined` for the page's own nodes.
    .toBe(3);

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
