/**
 * The TAB view in Chrome's tree (`NativeTreeView.tsx`). Chrome's tree carries
 * no tab order — `tabindex` never reaches a native node — so the view lists
 * the in-page walk's tab stops, as the CLI's `tabs` does. Until it came,
 * seeing a page's tab order with native mode on meant switching to the
 * in-page tree in Settings.
 *
 * `tab-order.html` puts two positive tabindexes after the elements they come
 * before, so a list in document order fails here.
 */

import { expect, test } from "./harness";

type PanelPage = import("@playwright/test").Page;

/**
 * Route the panel's `HIGHLIGHT_NODE` to the page, as the background does for
 * a real side panel: to the frame its node id names, with the frame-local
 * id. This harness loads the panel as a tab, so the background reads its
 * messages as a content script's and never forwards them (see the
 * DOM-producer note in `harness.ts`). Install it after the panel's last
 * reload, which drops it.
 */
async function routeHighlightToPage(panel: PanelPage): Promise<void> {
  await panel.evaluate(() => {
    const real = chrome.runtime.sendMessage.bind(chrome.runtime) as (
      message: unknown,
      ...rest: unknown[]
    ) => Promise<unknown>;
    chrome.runtime.sendMessage = ((message: unknown, ...rest: unknown[]) => {
      const m = message as {
        type?: unknown;
        tabId?: unknown;
        payload?: { nodeId?: string };
      } | null;
      if (m?.type !== "HIGHLIGHT_NODE" || typeof m.tabId !== "number") {
        return real(message, ...rest);
      }
      const id = m.payload?.nodeId ?? "";
      const framed = /^f(\d+)-(.+)$/.exec(id);
      void chrome.tabs.sendMessage(
        m.tabId,
        { ...m, payload: { ...m.payload, nodeId: framed ? framed[2] : id } },
        { frameId: framed ? Number(framed[1]) : 0 },
      );
      return undefined;
    }) as typeof chrome.runtime.sendMessage;
  });
}

const TAB_ORDER = ["First explicit", "Second explicit", "One", "Two", "Name"];

/** The A11Y / TAB toggle in Chrome's tree's toolbar. */
const views = (panel: PanelPage) =>
  panel.getByRole("group", { name: "Native tree view" });

test("TAB lists the page's tab stops in the order Tab visits them, with no native read", async ({
  nav,
}) => {
  const page = await nav.showNative("tab-order.html");
  const a11y = views(nav.panel).getByRole("button", {
    name: "A11Y",
    exact: true,
  });
  const tab = views(nav.panel).getByRole("button", {
    name: "TAB",
    exact: true,
  });
  await expect(a11y).toHaveAttribute("aria-pressed", "true");
  const reads = (await nav.nativeReads()).length;

  await tab.click();
  await expect(tab).toHaveAttribute("aria-pressed", "true");
  await expect(nav.nativeTree()).toHaveCount(0);
  const list = nav.panel.getByRole("listbox", { name: "Tab sequence" });
  await expect(list.locator(".sn-tab-name")).toHaveText(TAB_ORDER);

  // The order Tab really visits on the page.
  await page.bringToFront();
  const visited: string[] = [];
  for (const _ of TAB_ORDER) {
    await page.keyboard.press("Tab");
    visited.push(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLInputElement | null;
        return (el?.labels?.[0] ?? el)?.textContent?.trim() ?? "";
      }),
    );
  }
  expect(visited).toEqual(TAB_ORDER);

  // The list is the in-page walk's: showing it read nothing natively, so
  // Chrome's debugging bar never came up for it.
  await nav.panel.waitForTimeout(1_500);
  expect(await nav.nativeReads()).toHaveLength(reads);

  // Back to Chrome's tree.
  await a11y.click();
  await expect(nav.nativeTree()).toBeVisible();
  await expect(list).toHaveCount(0);
});

test("a stop moves the page's focus through the content script, as in the in-page tree", async ({
  nav,
}) => {
  const page = await nav.showNative("tab-order.html");
  await routeHighlightToPage(nav.panel);
  await views(nav.panel)
    .getByRole("button", { name: "TAB", exact: true })
    .click();
  const list = nav.panel.getByRole("listbox", { name: "Tab sequence" });

  // Selecting a stop moves the page's focus to its element, and so does
  // Move to, through the in-page walk's own element ids.
  await list.getByRole("option", { name: /Two/ }).click();
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.textContent))
    .toBe("Two");
  await list.getByRole("option", { name: /One/ }).click();
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await nav.panel.getByRole("button", { name: "Move to", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.textContent))
    .toBe("One");

  // A search narrows the list, and the toolbar counts what it leaves.
  // The search box says what it searches while the tab order shows.
  await nav.panel.getByLabel("Search tab stops").fill("explicit");
  await expect(list.locator(".sn-tab-name")).toHaveText([
    "First explicit",
    "Second explicit",
  ]);
  await expect(nav.panel.locator(".sn-search-count")).toHaveText("2 matches");
});
