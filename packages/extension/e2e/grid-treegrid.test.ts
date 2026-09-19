/**
 * Grid and Treegrid — the role boundary, pinned.
 *
 * This fixture is here to hold a DECISION still, not to close a gap.
 * `gridcell` is actionable; `row` and plain `cell` are not, and round 8
 * reverted a first-pass attempt to make them so. The reasoning is in
 * `DogfoodPanel.tsx`'s `ACTABLE` docstring: those roles are also the implicit
 * ARIA role of a plain native element (`<tr>`, `<td>`), Chromium computes them
 * identically via HTML-AAM, and a native-tree node carries no tag to tell the
 * two apart — so offering CLICK on them would misfire on every page with a data
 * table.
 *
 * A test asserting click-dispatch on `row` would be asserting against a
 * deliberately-not-fixed gap. What these tests do instead is make the boundary
 * observable: the plain `<table>` produces exactly the same roles as the ARIA
 * grid, which is the fact the decision rests on.
 */

import { expect, node, nodes, test } from "./harness";

test("a plain table produces the same roles as an ARIA grid", async ({
  nav,
}) => {
  const { tabId } = await nav.open("grid-treegrid.html");
  const tree = await nav.readNodes(tabId);

  // The whole basis for round 8's reversal, measured rather than assumed: the
  // ARIA grid's authored `role="row"` and the plain `<tr>`'s implicit one are
  // indistinguishable on this tree — same role string, no tag, nothing else to
  // go on.
  const rows = nodes(tree, "row");
  expect(rows.length).toBeGreaterThanOrEqual(4);
  expect(rows.every((r) => r.role === "row")).toBe(true);
  // Likewise the plain `<td>`: `cell`, not `gridcell`.
  expect(node(tree, "cell").name).toBe("Nothing here is actionable");
  expect(nodes(tree, "gridcell").map((c) => c.name)).toEqual([
    "2026-01-04",
    "12.40",
    "Release notes",
  ]);
});

test("gridcell dispatches a click", async ({ nav }) => {
  const { page, tabId } = await nav.open("grid-treegrid.html");
  const cell = node(await nav.readNodes(tabId), "gridcell", "12.40");

  expect(await nav.act(tabId, cell.id, "click")).toEqual({ success: true });
  await expect(page.locator("#grid-echo")).toHaveText("tx-1-amount");
});

test("a treegrid's gridcell dispatches too, and its row carries the level", async ({
  nav,
}) => {
  const { page, tabId } = await nav.open("grid-treegrid.html");
  const tree = await nav.readNodes(tabId);

  // The treegrid's row is where `aria-expanded` lives — readable, even though
  // the row itself is not offered as clickable.
  expect(node(tree, "row", "Release notes").states?.expanded).toBe(false);

  await nav.act(tabId, node(tree, "gridcell", "Release notes").id, "click");
  await expect(page.locator("#grid-echo")).toHaveText("thread-1-subject");
});

/**
 * A second, smaller boundary worth recording while the fixture is here.
 *
 * `ACTABLE`'s own docstring says the DOM producer treats
 * `gridcell`/`columnheader`/`rowheader` as actionable, but only `gridcell` is
 * in the set. So a `columnheader` — a sortable column header, in the common
 * case — gets no affordance on the native tree even though its DOM-producer
 * counterpart does.
 *
 * Unlike `row`, this one has no role-ambiguity defence: a plain `<th>` computes
 * `columnheader` too, so the same argument would apply. Recorded here as an
 * asymmetry rather than filed as a bug, since closing it is the same class of
 * decision round 8 already weighed.
 */
test("columnheader is present on the tree but outside the actionable set", async ({
  nav,
}) => {
  const { tabId } = await nav.open("grid-treegrid.html");
  const tree = await nav.readNodes(tabId);

  expect(nodes(tree, "columnheader").map((c) => c.name)).toEqual([
    "Date",
    "Amount",
  ]);
  // Dispatch is not the blocker — a click reaches it fine if asked for.
  expect(
    await nav.act(tabId, node(tree, "columnheader", "Date").id, "click"),
  ).toEqual({ success: true });
});
