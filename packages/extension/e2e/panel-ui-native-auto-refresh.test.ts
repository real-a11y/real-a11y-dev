/**
 * Native auto-refresh, through the real build.
 *
 * The native tree follows the page on its own once a read has succeeded on
 * the tab: the content script's "the page changed" signal (`TREE_DATA`)
 * schedules one re-read after the page goes quiet (`native-auto-refresh.ts`
 * is the policy). It follows the tab a read succeeded on and nothing else —
 * a tab switch still waits for Refresh, exactly as the auto-load does.
 */

import { expect, test, type NativeHarness } from "./harness";

type PanelPage = import("@playwright/test").Page;

/** Bring a fixture forward, reload the panel and show the native tree. */
async function showNative(
  nav: NativeHarness,
  fixture: string,
): Promise<PanelPage> {
  const { page } = await nav.open(fixture);
  await page.bringToFront();
  await nav.panel.reload();
  const toggle = nav.panel
    .getByRole("group", { name: "Tree producer" })
    .getByRole("button", { name: "NATIVE", exact: true });
  await expect(toggle).toBeVisible({ timeout: 20_000 });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() => nav.panel.locator(".sn-node").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
  return page;
}

/** The native tree's row for `name`, found through its search box: the
 *  tree is virtualized, and a row appended at the end of the page can sit
 *  below the rendered window. */
async function findRow(panel: PanelPage, name: string) {
  await panel
    .getByRole("searchbox", { name: "Search native tree nodes" })
    .fill(name);
  return panel.getByRole("treeitem", { name: new RegExp(`^button "${name}"`) });
}

/** Add a button the native tree has never seen. */
async function addButton(page: PanelPage, name: string): Promise<void> {
  await page.evaluate((text) => {
    const button = document.createElement("button");
    button.textContent = text;
    document.body.append(button);
  }, name);
}

test("a page change reaches the native tree without Refresh", async ({
  nav,
}) => {
  const page = await showNative(nav, "native-panel.html");
  const added = await findRow(nav.panel, "Added later");
  await expect(added).toHaveCount(0);

  await addButton(page, "Added later");
  // Quiet period plus the minimum gap after the auto-load's own read.
  await expect(added).toBeVisible({ timeout: 15_000 });
  // An automatic read leaves no status of its own behind beyond the count.
  await expect(nav.panel.locator(".sn-page-url[aria-live]")).not.toContainText(
    "paused",
  );
});

test("a same-tab navigation shows the new page's native tree", async ({
  nav,
}) => {
  const page = await showNative(nav, "native-panel.html");
  await expect(
    nav.panel.getByRole("treeitem", {
      name: /^heading H1 "Native panel fixture"/,
    }),
  ).toBeVisible();

  await page.goto(new URL("/accordion.html", page.url()).href);
  await expect(
    nav.panel.getByRole("treeitem", { name: /^heading H1 "Accordion"/ }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    nav.panel.getByRole("treeitem", {
      name: /^heading H1 "Native panel fixture"/,
    }),
  ).toHaveCount(0);
});

test("a tab switch disarms it: the new tab's changes wait for Refresh", async ({
  nav,
}) => {
  await showNative(nav, "native-panel.html");

  const second = await nav.open("tree-view.html");
  await second.page.bringToFront();
  await expect
    .poll(() => nav.panel.locator(".sn-node").count(), { timeout: 5_000 })
    .toBe(0);

  // The change signal arrives, but no read on this tab has succeeded yet,
  // so nothing attaches to it. Long enough for the quiet period and the
  // minimum gap both to have passed.
  await addButton(second.page, "Added on the second tab");
  await nav.panel.waitForTimeout(5_000);
  expect(await nav.panel.locator(".sn-node").count()).toBe(0);

  // Refresh reads it, and arms auto-refresh on this tab from then on.
  await nav.panel.getByRole("button", { name: "Refresh native tree" }).click();
  await expect
    .poll(() => nav.panel.locator(".sn-node").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await expect(
    await findRow(nav.panel, "Added on the second tab"),
  ).toBeVisible();
  await addButton(second.page, "Added after Refresh");
  await expect(await findRow(nav.panel, "Added after Refresh")).toBeVisible({
    timeout: 15_000,
  });
});
