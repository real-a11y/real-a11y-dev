/**
 * What the side panel keeps while Chrome's tree changes shape under it within
 * one page, through the real build: the rows the user opened, when a modal
 * dialog moves the tree's root to itself and back (`use-tree-expansion.ts`),
 * and the selection, when a read wraps the selected row in a new one, which
 * the read opens (the ui package's `useTreeChanges`).
 */

import { expect, test } from "./harness";

type PanelPage = import("@playwright/test").Page;

/** A row of Chrome's tree, by its role and the start of its name. */
function row(panel: PanelPage, role: string, name: string) {
  return panel.getByRole("treeitem", { name: new RegExp(`^${role} "${name}`) });
}

test("a row the user opened stays open through a modal dialog opening and closing", async ({
  nav,
}) => {
  await nav.showNative("tree-reshape.html");
  const basket = row(nav.panel, "region", "Basket");
  await expect(basket).toHaveAttribute("aria-expanded", "false");
  await basket.locator(".sn-toggle").click();
  await expect(basket).toHaveAttribute("aria-expanded", "true");
  await expect(row(nav.panel, "list", "Items")).toBeVisible();

  const tree = nav.nativeTree();
  await row(nav.panel, "button", "Add delivery address").click();
  await tree.press("Enter");
  // The page leaves Chrome's tree, and the dialog roots it, open.
  const dialog = row(nav.panel, "dialog", "Add delivery address");
  await expect(dialog).toHaveAttribute("aria-expanded", "true", {
    timeout: 10_000,
  });
  await expect(basket).toHaveCount(0);

  await row(nav.panel, "button", "Close").click();
  await tree.press("Enter");
  await expect(basket).toBeVisible({ timeout: 10_000 });
  await expect(basket).toHaveAttribute("aria-expanded", "true");
  await expect(row(nav.panel, "list", "Items")).toBeVisible();
});

test("the selected row stays selected when a read wraps it in a new row", async ({
  nav,
}) => {
  await nav.showNative("tree-reshape.html");
  const button = row(nav.panel, "button", "Group me");
  await button.click();
  await expect(button).toHaveAttribute("aria-selected", "true");

  // The button wraps itself in a new group: the read after it brings the
  // group, closed but for the read opening it.
  await nav.nativeTree().press("Enter");
  const group = row(nav.panel, "group", "Grouped");
  await expect(group).toHaveAttribute("aria-expanded", "true", {
    timeout: 10_000,
  });
  await expect(button).toHaveAttribute("aria-selected", "true");
});
