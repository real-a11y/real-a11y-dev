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
