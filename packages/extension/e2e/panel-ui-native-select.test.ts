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

test("the tree doesn't say which option of a sensitive select is chosen", async ({
  nav,
}) => {
  const page = await showNative(nav, "select-sensitive.html");
  // A plain select next to it, whose chosen option the tree does show.
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<label for="size">Size</label>
       <select id="size"><option>S</option><option selected>M</option></select>`,
    );
  });
  await nav.panel.getByRole("button", { name: "Refresh native tree" }).click();
  await nav.panel.getByRole("button", { name: "Expand all" }).click();

  const row = (name: string) =>
    nav.panel.getByRole("treeitem", { name: new RegExp(`^option "${name}"`) });
  await expect(row("M")).toContainText("selected");
  // "11" is the chosen month; no option row of the month says so.
  for (const month of ["01", "02", "11"]) {
    await expect(row(month)).toBeVisible();
    await expect(row(month)).not.toContainText("selected");
  }
});

test("NATIVE_READ carries no chosen option under a sensitive select, in any of its forms", async ({
  nav,
}) => {
  const { page, tabId } = await nav.open("select-sensitive.html");
  // A list box and a multiple select, sensitive too, beside the drop-down.
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<label for="exp-year">Expiry year</label>
       <select id="exp-year" size="3" autocomplete="cc-exp-year">
         <option>2030</option><option selected>2031</option><option>2032</option>
       </select>
       <label for="months">Months</label>
       <select id="months" multiple autocomplete="cc-exp-month">
         <option selected>03</option><option>04</option>
       </select>
       <label for="plain">Size</label>
       <select id="plain" size="2"><option>S</option><option selected>M</option></select>`,
    );
  });
  const nodes = await nav.readNodes(tabId);
  const options = nodes.filter((n) => n.role === "option");
  // A plain list box still says which option is chosen, so the check below
  // is about sensitivity, not about Chromium sending no state at all.
  expect(options.find((n) => n.name === "M")?.states?.selected).toBe(true);
  const sensitive = options.filter((n) => n.name !== "S" && n.name !== "M");
  expect(sensitive.map((n) => n.name).sort()).toEqual(
    ["01", "02", "03", "04", "11", "2030", "2031", "2032"].sort(),
  );
  for (const option of sensitive) {
    expect(option.states ?? {}).not.toHaveProperty("selected");
    expect(option.states ?? {}).not.toHaveProperty("checked");
  }
});
