/**
 * `aria-controls` jump chips in the native tree, through the real build.
 *
 * Chromium resolves `aria-controls` itself and sends it as an `idrefList`
 * property naming its targets by `backendDOMNodeId`, with no scalar value.
 * The native read maps those targets to row ids, keeping only the ones the
 * tree has: a hidden tab panel isn't in the tree, so its tab gets no chip.
 */

import { expect, node, test, type NativeHarness } from "./harness";

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

test("NATIVE: a node carries the ids of the rows it controls, over the wire", async ({
  nav,
}) => {
  const { tabId } = await nav.open("tabs.html");
  const tree = await nav.readNodes(tabId);

  const panel = node(tree, "tabpanel", "Nils Frahm");
  expect(node(tree, "tab", "Nils Frahm").controls).toEqual([panel.id]);
  // A hidden panel isn't in the tree, so there is nothing to point at.
  expect(node(tree, "tab", "Agnes Obel").controls).toBeUndefined();
  expect(node(tree, "tab", "Joke Bot").controls).toBeUndefined();
});

test("a jump chip selects the row it controls, and the reverse chip comes back", async ({
  nav,
}) => {
  await showNative(nav, "tabs.html");
  await nav.panel.getByRole("button", { name: "Expand all" }).click();

  const tab = nav.panel.getByRole("treeitem", { name: /^tab "Nils Frahm"/ });
  // Only the tab whose panel is in the tree gets a chip.
  await expect(tab.locator(".sn-controls-link")).toHaveText(
    '→ tabpanel "Nils Frahm"',
  );
  await expect(
    nav.panel
      .getByRole("treeitem", { name: /^tab "Agnes Obel"/ })
      .locator(".sn-controls-link"),
  ).toHaveCount(0);

  await tab.locator(".sn-controls-link").click();
  const selected = nav.panel.locator('[role="treeitem"][aria-selected="true"]');
  await expect(selected).toContainText("tabpanel");
  await expect(selected).toContainText("Nils Frahm");

  await selected.locator(".sn-controls-link--reverse").click();
  await expect(
    nav.panel.locator('[role="treeitem"][aria-selected="true"] .sn-role'),
  ).toHaveText("tab");
});

test("a jump chip leaves a scope its target sits outside", async ({ nav }) => {
  await showNative(nav, "tabs.html");
  await nav.panel.getByRole("button", { name: "Expand all" }).click();

  // Scope to the tablist: the panel the tab controls is outside it.
  await nav.panel
    .getByRole("treeitem", { name: /^tablist "Entertainment"/ })
    .dblclick();
  await expect(nav.panel.locator(".sn-scope-bar")).toBeVisible();

  await nav.panel
    .getByRole("treeitem", { name: /^tab "Nils Frahm"/ })
    .locator(".sn-controls-link")
    .click();
  await expect(nav.panel.locator(".sn-scope-bar")).toHaveCount(0);
  await expect(
    nav.panel.locator('[role="treeitem"][aria-selected="true"] .sn-role'),
  ).toHaveText("tabpanel");
});
