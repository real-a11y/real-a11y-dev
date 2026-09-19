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

test("a role-filter pill scopes the tree to that role, independent of the query", async ({
  nav,
}) => {
  await showNative(nav, "native-panel.html");
  await nav.panel.getByRole("button", { name: "Expand all" }).click();

  await nav.panel.getByRole("button", { name: "Buttons", exact: true }).click();

  await expect(
    nav.panel.getByRole("treeitem", { name: /Item \d+/ }),
  ).toHaveCount(16);
  // The password field is a textbox, not a button — excluded by the pill.
  await expect(
    nav.panel.getByRole("treeitem", { name: "Password" }),
  ).toHaveCount(0);

  // AND-combines with the query, same as the DOM producer's own filters.
  const search = nav.panel.getByLabel("Search native tree nodes");
  await search.fill("Item 12");
  await expect(
    nav.panel.getByRole("treeitem", { name: "Item 12" }),
  ).toBeVisible();
  await expect(
    nav.panel.getByRole("treeitem", { name: /Item \d+/ }),
  ).toHaveCount(1);

  // Toggling the same pill again clears it — same as the DOM producer's.
  await nav.panel.getByRole("button", { name: "Buttons", exact: true }).click();
  await expect(
    nav.panel.getByRole("button", { name: "Buttons", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
});

test("pressing / focuses the search box", async ({ nav }) => {
  await showNative(nav, "native-panel.html");

  const tree = nav.panel.locator("[role='tree']");
  await tree.click();
  await nav.panel.keyboard.press("/");

  await expect(nav.panel.getByLabel("Search native tree nodes")).toBeFocused();
});
