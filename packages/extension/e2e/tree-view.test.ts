/**
 * Tree View — `treeitem` click, across the three shapes the role takes.
 *
 * `treeitem` is one of the roles round 7 added to `ACTABLE` after finding the
 * panel behind the DOM producer, and it is in `pageClick`'s composite-redirect
 * list. The redirect is what makes a row whose real control is nested inside it
 * clickable at all — and, as the last test here records, it is also where the
 * role's one open sharp edge lives.
 */

import { expect, node, nodes, test } from "./harness";

test("tree items surface with level and expanded state", async ({ nav }) => {
  const { tabId } = await nav.open("tree-view.html");
  const tree = await nav.readNodes(tabId);

  expect(node(tree, "treeitem", "Projects").states?.expanded).toBe(false);
  expect(node(tree, "treeitem", "Reports").states?.expanded).toBe(true);
  expect(node(tree, "treeitem", "Projects").properties).toMatchObject({
    level: "1",
  });
  expect(node(tree, "treeitem", "project-a").properties).toMatchObject({
    level: "2",
  });
  expect(nodes(tree, "tree")).toHaveLength(3);
});

/** The APG example's own shape: a folder row with no inner control, so the
 *  redirect matches nothing and the wrapper is clicked unchanged. */
test("clicking an APG folder row toggles aria-expanded", async ({ nav }) => {
  const { page, tabId } = await nav.open("tree-view.html");
  const parent = node(await nav.readNodes(tabId), "treeitem", "Projects");

  expect(await nav.act(tabId, parent.id, "click")).toEqual({ success: true });
  await expect(page.locator("#projects")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(page.locator("#tree-toggled")).toHaveText("projects");

  expect(
    node(await nav.readNodes(tabId), "treeitem", "Projects").states?.expanded,
  ).toBe(true);
});

/** The wrapper shape the composite redirect exists for: the page's delegated
 *  handler keys off the anchor, which a click on the `<li>` alone never
 *  reaches. */
test("clicking a treeitem wrapping a link redirects to the link", async ({
  nav,
}) => {
  const { page, tabId } = await nav.open("tree-view.html");
  const bookmark = node(
    await nav.readNodes(tabId),
    "treeitem",
    "Specifications",
  );

  expect(await nav.act(tabId, bookmark.id, "click")).toEqual({ success: true });
  await expect(page.locator("#tree-echo")).toHaveText("Specifications");
});

test("the inner link dispatches directly as well", async ({ nav }) => {
  const { page, tabId } = await nav.open("tree-view.html");
  const link = node(await nav.readNodes(tabId), "link", "Documentation");

  expect(await nav.act(tabId, link.id, "click")).toEqual({ success: true });
  await expect(page.locator("#tree-echo")).toHaveText("Documentation");
});

/**
 * A limitation this suite found, pinned as current behaviour rather than fixed.
 *
 * `pageClick` redirects a composite wrapper with
 * `el.querySelector('[role="link"], [role="button"], a[href], button')`, whose
 * docstring reasons that document order gives "the row's primary action, not an
 * inner chevron". That holds for a row whose descendants are its own controls —
 * including a collapsible row that is itself a link, where its own anchor comes
 * first in document order and wins.
 *
 * It does NOT hold for a collapsible row whose own label is plain text and
 * whose SUBTREE contains links — a docs sidebar or file browser, typically.
 * There the first match in document order is a GRANDCHILD's control, so
 * expanding "2024" activates "January" instead. The marker still reports
 * `{ success: true }`: the same "succeeded while doing the wrong thing" shape
 * round 15's slider half warns about.
 *
 * Not fixed here on purpose. This suite's job is to pin dispatch behaviour
 * against real widget shapes; narrowing the redirect (to direct children, say,
 * or to the row's own label subtree) is a change to shipped dispatch code with
 * its own blast radius, and is the maintainer's call. If it is made, THIS test
 * is the one that should change — deliberately, with the assertion inverted.
 *
 * The APG's own treeview is unaffected: its folder rows carry no inner control,
 * which is why the first test above passes.
 */
test("KNOWN GAP: a collapsible row redirects into a grandchild's link", async ({
  nav,
}) => {
  const { page, tabId } = await nav.open("tree-view.html");
  const folder = node(await nav.readNodes(tabId), "treeitem", "2024");

  expect(await nav.act(tabId, folder.id, "click")).toEqual({ success: true });

  // What a user asked for — and did not get.
  await expect(page.locator("#archive-2024")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  // What actually happened: the grandchild's link fired.
  await expect(page.locator("#tree-echo")).toHaveText("January");
});
