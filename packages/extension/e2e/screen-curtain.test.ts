/**
 * Screen Curtain over everything the page paints. It was an element at one
 * short of the highest z-index, so an element of the page's at the highest
 * painted over it, and so did anything in the top layer, above every
 * z-index: a site's search suggestions, shown as a popover, stayed in plain
 * sight. The curtain is now in the top layer itself, and goes back on top of
 * whatever the page shows there after it (`src/curtain.ts`). What is on
 * screen, and what a press lands on, is what jsdom can't tell, so only a
 * real browser can pin it.
 */

import type { Page } from "@playwright/test";

import { expect, node, test } from "./harness";

/**
 * The pixels on the page's screen of the red the fixture paints everything
 * of its own in. Decoded in the page, from a screenshot, which paints a new
 * frame first. Nothing of the page changes: no element is added, so the
 * content script sees no mutation.
 */
async function redPixels(page: Page): Promise<number> {
  const png = (await page.screenshot()).toString("base64");
  return page.evaluate(async (png) => {
    const blob = await (await fetch(`data:image/png;base64,${png}`)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    let red = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i]! > 200 && data[i + 1]! < 60 && data[i + 2]! < 60) red++;
    }
    return red;
  }, png);
}

/** What the fixture's elements heard of a press since the last call:
 *  `id:type`. */
async function reached(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const seen = window as unknown as { reached: string[] };
    return seen.reached.splice(0);
  });
}

/** Press the pointer at the middle of `selector`'s element, where it is
 *  laid out whether or not it can be seen. */
async function pressOn(page: Page, selector: string): Promise<void> {
  const box = (await page.locator(selector).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test("Screen Curtain hides everything the page shows, in the top layer too, and no press reaches it", async ({
  nav,
}) => {
  const { page, tabId } = await nav.open("screen-curtain.html");
  await page.bringToFront();
  await nav.panel.reload();
  await expect
    .poll(() => nav.panel.locator(".sn-node").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
  // The panel here is a tab, whose messages the background never forwards.
  await nav.routeToPage(["TOGGLE_CURTAIN"]);
  // Not a test that passes on a blank screen: the page is red all over.
  expect(await redPixels(page)).toBeGreaterThan(0);

  await nav.panel.getByRole("button", { name: "Curtain", exact: true }).click();
  await expect(
    nav.panel.getByRole("button", { name: "Curtain ON" }),
  ).toBeVisible();
  await expect(page.locator("#__sn-curtain")).toBeAttached();
  await test.step("an element at the highest z-index, and the page's [popover] rules", async () => {
    expect(await redPixels(page)).toBe(0);
  });
  const cdp = await page.context().newCDPSession(page);
  await test.step("and Chrome's tree, which the panel shows, has none of it", async () => {
    const { nodes } = (await cdp.send("Accessibility.getFullAXTree")) as {
      nodes: Array<{ ignored: boolean; name?: { value?: unknown } }>;
    };
    const names = nodes
      .filter((n) => !n.ignored)
      .map((n) => String(n.name?.value ?? ""));
    expect(names).toContain("Curtained page");
    expect(
      names.filter((name) => /Screen Curtain|Content hidden/.test(name)),
    ).toEqual([]);
  });
  await test.step("a press lands on the curtain, not the page", async () => {
    await pressOn(page, "#out");
    expect(await reached(page)).toEqual([]);
  });

  // Each one the page shows after the curtain goes under it before the next
  // frame paints, so the very next screenshot shows none of it.
  await test.step("search suggestions shown as a popover", async () => {
    await page.evaluate(() =>
      document.getElementById("suggestions")!.showPopover(),
    );
    expect(await redPixels(page)).toBe(0);
  });
  // That it goes under within the frame the callback belongs to, rather than
  // the next, a screenshot can't tell: `curtain.test.ts` pins that.
  await test.step("a popover shown in a frame callback", async () => {
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => {
            document.getElementById("menu")!.showPopover();
            resolve();
          }),
        ),
    );
    expect(await redPixels(page)).toBe(0);
  });
  await test.step("a modal dialog, which no press reaches, and Chrome's tree still acts on", async () => {
    await page.evaluate(() =>
      (document.getElementById("dialog") as HTMLDialogElement).showModal(),
    );
    expect(await redPixels(page)).toBe(0);
    // Above a modal dialog the curtain is inert, and hit testing passes it
    // by: the press must find nothing of the page's under it either.
    await pressOn(page, "#inside");
    await pressOn(page, "#top");
    expect(await reached(page)).toEqual([]);
    // What a screen reader or the panel does isn't hit tested.
    const inside = node(await nav.readNodes(tabId), "button", "Inside");
    expect(await nav.act(tabId, inside.id, "click")).toEqual({
      success: true,
    });
    expect(await reached(page)).toContain("inside:click");
    await page.evaluate(() =>
      (document.getElementById("dialog") as HTMLDialogElement).close(),
    );
  });
  await test.step("a fullscreen element", async () => {
    // Fullscreen takes a user's gesture, which the page can't be given
    // through the curtain.
    await cdp.send("Runtime.evaluate", {
      expression: `document.getElementById("video").requestFullscreen()`,
      userGesture: true,
      awaitPromise: true,
    });
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement?.id))
      .toBe("video");
    expect(await redPixels(page)).toBe(0);
    await page.evaluate(() => document.exitFullscreen());
  });
  await cdp.detach();
  // A popover in a shadow root: its toggle stops at the root, so the curtain
  // goes back on top once Chrome's visibility check finds it covered.
  await test.step("a popover in a shadow root", async () => {
    await page.evaluate(() =>
      (
        document
          .getElementById("host")!
          .shadowRoot!.querySelector("[popover]") as HTMLElement
      ).showPopover(),
    );
    await expect.poll(() => redPixels(page)).toBe(0);
  });

  await nav.panel.getByRole("button", { name: "Curtain ON" }).click();
  await expect(page.locator("#__sn-curtain")).not.toBeAttached();
  expect(await redPixels(page)).toBeGreaterThan(0);
  // And the page is the pointer's again.
  await page.evaluate(() =>
    document.querySelectorAll<HTMLElement>(":popover-open").forEach((el) => {
      el.hidePopover();
    }),
  );
  await pressOn(page, "#out");
  expect(await reached(page)).toEqual(["out:pointerdown", "out:click"]);
});
