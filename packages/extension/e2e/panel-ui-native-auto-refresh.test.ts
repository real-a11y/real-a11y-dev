/**
 * Native auto-refresh, through the real build.
 *
 * By default the native tree reads itself again once, after a same-tab
 * navigation settles, and otherwise waits for Refresh, an action or a key.
 * With "Follow page changes" on, it also reads after every burst of page
 * changes, backing off the longer that runs on without the user
 * (`native-auto-refresh.ts` is the policy). Either way it follows only the
 * tab a read succeeded on, and only the top frame's changes.
 */

import {
  AUTO_REFRESH_MIN_GAP_MS,
  AUTO_REFRESH_QUIET_MS,
} from "../src/sidepanel/native-auto-refresh.ts";

import { expect, test, type NativeHarness } from "./harness";

type PanelPage = import("@playwright/test").Page;

/**
 * Long enough for a change to have been read, had it been going to be: the
 * quiet period, the minimum gap after the read before it, and a margin for
 * the read itself. A check that nothing was read waits this long, and each
 * suite pairs it with a case that does read within it.
 */
const READ_WINDOW_MS = AUTO_REFRESH_QUIET_MS + AUTO_REFRESH_MIN_GAP_MS + 2_000;

/** Automatic reads sent since the panel last loaded. */
async function autoReads(nav: NativeHarness): Promise<number> {
  return (await nav.nativeReads()).filter((r) => r.auto).length;
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

/** Turn "Follow page changes" on. */
async function followPageChanges(panel: PanelPage): Promise<void> {
  const toggle = panel.getByRole("button", { name: "Follow page changes" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
}

test.afterEach(async ({ nav }) => {
  // The setting persists in the worker's profile; start each test without it.
  await nav.panel.evaluate(() =>
    chrome.storage.local.remove("settings.nativeFollowPageChanges"),
  );
});

test.describe("by default", () => {
  test("a page change waits for Refresh", async ({ nav }) => {
    const page = await nav.showNative("native-panel.html");
    await addButton(page, "Added later");
    await nav.panel.waitForTimeout(READ_WINDOW_MS);
    expect(await autoReads(nav)).toBe(0);

    await nav.panel
      .getByRole("button", { name: "Refresh native tree" })
      .click();
    await expect(await findRow(nav.panel, "Added later")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("a same-tab navigation shows the new page's native tree", async ({
    nav,
  }) => {
    const page = await nav.showNative("native-panel.html");
    await expect(
      nav.panel.getByRole("treeitem", {
        name: /^heading H1 "Native panel fixture"/,
      }),
    ).toBeVisible();

    await page.goto(new URL("/accordion.html", page.url()).href);
    await expect(
      nav.panel.getByRole("treeitem", { name: /^heading H1 "Accordion"/ }),
    ).toBeVisible({ timeout: READ_WINDOW_MS });
    await expect(
      nav.panel.getByRole("treeitem", {
        name: /^heading H1 "Native panel fixture"/,
      }),
    ).toHaveCount(0);
    // Once: the new page's later changes wait for Refresh again.
    const reads = await autoReads(nav);
    expect(reads).toBe(1);
    await addButton(page, "Added on the new page");
    await nav.panel.waitForTimeout(READ_WINDOW_MS);
    expect(await autoReads(nav)).toBe(reads);
  });

  test("a navigation that never commits leaves the same page's tree in place", async ({
    nav,
  }) => {
    // The panel drops its tree when a navigation starts. One answered with
    // No Content never commits, so the page, and the tree read back from it
    // next, are the same as before: that read must still fill the tree.
    const page = await nav.showNative("native-panel.html");
    const heading = nav.panel.getByRole("treeitem", {
      name: /^heading H1 "Native panel fixture"/,
    });
    await expect(heading).toBeVisible();

    await page.evaluate(() => {
      location.href = "/no-content";
    });
    // Dropped when the navigation starts…
    await expect(heading).toHaveCount(0, { timeout: 5_000 });
    // …then the page changes in a way its accessibility tree doesn't show,
    // which is the signal that the page is there.
    await page.evaluate(() => {
      const note = document.createElement("div");
      note.hidden = true;
      document.body.append(note);
    });
    await expect(heading).toBeVisible({ timeout: READ_WINDOW_MS });
    expect(new URL(page.url()).pathname).toBe("/native-panel.html");
  });
});

test.describe("with Follow page changes on", () => {
  test("a page change reaches the native tree without Refresh", async ({
    nav,
  }) => {
    const page = await nav.showNative("native-panel.html");
    await followPageChanges(nav.panel);
    const added = await findRow(nav.panel, "Added later");
    await expect(added).toHaveCount(0);

    await addButton(page, "Added later");
    await expect(added).toBeVisible({ timeout: READ_WINDOW_MS });
    // An automatic read says nothing in the status line, a live region: it
    // would be announced every few seconds.
    await expect(
      nav.panel.locator(".sn-page-url[aria-live]"),
    ).not.toContainText("reading");
  });

  test("a subframe's changes don't prompt a read of the top frame", async ({
    nav,
  }) => {
    const page = await nav.showNative("pick-mode.html");
    await followPageChanges(nav.panel);
    const frame = page.frames().find((f) => f !== page.mainFrame())!;
    await frame.evaluate(() => {
      const p = document.createElement("p");
      p.textContent = "changed inside the frame";
      document.body.append(p);
    });
    await nav.panel.waitForTimeout(READ_WINDOW_MS);
    expect(await autoReads(nav)).toBe(0);

    // The top frame's own change does.
    await addButton(page, "Added to the top frame");
    await expect
      .poll(() => autoReads(nav), { timeout: READ_WINDOW_MS })
      .toBe(1);
  });

  test("a page that never goes quiet is still read, and backs off", async ({
    nav,
  }) => {
    const page = await nav.showNative("native-panel.html");
    await followPageChanges(nav.panel);
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
      timeout: READ_WINDOW_MS,
    });

    // A navigation starts the back-off over: the new page is read at once,
    // not after the gap the ticking page built up.
    await expect
      .poll(() => autoReads(nav), { timeout: 30_000 })
      .toBeGreaterThanOrEqual(4);
    await page.goto(new URL("/accordion.html", page.url()).href);
    await expect(
      nav.panel.getByRole("treeitem", { name: /^heading H1 "Accordion"/ }),
    ).toBeVisible({ timeout: READ_WINDOW_MS });
  });

  test("a tab switch disarms it: the new tab's changes wait for Refresh", async ({
    nav,
  }) => {
    await nav.showNative("native-panel.html");
    await followPageChanges(nav.panel);

    const second = await nav.open("tree-view.html");
    await second.page.bringToFront();
    await expect
      .poll(() => nav.panel.locator(".sn-node").count(), { timeout: 5_000 })
      .toBe(0);

    // The change signal arrives, but no read on this tab has succeeded yet,
    // so nothing attaches to it.
    await addButton(second.page, "Added on the second tab");
    await nav.panel.waitForTimeout(READ_WINDOW_MS);
    expect(await nav.panel.locator(".sn-node").count()).toBe(0);
    expect(await autoReads(nav)).toBe(0);

    // Refresh reads it, and arms auto-refresh on this tab from then on.
    await nav.panel
      .getByRole("button", { name: "Refresh native tree" })
      .click();
    await expect(
      await findRow(nav.panel, "Added on the second tab"),
    ).toBeVisible({ timeout: 20_000 });
    await addButton(second.page, "Added after Refresh");
    await expect(await findRow(nav.panel, "Added after Refresh")).toBeVisible({
      timeout: READ_WINDOW_MS,
    });
  });

  test("a reveal goes out during an automatic read", async ({ nav }) => {
    // An automatic read doesn't change the ids a reveal names, so it doesn't
    // hold one back the way a read the user started does.
    const page = await nav.showNative("native-panel.html");
    await followPageChanges(nav.panel);
    await nav.setNativeReads("delay:3000");
    await addButton(page, "Added later");
    await expect
      .poll(() => autoReads(nav), { timeout: READ_WINDOW_MS })
      .toBe(1);

    // The read is in flight for 3 s from here.
    await nav.panel
      .getByRole("treeitem", { name: /^heading H1 "Native panel fixture"/ })
      .click();
    await expect
      .poll(
        async () =>
          (await nav.nativeActs()).filter((a) => a.action === "reveal").length,
        { timeout: 2_000 },
      )
      .toBe(1);
  });

  test("a failed automatic read pauses it, keeps the tree, and Refresh resumes it", async ({
    nav,
  }) => {
    const page = await nav.showNative("native-panel.html");
    await followPageChanges(nav.panel);

    // Fail every automatic read as the user's Cancel on Chrome's debugging
    // bar does. A read the user asked for goes through untouched.
    await nav.panel.evaluate(() => {
      const w = window as typeof window & { __failAutoReads?: boolean };
      w.__failAutoReads = true;
      const real = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = ((message: unknown, ...rest: unknown[]) => {
        const m = message as { type?: unknown; auto?: unknown } | null;
        if (m?.type === "NATIVE_READ" && m.auto === true && w.__failAutoReads) {
          return Promise.resolve({ ok: false, error: "cancelled-by-user" });
        }
        return (
          real as (message: unknown, ...rest: unknown[]) => Promise<unknown>
        )(message, ...rest);
      }) as typeof chrome.runtime.sendMessage;
    });
    const status = nav.panel.locator(".sn-page-url[aria-live]");
    const rows = () => nav.panel.locator(".sn-node").count();

    await addButton(page, "First change");
    await expect(status).toContainText(
      "auto-refresh paused — you cancelled Chrome's debugging bar",
      { timeout: READ_WINDOW_MS },
    );
    await expect(status).toContainText("Refresh to resume");
    const reads = await autoReads(nav);
    // The tree it had stays up.
    expect(await rows()).toBeGreaterThan(0);

    // Paused: a later change doesn't try again.
    await addButton(page, "Second change");
    await nav.panel.waitForTimeout(READ_WINDOW_MS);
    expect(await autoReads(nav)).toBe(reads);

    // Refresh reads both changes and arms it again.
    await nav.panel.evaluate(() => {
      (
        window as typeof window & { __failAutoReads?: boolean }
      ).__failAutoReads = false;
    });
    await nav.panel
      .getByRole("button", { name: "Refresh native tree" })
      .click();
    await expect(status).toContainText(/^\d+ nodes$/);
    await expect(await findRow(nav.panel, "Second change")).toBeVisible();
    await addButton(page, "Third change");
    await expect(await findRow(nav.panel, "Third change")).toBeVisible({
      timeout: READ_WINDOW_MS,
    });
    expect(await autoReads(nav)).toBeGreaterThan(reads);
  });
});
