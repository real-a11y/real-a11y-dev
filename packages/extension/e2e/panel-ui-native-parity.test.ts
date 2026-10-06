/**
 * The native tree's share of the DOM tree's everyday UI, through the real
 * build: the keyboard bar and the dialog indicator, type-ahead, Enter and
 * Shift+Enter on a slider, and action feedback that names the node rather
 * than its id.
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

/**
 * Route the panel's `SEND_KEY` to the page's top frame, as the background
 * does for a real side panel. This harness loads the panel as a tab, so the
 * background reads its messages as a content script's and never forwards a
 * key to the page (see the DOM-producer note in `harness.ts`). Only `SEND_KEY`
 * is rerouted; everything else goes through untouched. Install it after the
 * panel's last reload, which would drop it.
 */
async function routeSendKeyToPage(panel: PanelPage): Promise<void> {
  await panel.evaluate(() => {
    const real = chrome.runtime.sendMessage.bind(chrome.runtime) as (
      message: unknown,
      ...rest: unknown[]
    ) => Promise<unknown>;
    chrome.runtime.sendMessage = ((message: unknown, ...rest: unknown[]) => {
      const m = message as { type?: unknown; tabId?: unknown } | null;
      if (m?.type !== "SEND_KEY" || typeof m.tabId !== "number") {
        return real(message, ...rest);
      }
      const callback = rest.find((r) => typeof r === "function") as
        ((response: unknown) => void) | undefined;
      chrome.tabs.sendMessage(m.tabId, m, { frameId: 0 }, (response) => {
        callback?.(chrome.runtime.lastError ? undefined : response);
      });
      return undefined;
    }) as typeof chrome.runtime.sendMessage;
  });
}

/** Click a panel button from inside the panel. A Playwright click would bring
 *  the panel's own tab to the front, and `SEND_KEY` goes to the panel's bound
 *  tab — see `field-values.test.ts`'s `press`. */
async function clickInPanel(
  panel: PanelPage,
  scope: string,
  label: string,
): Promise<void> {
  await panel.evaluate(
    ([sel, want]) => {
      const button = [...document.querySelectorAll(`${sel} button`)].find(
        (b) => b.textContent?.trim() === want,
      ) as HTMLButtonElement | undefined;
      if (!button) throw new Error(`no button "${want}" in ${sel}`);
      button.click();
    },
    [scope, label] as const,
  );
}

test("a modal dialog shows the dialog indicator, and Press ESC closes it", async ({
  nav,
}) => {
  const page = await showNative(nav, "dialog-modal.html");
  await routeSendKeyToPage(nav.panel);

  await nav.panel
    .getByRole("treeitem", { name: /^button "Add delivery address"/ })
    .getByTitle("Click (Enter)")
    .click();
  // Named, not the node's id.
  await expect(nav.panel.locator(".sn-action-feedback")).toContainText(
    "Click: Add delivery address",
  );
  await expect
    .poll(() => page.evaluate(() => document.querySelector("dialog")!.open))
    .toBe(true);

  // The action's own re-read brings the dialog into the tree.
  const indicator = nav.panel.locator(".sn-dialog-indicator");
  await expect(indicator).toContainText("Dialog: Add delivery address", {
    timeout: 10_000,
  });

  await clickInPanel(nav.panel, ".sn-dialog-indicator", "Press ESC");
  await expect
    .poll(() => page.evaluate(() => document.querySelector("dialog")!.open))
    .toBe(false);
  // And the tree is read again after the key, so the indicator goes.
  await expect(indicator).toHaveCount(0, { timeout: 10_000 });
});

test("the keyboard bar sends a key to the page from the native tree", async ({
  nav,
}) => {
  const page = await showNative(nav, "native-panel.html");
  await routeSendKeyToPage(nav.panel);

  // Selecting a row moves the page's focus to its element (#412).
  await nav.panel.getByRole("treeitem", { name: /^button "Item 2"/ }).click();
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.id))
    .toBe("item-2");

  await clickInPanel(nav.panel, ".sn-keyboard-bar", "Tab");
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.id))
    .toBe("item-3");
  await expect(nav.panel.locator(".sn-action-feedback")).toContainText(
    "Sent key: Tab",
  );
});

test("a sent key that navigates the page re-reads the native tree there", async ({
  nav,
}) => {
  const page = await showNative(nav, "native-nav-key.html");
  await routeSendKeyToPage(nav.panel);

  await clickInPanel(nav.panel, ".sn-keyboard-bar", "Enter");
  await page.waitForURL(/tree-view\.html/);

  // No refresh: the navigation clears the native tree, and the key's own
  // re-read follows the page to its destination, as a native click does.
  // "Tree View" is the new page's own heading.
  await expect(
    nav.panel.getByRole("treeitem", { name: "Tree View" }),
  ).toBeVisible({ timeout: 10_000 });
});

