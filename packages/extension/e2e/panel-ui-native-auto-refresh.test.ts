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

test("a page that never goes quiet is still read, every few seconds", async ({
  nav,
}) => {
  const page = await showNative(nav, "native-panel.html");
  // A ticking clock: a change every 400 ms, closer together than the quiet
  // period, for as long as the test runs.
  await page.evaluate(() => {
    const clock = document.createElement("p");
    document.body.append(clock);
    let n = 0;
    setInterval(() => {
      clock.textContent = `tick ${++n}`;
    }, 400);
  });
  await addButton(page, "Added while ticking");
  await expect(await findRow(nav.panel, "Added while ticking")).toBeVisible({
    timeout: 15_000,
  });
});

test("a failed automatic read pauses it, keeps the tree, and Refresh resumes it", async ({
  nav,
}) => {
  const page = await showNative(nav, "native-panel.html");

  // Fail every automatic read as a dropped connection — what the user's
  // Cancel on Chrome's debugging notice looks like — and count them. A read
  // the user asked for goes through untouched.
  await nav.panel.evaluate(() => {
    const w = window as typeof window & {
      __autoReads?: number;
      __failAutoReads?: boolean;
    };
    w.__autoReads = 0;
    w.__failAutoReads = true;
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = ((message: unknown, ...rest: unknown[]) => {
      const m = message as { type?: unknown; auto?: unknown } | null;
      if (m?.type === "NATIVE_READ" && m.auto === true) {
        w.__autoReads = (w.__autoReads ?? 0) + 1;
        if (w.__failAutoReads) {
          return Promise.resolve({ ok: false, error: "connection-lost" });
        }
      }
      return (
        real as (message: unknown, ...rest: unknown[]) => Promise<unknown>
      )(message, ...rest);
    }) as typeof chrome.runtime.sendMessage;
  });
  const autoReads = () =>
    nav.panel.evaluate(
      () => (window as typeof window & { __autoReads?: number }).__autoReads,
    );
  const status = nav.panel.locator(".sn-page-url[aria-live]");
  const rows = () => nav.panel.locator(".sn-node").count();

  await addButton(page, "First change");
  await expect(status).toContainText("auto-refresh paused", {
    timeout: 15_000,
  });
  await expect(status).toContainText("Refresh to resume");
  expect(await autoReads()).toBe(1);
  // The tree it had stays up.
  expect(await rows()).toBeGreaterThan(0);

  // Paused: a later change doesn't try again.
  await addButton(page, "Second change");
  await nav.panel.waitForTimeout(5_000);
  expect(await autoReads()).toBe(1);

  // Refresh reads both changes and arms it again.
  await nav.panel.evaluate(() => {
    (window as typeof window & { __failAutoReads?: boolean }).__failAutoReads =
      false;
  });
  await nav.panel.getByRole("button", { name: "Refresh native tree" }).click();
  await expect(status).toContainText(/^\d+ nodes$/);
  await expect(await findRow(nav.panel, "Second change")).toBeVisible();
  await addButton(page, "Third change");
  await expect(await findRow(nav.panel, "Third change")).toBeVisible({
    timeout: 15_000,
  });
  expect(await autoReads()).toBeGreaterThan(1);
});
