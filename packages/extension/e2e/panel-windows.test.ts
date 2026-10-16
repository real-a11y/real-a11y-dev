/**
 * Each Chrome window has a side panel of its own, which shows that window's
 * tab. The service worker used to tell every panel the tab the user last
 * moved to in any window, so going to another window, or to a tab there, put
 * that tab in this window's panel: its title, its live announcements and its
 * tree.
 *
 * The harness's panel is a tab, in the window `nav.open` opens fixtures in.
 * The other windows are ones the service worker opens, as a user does.
 * Headless Chrome reports the focus a new window takes, and no later move of
 * it, so moving back to a window is left to the unit tests.
 */

import { expect, test } from "./harness";

const HERE = "Accordion / Disclosure — APG fixture";

test("a page in another window leaves this window's panel on its own", async ({
  nav,
}) => {
  const here = await nav.open("accordion.html");
  await here.page.bringToFront();
  await nav.panel.reload();
  const title = nav.panel.locator(".sn-page-title");
  await expect(title).toHaveAttribute("title", HERE, { timeout: 20_000 });
  await nav.watchPanelMessages();
  const mark = await nav.panelMessageCount();

  const other = await nav.openWindow("tabs.html");
  // Every panel hears of the other window's tab; that window's panel takes it.
  await expect
    .poll(
      async () =>
        (await nav.panelMessages("ACTIVE_TAB_CHANGED", mark)).some(
          (m) => m.tabId === other.tabId,
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
  // Time for that page's tree to arrive, which a panel showing it would take.
  await nav.panel.waitForTimeout(1_000);

  await expect(title).toHaveAttribute("title", HERE);
  expect(await nav.boundTabs()).not.toContain(other.tabId);
});

test("a popup shows in the panel of the window the user was in, until it closes", async ({
  nav,
}) => {
  const here = await nav.open("accordion.html");
  await here.page.bringToFront();
  await nav.panel.reload();
  const title = nav.panel.locator(".sn-page-title");
  await expect(title).toHaveAttribute("title", HERE, { timeout: 20_000 });

  // A login window, say: a popup has no side panel of its own.
  const popup = await nav.openWindow("tabs.html", "popup");
  await expect
    .poll(() => nav.boundTabs(), { timeout: 20_000 })
    .toEqual([here.tabId, popup.tabId]);

  await nav.closeWindow(popup.windowId);
  await expect
    .poll(() => nav.boundTabs(), { timeout: 20_000 })
    .toEqual([here.tabId, popup.tabId, here.tabId]);
});