test("Enter steps a native slider up and Shift+Enter steps it down", async ({
  nav,
}) => {
  const page = await showNative(nav, "slider-single.html");
  const valueNow = () =>
    page.evaluate(() =>
      document.getElementById("temp-thumb")!.getAttribute("aria-valuenow"),
    );

  await nav.panel.getByRole("button", { name: "Expand all" }).click();
  await nav.panel
    .getByRole("treeitem", { name: /^slider "Temperature"/ })
    .click();
  const tree = nav.panel.getByRole("tree");

  await tree.press("Enter");
  await expect.poll(valueNow).toBe("69");
  // The panel holds the next key while the step and its re-read are in
  // flight, so wait for it to settle.
  await expect(
    nav.panel.getByRole("button", { name: "Refresh native tree" }),
  ).toBeEnabled();
  await tree.press("Shift+Enter");
  await expect.poll(valueNow).toBe("68");
  // A step shows no banner, as in the DOM tree.
  await expect(nav.panel.locator(".sn-action-feedback-text")).toHaveCount(0);
});

test("type-ahead moves the native tree's selection", async ({ nav }) => {
  await showNative(nav, "native-panel.html");
  await nav.panel.getByRole("button", { name: "Expand all" }).click();
  await nav.panel.getByRole("treeitem", { name: /^button "Item 2"/ }).click();

  // "Native panel fixture" is the only row whose name starts with "n".
  await nav.panel.getByRole("tree").press("n");
  await expect(
    nav.panel.locator('[role="treeitem"][aria-selected="true"]'),
  ).toContainText("Native panel fixture");
});

test("an iframe row is marked embedded, since the native read skips its content", async ({
  nav,
}) => {
  await showNative(nav, "pick-mode.html");
  await nav.panel.getByRole("button", { name: "Expand all" }).click();
  // Whatever Chromium names the frame, its row carries the badge.
  await expect(
    nav.panel.locator(".sn-node .sn-iframe-badge", { hasText: "embedded" }),
  ).toHaveCount(1);
});

/**
 * How long a test gives the panel to do something it must NOT do (read the
 * native tree) before checking it didn't. Each such check is preceded by the
 * same step without the thing under test, which must read within this kind
 * of wait, so the window isn't vacuous.
 */
const NO_READ_WINDOW_MS = 1_500;

/** Make the panel's next NATIVE_ACTs fail: refused by the service worker, or
 *  never answered (the message rejects, as when the worker can't wake). */
async function failNativeActs(
  panel: PanelPage,
  how: "refuse" | "reject",
): Promise<void> {
  await panel.evaluate((how) => {
    const real = chrome.runtime.sendMessage.bind(chrome.runtime) as (
      message: unknown,
      ...rest: unknown[]
    ) => Promise<unknown>;
    chrome.runtime.sendMessage = ((message: unknown, ...rest: unknown[]) => {
      if ((message as { type?: unknown } | null)?.type !== "NATIVE_ACT") {
        return real(message, ...rest);
      }
      return how === "refuse"
        ? Promise.resolve({ success: false, error: "the page refused" })
        : Promise.reject(new Error("Receiving end does not exist."));
    }) as typeof chrome.runtime.sendMessage;
  }, how);
}

test("an aria-modal dialog that Escape can't close says so", async ({
  nav,
}) => {
  await showNative(nav, "dialog-aria-modal.html");
  await routeSendKeyToPage(nav.panel);

  const indicator = nav.panel.locator(".sn-dialog-indicator");
  await expect(indicator).toContainText("Dialog: Cookie settings");
  await clickInPanel(nav.panel, ".sn-dialog-indicator", "Press ESC");

  await expect(nav.panel.locator(".sn-action-feedback")).toContainText(
    "The dialog is still open",
    { timeout: 10_000 },
  );
  await expect(indicator).toContainText("Dialog: Cookie settings");
});

test("a sent key whose page navigates a second later is followed there", async ({
  nav,
}) => {
  const page = await showNative(nav, "native-nav-key-async.html");
  await routeSendKeyToPage(nav.panel);

  await clickInPanel(nav.panel, ".sn-keyboard-bar", "Enter");
  // The key's own re-read reads this page first; the navigation comes after.
  await page.waitForURL(/tree-view\.html/);
  await expect(
    nav.panel.getByRole("treeitem", { name: "Tree View" }),
  ).toBeVisible({ timeout: 10_000 });
});

