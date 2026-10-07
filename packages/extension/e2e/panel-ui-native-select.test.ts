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

test("an option chosen while a read is running is dropped if the panel leaves the tab", async ({
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

  // As above, but the user moves to another tab while the choice waits.
  await nav.setNativeReads("delay:3000");
  await nav.panel.evaluate(() =>
    document
      .querySelector<HTMLButtonElement>('[aria-label="Refresh native tree"]')!
      .click(),
  );
  await picker.getByRole("option", { name: /Music/ }).click();
  const other = await nav.open("tree-view.html");
  await other.page.bringToFront();
  await expect
    .poll(() => nav.panel.locator(".sn-node").count(), { timeout: 5_000 })
    .toBe(0);

  // Well past the read's end, the tab the panel left is untouched.
  await nav.panel.waitForTimeout(4_000);
  await expect(page.locator("#department")).toHaveValue("all");
  expect(
    (await nav.nativeActs()).filter((a) => a.action === "select"),
  ).toHaveLength(0);
});

test("the tree doesn't say which option of a sensitive select is chosen", async ({
  nav,
}) => {
  const page = await nav.showNative("select-sensitive.html");
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
      `<label for="exp-year-list">Expiry year list</label>
       <select id="exp-year-list" size="3" autocomplete="cc-exp-year">
         <option>2040</option><option selected>2041</option><option>2042</option>
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
  // The fixture's own drop-downs (month, and the empty year), then the list
  // box and the multiple select added above.
  expect(sensitive.map((n) => n.name).sort()).toEqual(
    [
      "01",
      "02",
      "11",
      "YYYY",
      "2030",
      "2031",
      "2040",
      "2041",
      "2042",
      "03",
      "04",
    ].sort(),
  );
  for (const option of sensitive) {
    expect(option.states ?? {}).not.toHaveProperty("selected");
  }
});

test("NATIVE_READ carries no chosen option in the listbox a sensitive combobox controls", async ({
  nav,
}) => {
  const { page, tabId } = await nav.open("select-sensitive.html");
  // An ARIA combobox whose listbox is elsewhere in the page, tied to it only
  // by aria-controls (naming an unnamed wrapper around it, which the tree
  // drops), so it isn't the field's descendant; and a plain one beside it,
  // whose chosen option the tree still shows.
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<label for="exp-aria">Expiry month (ARIA)</label>
       <input id="exp-aria" role="combobox" aria-expanded="true"
         aria-controls="exp-aria-list" autocomplete="cc-exp-month" value="07">
       <label for="colour">Colour</label>
       <input id="colour" role="combobox" aria-expanded="true"
         aria-controls="colour-list" value="Red">
       <div>
         <div id="exp-aria-list">
           <ul role="listbox" aria-label="Months">
             <li role="option" aria-selected="false">06</li>
             <li role="option" aria-selected="true">07</li>
           </ul>
         </div>
         <ul id="colour-list" role="listbox" aria-label="Colours">
           <li role="option" aria-selected="true">Red</li>
           <li role="option" aria-selected="false">Blue</li>
         </ul>
       </div>`,
    );
  });
  const nodes = await nav.readNodes(tabId);
  const option = (name: string) =>
    nodes.find((n) => n.role === "option" && n.name === name);
  expect(option("Red")?.states?.selected).toBe(true);
  for (const month of ["06", "07"]) {
    expect(option(month)).toBeDefined();
    expect(option(month)?.states ?? {}).not.toHaveProperty("selected");
  }
});
