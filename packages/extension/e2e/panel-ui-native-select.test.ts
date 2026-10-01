/**
 * The option picker for a native `<select>`, through the real build.
 *
 * Chromium gives a real `<select>` a `combobox` row with a `MenuListPopup`
 * child holding its `option` rows. Activating that row opens the panel's
 * option picker (`InputPanel`'s `SelectPicker`, the DOM tree's own), listed
 * from those rows, and choosing one dispatches the existing `select` action
 * on it. A custom `role="combobox"` has no such popup and keeps its click.
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

test("a native select opens the option picker, and choosing selects on the page", async ({
  nav,
}) => {
  const page = await showNative(nav, "listbox-select.html");
  await nav.panel.getByRole("button", { name: "Expand all" }).click();

  const department = nav.panel.getByRole("treeitem", {
    name: /^combobox "Department"/,
  });
  await expect(department.locator(".sn-action-tag")).toHaveText("Select");
  await department.getByTitle("Select (Enter)").click();

  const picker = nav.panel.getByRole("dialog", { name: "Department" });
  const options = picker.getByRole("option");
  await expect(options).toHaveText([/All Departments/, /Books/, /Music/]);
  // It opens on the current value.
  await expect(picker.getByRole("option", { selected: true })).toContainText(
    "All Departments",
  );

  await picker.getByRole("option", { name: /Books/ }).click();
  await expect(picker).toHaveCount(0);
  await expect(page.locator("#department")).toHaveValue("books");
  // A real change listener saw it.
  await expect(page.locator("#department-echo")).toHaveText("books");
  await expect(nav.panel.locator(".sn-action-feedback")).toContainText(
    "Selected: Books",
  );

  // After the action's re-read, the picker opens on the new value.
  await expect(department).toContainText('= "Books"', { timeout: 10_000 });
  await department.getByTitle("Select (Enter)").click();
  await expect(picker.getByRole("option", { selected: true })).toContainText(
    "Books",
  );
  await picker.getByRole("button", { name: "Cancel" }).click();
  await expect(picker).toHaveCount(0);
});

test("Enter on a native select row opens the picker too", async ({ nav }) => {
  await showNative(nav, "listbox-select.html");
  await nav.panel.getByRole("button", { name: "Expand all" }).click();
  await nav.panel
    .getByRole("treeitem", { name: /^combobox "Department"/ })
    .click();
  await nav.panel.getByRole("tree").press("Enter");
  await expect(
    nav.panel.getByRole("dialog", { name: "Department" }).getByRole("option"),
  ).toHaveCount(3);
});

test("a custom select-only combobox keeps its click", async ({ nav }) => {
  await showNative(nav, "combobox-select-only.html");
  const combobox = nav.panel.getByRole("treeitem", {
    name: /^combobox "Favorite Fruit"/,
  });
  await expect(combobox.locator(".sn-action-tag")).toHaveText("Click");
});

test("a sensitive select's picker shows no current option", async ({ nav }) => {
  const page = await showNative(nav, "select-sensitive.html");
  await nav.panel.getByRole("button", { name: "Expand all" }).click();

  const month = nav.panel.getByRole("treeitem", {
    name: /^combobox "Expiry month"/,
  });
  await expect(month).toContainText('= "[redacted]"');
  await month.getByTitle("Select (Enter)").click();

  const picker = nav.panel.getByRole("dialog", { name: "Expiry month" });
  await expect(picker.getByRole("option")).toHaveCount(3);
  // No filled dot: which option is chosen is the field's value.
  await expect(picker.locator(".sn-select-check")).toHaveText(["○", "○", "○"]);
  await expect(picker).not.toContainText("●");
  // Nor is any option announced as the chosen one.
  await expect(picker.getByRole("option", { selected: true })).toHaveCount(0);

  // Choosing one still works.
  await picker.getByRole("option", { name: /02/ }).click();
  await expect(page.locator("#exp-month")).toHaveValue("02");
});
