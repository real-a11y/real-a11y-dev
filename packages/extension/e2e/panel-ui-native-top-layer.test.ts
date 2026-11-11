/**
 * The outline a selected native row draws on the page, over what the page
 * shows in the top layer. The outline was an element at the highest z-index,
 * which nothing of the page's paints over, except what is in the top layer,
 * above every z-index: an open popover or a modal `<dialog>`. Selecting a
 * heading inside a site's menu shown as a popover drew its outline in the
 * right place, under the menu, so nothing of it showed. The outline is in
 * the top layer itself now (`highlightElement` in core's `focus-manager.ts`).
 * What is on screen is what jsdom can't tell, so only a real browser can pin
 * it.
 */

import type { Page } from "@playwright/test";

import { expect, overlayCovers, test, type NativeHarness } from "./harness";

type Clip = { x: number; y: number; width: number; height: number };

/**
 * The RGBA pixels of `clip` on the page's screen, row by row. Decoded in the
 * page, from a screenshot, which paints a new frame first.
 */
async function screenPixels(page: Page, clip: Clip): Promise<number[]> {
  const png = (await page.screenshot({ clip })).toString("base64");
  return page.evaluate(async (png) => {
    const blob = await (await fetch(`data:image/png;base64,${png}`)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    return [...context.getImageData(0, 0, bitmap.width, bitmap.height).data];
  }, png);
}

/** How far from an element's edge, either side, the outline's border is
 *  looked for: its 2px, and a pixel of rounding. */
const RING = 3;

/** Enough of the border's pixels to be the outline: its ring around even the
 *  smallest target here runs to hundreds, and a stray pixel of text's
 *  subpixel edge to a few. */
const SHOWN = 50;

/**
 * The pixels of the outline's border on screen at the edge of `selector`'s
 * element. Only a ring at the edge counts: the fixture keeps text away from
 * it, since a glyph's subpixel edges can be bluish, and paints nothing else
 * of its own in that blue.
 */
async function outlinePixels(page: Page, selector: string): Promise<number> {
  const box = (await page.locator(selector).boundingBox())!;
  const width = Math.round(box.width) + 2 * RING;
  const height = Math.round(box.height) + 2 * RING;
  const data = await screenPixels(page, {
    x: Math.round(box.x) - RING,
    y: Math.round(box.y) - RING,
    width,
    height,
  });
  let border = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inside =
        x >= 2 * RING &&
        x < width - 2 * RING &&
        y >= 2 * RING &&
        y < height - 2 * RING;
      if (inside) continue;
      const i = (y * width + x) * 4;
      // hsl(221 83% 53%), the outline's border: rgb(36, 99, 235).
      if (
        Math.abs(data[i]! - 36) < 40 &&
        Math.abs(data[i + 1]! - 99) < 40 &&
        Math.abs(data[i + 2]! - 235) < 40
      ) {
        border++;
      }
    }
  }
  return border;
}

/** Read Chrome's tree of the page again: what the page opened since is in
 *  it. */
async function readAgain(nav: NativeHarness): Promise<void> {
  await nav.panel.reload();
  await expect
    .poll(() => nav.panel.locator(".sn-node").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await nav.panel.getByRole("button", { name: "Expand all" }).click();
}

/** Select the row named `name` in Chrome's tree, and wait for its outline to
 *  land on `selector`'s element. */
async function select(
  nav: NativeHarness,
  page: Page,
  name: string,
  selector: string,
): Promise<void> {
  const row = nav.panel.getByRole("treeitem", { name });
  await expect(row).toBeVisible();
  await row.click({ position: { x: 5, y: 5 } });
  await expect
    .poll(() => overlayCovers(page, selector, { inView: true }), {
      timeout: 5_000,
    })
    .toBe(true);
}

test("a selected or hovered row's outline shows over a menu shown as a popover, and stays out of Chrome's tree", async ({
  nav,
}) => {
  const { page, tabId } = await nav.open("native-top-layer.html");
  await page.bringToFront();
  await readAgain(nav);
  // Not a test that passes on a counter that sees nothing: on the page, under
  // nothing, the outline shows.
  await select(nav, page, "Feed", "#feed");
  await expect.poll(() => outlinePixels(page, "#feed")).toBeGreaterThan(SHOWN);

  await page.locator("#for-business").click();
  await expect(page.locator("#apps-menu")).toBeVisible();
  await readAgain(nav);
  const groups = async () =>
    (await nav.readNodes(tabId)).filter((n) => n.role === "group").length;
  const groupsBefore = await groups();

  // In the right place, through the page's `[popover]` rules, is not enough:
  // it has to be on screen, over the menu.
  await select(nav, page, "My apps", "#apps-heading");
  await expect
    .poll(() => outlinePixels(page, "#apps-heading"))
    .toBeGreaterThan(SHOWN);
  await test.step("with no backdrop of its own over the menu", async () => {
    const menu = (await page.locator("#apps-menu").boundingBox())!;
    const [r, g, b] = await screenPixels(page, {
      x: Math.round(menu.x) + 8,
      y: Math.round(menu.y + menu.height) - 8,
      width: 1,
      height: 1,
    });
    expect([r, g, b]).toEqual([255, 255, 255]);
  });
  // A popover shown is a `group` in Chrome's tree; the outline is no part of
  // the page's.
  expect(await groups()).toBe(groupsBefore);
  // Showing the outline closes no popover of the page's.
  expect(
    await page.evaluate(() =>
      document.getElementById("apps-menu")!.matches(":popover-open"),
    ),
  ).toBe(true);
  // A hovered row's preview reaches the same outline by an event of its own.
  await test.step("and a hovered row's, over the menu too", async () => {
    await nav.panel
      .getByRole("treeitem", { name: "Sell" })
      .hover({ position: { x: 5, y: 5 } });
    await expect
      .poll(() => overlayCovers(page, "#sell"), { timeout: 5_000 })
      .toBe(true);
    await expect
      .poll(() => outlinePixels(page, "#sell"))
      .toBeGreaterThan(SHOWN);
  });
});

test("a selected row's outline shows over a modal dialog", async ({ nav }) => {
  const { page } = await nav.open("native-top-layer.html");
  await page.bringToFront();
  await page.locator("#open-settings").click();
  await expect(page.locator("#settings")).toBeVisible();
  await readAgain(nav);

  await select(nav, page, "Save", "#save");
  await expect.poll(() => outlinePixels(page, "#save")).toBeGreaterThan(SHOWN);
});
