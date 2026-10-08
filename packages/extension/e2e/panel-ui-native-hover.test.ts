/**
 * The native tree's hover preview, through the real build: resting the
 * pointer on a native row outlines its element on the page, as the DOM
 * tree's hover does. It is a preview, so the page neither scrolls nor
 * changes focus; leaving the tree's rows clears it, the selection's outline
 * included; and it costs one debugger round trip per row the pointer rests
 * on, none for the rows a sweep crosses, and none while a pick is armed.
 */

import { NATIVE_HOVER_DWELL_MS } from "../src/sidepanel/native-follow.ts";

import { expect, overlayCovers, overlayRect, test } from "./harness";

test("hovering a native row outlines its element in place, without scrolling or focusing", async ({
  nav,
}) => {
  const page = await nav.showNative("native-panel.html");
  // Push the items below the fold, so a scroll would show.
  await page.evaluate(() => {
    document.body.style.paddingTop = "2000px";
  });
  await nav.panel.getByRole("button", { name: "Expand all" }).click();

  const row = nav.panel.getByRole("treeitem", { name: "Item 16" });
  await expect(row).toBeVisible();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await row.hover({ position: { x: 5, y: 5 } });

  // The dwell, then a real chrome.debugger round trip.
  await expect
    .poll(() => overlayCovers(page, "#item-16"), { timeout: 5_000 })
    .toBe(true);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  expect(await page.evaluate(() => document.activeElement?.id)).not.toBe(
    "item-16",
  );
});

test("moving off the rows clears the outline on the page", async ({ nav }) => {
  const page = await nav.showNative("native-panel.html");
  await nav.routeToPage(["CLEAR_HIGHLIGHT"]);
  await nav.panel.getByRole("button", { name: "Expand all" }).click();

  await nav.panel
    .getByRole("treeitem", { name: "Item 16" })
    .hover({ position: { x: 5, y: 5 } });
  await expect
    .poll(() => overlayCovers(page, "#item-16"), { timeout: 5_000 })
    .toBe(true);

  // Onto the toolbar: off every row.
  await nav.panel.getByRole("button", { name: "Expand all" }).hover();
  await expect.poll(() => overlayRect(page), { timeout: 5_000 }).toBeNull();
});

test("a clicked row's outline clears when the pointer leaves, as in the DOM tree", async ({
  nav,
}) => {
  const page = await nav.showNative("native-panel.html");
  await nav.routeToPage(["CLEAR_HIGHLIGHT"]);
  await nav.panel.getByRole("button", { name: "Expand all" }).click();

  await nav.panel
    .getByRole("treeitem", { name: "Item 16" })
    .click({ position: { x: 5, y: 5 } });
  await expect
    .poll(() => overlayCovers(page, "#item-16", { inView: true }), {
      timeout: 5_000,
    })
    .toBe(true);

  await nav.panel.getByRole("button", { name: "Expand all" }).hover();
  await expect.poll(() => overlayRect(page), { timeout: 5_000 }).toBeNull();
});

test("a sweep across the rows previews only the row it rests on", async ({
  nav,
}) => {
  await nav.showNative("native-panel.html");
  await nav.panel.getByRole("button", { name: "Expand all" }).click();
  const previews = async () =>
    (await nav.nativeActs()).filter((a) => a.action === "preview");

  // Faster than the dwell from row to row: the enter and leave events a
  // sweep makes, all in one task. A real pointer can't sweep this panel in
  // the harness: it is a background tab, whose input arrives throttled. So
  // this pins what a sweep costs end to end, one preview; how long the dwell
  // is, `NativeTreeView.test.tsx` pins with fake timers.
  const ids: string[] = [];
  for (const n of [10, 11, 12, 13, 14, 15, 16]) {
    ids.push(
      (await nav.panel
        .getByRole("treeitem", { name: `Item ${n}` })
        .getAttribute("data-node-id"))!,
    );
  }
  await nav.panel.evaluate((rows) => {
    let previous: Element | null = null;
    for (const id of rows) {
      const row = document.querySelector(`[data-node-id="${id}"]`)!;
      previous?.dispatchEvent(new MouseEvent("mouseleave"));
      row.dispatchEvent(new MouseEvent("mouseenter"));
      previous = row;
    }
  }, ids);
  await expect.poll(async () => (await previews()).length).toBe(1);
  // Long enough for any stray timer to have fired.
  await nav.panel.waitForTimeout(NATIVE_HOVER_DWELL_MS * 3);
  const sent = await previews();
  expect(sent).toHaveLength(1);
  expect(sent[0]!.nodeId).toBe(ids.at(-1));
});

test("no row is previewed while a pick is armed", async ({ nav }) => {
  await nav.showNative("native-panel.html");
  await nav.panel.getByRole("button", { name: "Expand all" }).click();
  const pick = nav.panel.getByRole("button", { name: "Pick element in page" });
  await pick.click();
  await expect(pick).toHaveAttribute("aria-pressed", "true");

  await nav.panel
    .getByRole("treeitem", { name: "Item 16" })
    .hover({ position: { x: 5, y: 5 } });
  await nav.panel.waitForTimeout(NATIVE_HOVER_DWELL_MS * 3);
  expect(
    (await nav.nativeActs()).filter((a) => a.action === "preview"),
  ).toEqual([]);
  await pick.click(); // ends the pick
});
