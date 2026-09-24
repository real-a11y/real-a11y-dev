/**
 * Search box + role-filter pills for the native producer's production tree
 * view (`NativeTreeView.tsx`, `native-search.ts`) — UI-level, like
 * `panel-ui-native.test.ts`, because that is where the search box and pills
 * actually live; a message-level test can't see them at all.
 *
 * Reuses `native-panel.html`: 16 flat buttons nested one level under an
 * "Items" section (originally built to exceed the virtualization fallback
 * window), a `Password` field, and the page's own headings — enough role
 * variety to exercise a query, a role-filter pill, and both combined without
 * a dedicated fixture.
 */

import { expect, test, type NativeHarness } from "./harness";

/** Mirrors `panel-ui-native.test.ts`'s own `showNative` — see its comment
 *  for why the reload happens after bringing the fixture to the foreground. */
async function showNative(nav: NativeHarness, fixture: string) {
  const { page } = await nav.open(fixture);
  await page.bringToFront();
  await nav.panel.reload();

  const nativeToggle = nav.panel.getByRole("button", {
    name: "NATIVE",
    exact: true,
  });
  await expect(nativeToggle).toBeVisible({ timeout: 20_000 });
  await nativeToggle.click();

  await expect
    .poll(() => nav.panel.locator(".sn-node").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);

  return page;
}

test("a search query narrows the tree to matches and their ancestors", async ({
  nav,
}) => {
  await showNative(nav, "native-panel.html");
  // The buttons sit one level under the "Items" section, collapsed by
  // default — expand everything first so the query alone is what's under
  // test, not the tree's own default-expand seeding.
  await nav.panel.getByRole("button", { name: "Expand all" }).click();

  const allItemRows = nav.panel.getByRole("treeitem", { name: /Item \d+/ });
  await expect(allItemRows).toHaveCount(16);

  const search = nav.panel.getByLabel("Search native tree nodes");
  await search.fill("Item 12");

  await expect(
    nav.panel.getByRole("treeitem", { name: "Item 12" }),
  ).toBeVisible();
  await expect(allItemRows).toHaveCount(1);
  await expect(nav.panel.locator(".sn-search-count")).toHaveText("1 match");

  // The ancestor path to the match stays visible even though it doesn't
  // match the query itself.
  await expect(
    nav.panel.getByRole("treeitem", { name: "Items", exact: false }),
  ).toBeVisible();

  await search.fill("");
  await expect(allItemRows).toHaveCount(16);
  await expect(nav.panel.locator(".sn-search-count")).toBeEmpty();
});

test("a query with no matches shows an empty state, not a stale tree", async ({
  nav,
}) => {
  await showNative(nav, "native-panel.html");
  await nav.panel.getByRole("button", { name: "Expand all" }).click();

  const search = nav.panel.getByLabel("Search native tree nodes");
  await search.fill("nothing-on-this-page-matches-this");

  await expect(nav.panel.locator("[role='treeitem']")).toHaveCount(0);
  await expect(nav.panel.locator(".sn-empty")).toContainText("No matches");
});

test("a role-filter pill swaps the tree for a flat list of that role, narrowed by the query", async ({
  nav,
}) => {
  await showNative(nav, "native-panel.html");

  await nav.panel.getByRole("button", { name: "Buttons", exact: true }).click();

  // The same flat list the DOM producer shows (`FilteredList`), not a pruned
  // tree — and every match is listed, even ones under a collapsed section.
  await expect(nav.panel.locator("[role='tree']")).toHaveCount(0);
  const list = nav.panel.getByRole("listbox");
  await expect(list.getByRole("option", { name: /Item \d+/ })).toHaveCount(16);
  // The password field is a textbox, not a button — excluded by the pill.
  await expect(list.getByRole("option", { name: "Password" })).toHaveCount(0);
  await expect(nav.panel.locator(".sn-list-count")).toHaveText("16 items");
  // Native can't highlight on the page, so there is no Move to button.
  await expect(
    nav.panel.getByRole("button", { name: "Move to", exact: true }),
  ).toHaveCount(0);

  // AND-combines with the query, same as the DOM producer's own filters.
  const search = nav.panel.getByLabel("Search native tree nodes");
  await search.fill("Item 12");
  await expect(list.getByRole("option")).toHaveCount(1);
  await expect(list.getByRole("option", { name: "Item 12" })).toBeVisible();
  await expect(nav.panel.locator(".sn-search-count")).toHaveText("1 match");

  // Toggling the same pill again clears it and brings the tree back.
  await nav.panel.getByRole("button", { name: "Buttons", exact: true }).click();
  await expect(
    nav.panel.getByRole("button", { name: "Buttons", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(nav.panel.locator("[role='tree']")).toHaveCount(1);
});

test("Enter on a heading in the list goes back to the tree with it selected", async ({
  nav,
}) => {
  await showNative(nav, "native-panel.html");

  await nav.panel
    .getByRole("button", { name: "Headings", exact: true })
    .click();
  const list = nav.panel.getByRole("listbox");
  await expect(list.getByRole("option")).toHaveText([
    /H1\s*Native panel fixture/,
    /H2\s*Sensitive field/,
  ]);

  // Click, not `focus()`: the panel is a background tab next to the fixture,
  // and only a real click gives it keyboard focus (as in the `/` test below).
  await list.getByRole("option").first().click();
  await nav.panel.keyboard.press("ArrowDown");
  await expect(list.getByRole("option", { selected: true })).toHaveText(
    /Sensitive field/,
  );
  await nav.panel.keyboard.press("Enter");

  const tree = nav.panel.locator("[role='tree']");
  await expect(tree).toBeFocused();
  await expect(
    nav.panel.getByRole("button", { name: "Headings", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(
    nav.panel.locator("[role='treeitem'][aria-selected='true']"),
  ).toContainText("Sensitive field");
});

/** The list's plain Enter must step a slider, as the DOM list does — not fall
 *  through to the native click, which a slider ignores. Asserted on the
 *  page's own state (the APG handler's output), not on the dispatch marker. */
test("Enter on a slider in the Forms list steps it", async ({ nav }) => {
  const page = await showNative(nav, "slider-single.html");

  await nav.panel.getByRole("button", { name: "Forms", exact: true }).click();
  const list = nav.panel.getByRole("listbox");
  const temperature = list.getByRole("option", { name: /Temperature/ });
  await temperature.click();
  await nav.panel.keyboard.press("Enter");

  await expect(page.locator("#temp-thumb")).toHaveAttribute(
    "aria-valuenow",
    "69",
  );
  await expect(page.locator("#temp-out")).toHaveText("69");
});

test("pressing / focuses the search box", async ({ nav }) => {
  await showNative(nav, "native-panel.html");

  const tree = nav.panel.locator("[role='tree']");
  await tree.click();
  await nav.panel.keyboard.press("/");

  await expect(nav.panel.getByLabel("Search native tree nodes")).toBeFocused();
});
