/**
 * The option picker for a native `<select>`, through the real build.
 *
 * Chromium gives a real `<select>` a `combobox` row with a `MenuListPopup`
 * child holding its `option` rows. Activating that row opens the panel's
 * option picker (`InputPanel`'s `SelectPicker`, the DOM tree's own), listed
 * from those rows, and choosing one dispatches the existing `select` action
 * on it. A custom `role="combobox"` has no such popup and keeps its click.
 */

import { expect, test } from "./harness";

test("a native select opens the option picker, and choosing selects on the page", async ({
  nav,
}) => {
  const page = await nav.showNative("listbox-select.html");
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
  await nav.showNative("listbox-select.html");
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
  await nav.showNative("combobox-select-only.html");
  const combobox = nav.panel.getByRole("treeitem", {
    name: /^combobox "Favorite Fruit"/,
  });
  await expect(combobox.locator(".sn-action-tag")).toHaveText("Click");
});

test("a sensitive select's picker shows no current option", async ({ nav }) => {
  const page = await nav.showNative("select-sensitive.html");
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

  // Choosing one still works, and the feedback names the field, not the
  // option chosen.
  await picker.getByRole("option", { name: /02/ }).click();
  await expect(page.locator("#exp-month")).toHaveValue("02");
  const feedback = nav.panel.locator(".sn-action-feedback");
  await expect(feedback).toContainText("Selected an option in Expiry month");
  await expect(feedback).not.toContainText("02");
});

test("selecting a sensitive select's option from its own row names only the field", async ({
  nav,
}) => {
  const page = await nav.showNative("select-sensitive.html");
  await nav.panel.getByRole("button", { name: "Expand all" }).click();
  await nav.panel
    .getByRole("treeitem", { name: /^option "02"/ })
    .getByTitle("Select (Enter)")
    .click();
  await expect(page.locator("#exp-month")).toHaveValue("02");
  const feedback = nav.panel.locator(".sn-action-feedback");
  await expect(feedback).toContainText("Selected an option in Expiry month");
  await expect(feedback).not.toContainText("02");
});

test("an empty sensitive select's picker shows no current option either", async ({
  nav,
}) => {
  await nav.showNative("select-sensitive.html");
  await nav.panel.getByRole("button", { name: "Expand all" }).click();
  await nav.panel
    .getByRole("treeitem", { name: /^combobox "Expiry year"/ })
    .getByTitle("Select (Enter)")
    .click();
  const picker = nav.panel.getByRole("dialog", { name: "Expiry year" });
  await expect(picker.getByRole("option")).toHaveCount(3);
  await expect(picker.getByRole("option", { selected: true })).toHaveCount(0);
  await expect(picker).not.toContainText("●");
});

test("a disabled option can't be chosen, and a disabled select opens no picker", async ({
  nav,
}) => {
  const page = await nav.showNative("select-disabled.html");
  await nav.panel.getByRole("button", { name: "Expand all" }).click();

  await nav.panel
    .getByRole("treeitem", { name: /^combobox "Size"/ })
    .getByTitle("Select (Enter)")
    .click();
  const picker = nav.panel.getByRole("dialog", { name: "Size" });
  const medium = picker.getByRole("option", { name: /Medium/ });
  await expect(medium).toHaveAttribute("aria-disabled", "true");
  // Forced: Playwright won't click what's marked disabled, and the point is
  // what the picker does if someone does.
  await medium.click({ force: true });
  // Still open, and the page still on Small.
  await expect(picker).toBeVisible();
  await expect(page.locator("#size")).toHaveValue("s");
  await picker.getByRole("button", { name: "Cancel" }).click();

  await nav.panel
    .getByRole("treeitem", { name: /^combobox "Plan"/ })
    .getByTitle("Select (Enter)")
    .click();
  await expect(nav.panel.locator(".sn-action-feedback")).toContainText(
    "Plan is disabled",
  );
  await expect(nav.panel.getByRole("dialog", { name: "Plan" })).toHaveCount(0);
});

test("an option chosen while a read is running is applied once it ends", async ({
  nav,
}) => {
  const page = await nav.showNative("listbox-select.html");
  await nav.panel.getByRole("button", { name: "Expand all" }).click();
  await nav.panel
    .getByRole("treeitem", { name: /^combobox "Department"/ })
    .getByTitle("Select (Enter)")
    .click();
  const picker = nav.panel.getByRole("dialog", { name: "Department" });
  await expect(picker.getByRole("option")).toHaveCount(3);

  // A slow read starts behind the open picker, as a refresh would.
  await nav.setNativeReads("delay:2000");
  await nav.panel.evaluate(() =>
    document
      .querySelector<HTMLButtonElement>('[aria-label="Refresh native tree"]')!
      .click(),
  );
  await picker.getByRole("option", { name: /Music/ }).click();

  // Dropped before: the pick returned early on the read in flight.
  await expect(page.locator("#department")).toHaveValue("music", {
    timeout: 10_000,
  });
  await expect(nav.panel.locator(".sn-action-feedback")).toContainText(
    "Selected: Music",
  );
});