test("switching to DOM right after a sent key reads no native tree", async ({
  nav,
}) => {
  await showNative(nav, "native-panel.html");
  await routeSendKeyToPage(nav.panel);

  // Without the switch, the key is followed by a native read.
  let reads = (await nav.nativeReads()).length;
  await clickInPanel(nav.panel, ".sn-keyboard-bar", "Tab");
  await expect
    .poll(async () => (await nav.nativeReads()).length, { timeout: 10_000 })
    .toBeGreaterThan(reads);
  await expect(
    nav.panel.getByRole("button", { name: "Refresh native tree" }),
  ).toBeEnabled();

  // With it, in the same task as the key, there is none.
  reads = (await nav.nativeReads()).length;
  await nav.panel.evaluate(() => {
    const press = [
      ...document.querySelectorAll<HTMLButtonElement>(
        ".sn-keyboard-bar button",
      ),
    ].find((b) => b.textContent?.trim() === "Tab")!;
    const dom = [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[aria-label="Tree producer"] button',
      ),
    ].find((b) => b.textContent?.trim() === "DOM")!;
    press.click();
    dom.click();
  });
  await nav.panel.waitForTimeout(NO_READ_WINDOW_MS);
  expect((await nav.nativeReads()).length).toBe(reads);
});

test("a refused native action says Failed in the feedback bar", async ({
  nav,
}) => {
  await showNative(nav, "native-parity.html");
  await nav.panel.getByRole("button", { name: "Expand all" }).click();
  await failNativeActs(nav.panel, "refuse");
  await nav.panel
    .getByRole("treeitem", { name: /^checkbox "Gift wrap"/ })
    .getByTitle("Click (Enter)")
    .click();
  await expect(nav.panel.locator(".sn-action-feedback")).toContainText(
    "Failed: the page refused",
  );
});

test("a native action the extension never answers says Failed too", async ({
  nav,
}) => {
  await showNative(nav, "native-parity.html");
  await nav.panel.getByRole("button", { name: "Expand all" }).click();
  await failNativeActs(nav.panel, "reject");
  await nav.panel
    .getByRole("treeitem", { name: /^checkbox "Gift wrap"/ })
    .getByTitle("Click (Enter)")
    .click();
  await expect(nav.panel.locator(".sn-action-feedback")).toContainText(
    "Failed: the extension didn't answer",
  );
});

test("a checkbox and a radio word their feedback as the DOM tree does", async ({
  nav,
}) => {
  await showNative(nav, "native-parity.html");
  await nav.panel.getByRole("button", { name: "Expand all" }).click();
  const feedback = nav.panel.locator(".sn-action-feedback");

  await nav.panel
    .getByRole("treeitem", { name: /^checkbox "Gift wrap"/ })
    .getByTitle("Click (Enter)")
    .click();
  await expect(feedback).toContainText("Checked: Gift wrap");

  await expect(
    nav.panel.getByRole("button", { name: "Refresh native tree" }),
  ).toBeEnabled();
  await nav.panel
    .getByRole("treeitem", { name: /^radio "Small"/ })
    .getByTitle("Click (Enter)")
    .click();
  await expect(feedback).toContainText("Selected: Small");
});

test("Enter opens a native spinbutton's edit box and Shift+Enter steps it down", async ({
  nav,
}) => {
  const page = await showNative(nav, "native-parity.html");
  const value = () =>
    page.evaluate(
      () => (document.getElementById("qty") as HTMLInputElement).value,
    );
  await nav.panel.getByRole("button", { name: "Expand all" }).click();
  await nav.panel
    .getByRole("treeitem", { name: /^spinbutton "Quantity"/ })
    .click();
  const tree = nav.panel.getByRole("tree");

  await tree.press("Enter");
  await expect(nav.panel.locator(".sn-input-panel")).toBeVisible();
  await nav.panel.locator(".sn-input-panel-field").press("Escape");
  await expect(nav.panel.locator(".sn-input-panel")).toHaveCount(0);
  expect(await value()).toBe("3");

  await tree.press("Shift+Enter");
  await expect.poll(value).toBe("2");
});

test("* opens every sibling group, a heading shows an H badge, and the hints name DblClick", async ({
  nav,
}) => {
  await showNative(nav, "native-parity.html");
  const heading = nav.panel.getByRole("treeitem", {
    name: /^heading H2 "Billing"/,
  });
  await expect(heading.locator(".sn-level-badge")).toHaveText("H2");
  await expect(nav.panel.locator(".sn-hints")).toContainText("DblClick scope");

  const gift = nav.panel.getByRole("treeitem", {
    name: /^checkbox "Gift wrap"/,
  });
  const small = nav.panel.getByRole("treeitem", { name: /^radio "Small"/ });
  // Close everything but the document, so both groups start closed.
  await nav.panel.getByRole("button", { name: "Collapse all" }).click();
  await nav.panel.getByRole("treeitem", { name: "document" }).click();
  await nav.panel.getByRole("tree").press("ArrowRight");
  await expect(gift).toHaveCount(0);
  await expect(small).toHaveCount(0);
  await heading.click();
  await nav.panel.getByRole("tree").press("*");
  await expect(gift).toBeVisible();
  await expect(small).toBeVisible();
});
