/**
 * Listbox / native `<select>` — the `select` action (round 15).
 *
 * A native `<select>` arrives on the native tree as `combobox` →
 * `MenuListPopup` → `option`, and each `option` had no action at all: `option`
 * is excluded from `ACTABLE` because a role-only tree cannot tell a real
 * `<option>` from a custom `role="option"` widget, and a generic click would
 * have been wrong regardless — an open native `<select>` is OS chrome, not DOM
 * a synthetic pointer sequence reaches.
 *
 * `pageSelectOption` resolves that ambiguity at the one point where it is
 * resolvable: in-page, against the live element, with `instanceof
 * HTMLOptionElement`. Both sides of that check are pinned below.
 */

import { expect, node, nodes, test } from "./harness";

test("a native select normalizes to combobox → MenuListPopup → option", async ({
  nav,
}) => {
  const { tabId } = await nav.open("listbox-select.html");
  const tree = await nav.readNodes(tabId);

  const department = node(tree, "combobox", "Department");
  expect(department.properties).toMatchObject({ hasPopup: "menu" });
  // Not editable — so `isTypableRole` gives it a click, matching round 4/13.
  expect(department.states?.editable).toBeUndefined();

  expect(nodes(tree, "option").map((o) => o.name)).toEqual([
    "All Departments",
    "Books",
    "Music",
    // The custom `role="listbox"` widget's own options, from the same page.
    "First",
    "Second",
  ]);
});

test("select sets the owning select's value and fires change", async ({
  nav,
}) => {
  const { page, tabId } = await nav.open("listbox-select.html");
  const books = node(await nav.readNodes(tabId), "option", "Books");

  expect(await nav.act(tabId, books.id, "select")).toEqual({ success: true });
  await expect(page.locator("#department")).toHaveValue("books");
  // A real `change` listener observed it — not just the value we set.
  await expect(page.locator("#department-echo")).toHaveText("books");
});

test("selecting a second option moves the selection again", async ({ nav }) => {
  const { page, tabId } = await nav.open("listbox-select.html");
  const tree = await nav.readNodes(tabId);

  await nav.act(tabId, node(tree, "option", "Books").id, "select");
  await nav.act(tabId, node(tree, "option", "Music").id, "select");
  await expect(page.locator("#department")).toHaveValue("music");
  await expect(page.locator("#department-echo")).toHaveText("music");
});

/**
 * The other half of the in-page `instanceof` check: a custom `role="option"`
 * widget looks identical on a role-only tree and must refuse cleanly rather
 * than misfire. Round 8 reverted an earlier attempt to give these a generic
 * click for exactly this reason.
 */
test("select on a custom role=option widget refuses cleanly", async ({
  nav,
}) => {
  const { page, tabId } = await nav.open("listbox-select.html");
  const custom = node(await nav.readNodes(tabId), "option", "Second");

  expect(await nav.act(tabId, custom.id, "select")).toEqual({
    success: false,
    error: "not-an-option",
  });
  // Nothing moved — the refusal is total, not partial.
  await expect(page.locator("#custom-first")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#custom-second")).toHaveAttribute(
    "aria-selected",
    "false",
  );
});

/** A `<select>`'s own live value is read back, redaction rules applying the
 *  same as anywhere else — `pageReadValue` reads `HTMLSelectElement` too. */
test("the select's live value is read back on the combobox row", async ({
  nav,
}) => {
  const { page, tabId } = await nav.open("listbox-select.html");
  expect(node(await nav.readNodes(tabId), "combobox", "Department").value).toBe(
    "all",
  );

  await page.selectOption("#department", "music");
  expect(node(await nav.readNodes(tabId), "combobox", "Department").value).toBe(
    "music",
  );
});
