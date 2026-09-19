/**
 * Checkbox, Radio Group and Switch — three APG patterns whose dispatch is a
 * plain click.
 *
 * Low risk individually, which is why they were Tier 2 — but the tri-state
 * checkbox is not just another click: `mixed` is the one `checked` value that
 * arrives as a STRING rather than a boolean, the case round 11 fixed and a
 * two-state fixture cannot reach.
 */

import { expect, node, nodes, test } from "./harness";

test('checked arrives as boolean, or as the string "mixed"', async ({
  nav,
}) => {
  const { tabId } = await nav.open("checkbox-radio-switch.html");
  const tree = await nav.readNodes(tabId);

  // `axFacets` normalizes Chromium's "true"/"false" strings to booleans but
  // leaves a tristate alone — that split is what this asserts.
  expect(node(tree, "checkbox", "Sandwich Condiments").states?.checked).toBe(
    "mixed",
  );
  expect(node(tree, "checkbox", "Lettuce").states?.checked).toBe(true);
  expect(node(tree, "checkbox", "Tomato").states?.checked).toBe(false);
  expect(node(tree, "checkbox", "Native checkbox").states?.checked).toBe(false);
});

test("clicking a tri-state checkbox resolves it to checked", async ({
  nav,
}) => {
  const { page, tabId } = await nav.open("checkbox-radio-switch.html");
  const mixed = node(await nav.readNodes(tabId), "checkbox", "Sandwich");

  expect(await nav.act(tabId, mixed.id, "click")).toEqual({ success: true });
  await expect(page.locator("#all-condiments")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  expect(
    node(await nav.readNodes(tabId), "checkbox", "Sandwich").states?.checked,
  ).toBe(true);
});

test("a native checkbox toggles through the pointer sequence", async ({
  nav,
}) => {
  const { page, tabId } = await nav.open("checkbox-radio-switch.html");
  const native = node(await nav.readNodes(tabId), "checkbox", "Native");

  await nav.act(tabId, native.id, "click");
  await expect(page.locator("#native-check")).toBeChecked();
});

test("clicking a radio moves the group's selection", async ({ nav }) => {
  const { page, tabId } = await nav.open("checkbox-radio-switch.html");
  const deep = node(await nav.readNodes(tabId), "radio", "Deep dish");

  expect(await nav.act(tabId, deep.id, "click")).toEqual({ success: true });
  await expect(page.locator("#crust-deep")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.locator("#crust-thin")).toHaveAttribute(
    "aria-checked",
    "false",
  );

  expect(
    nodes(await nav.readNodes(tabId), "radio").map((r) => r.states?.checked),
  ).toEqual([false, true]);
});

test("clicking a switch flips it", async ({ nav }) => {
  const { page, tabId } = await nav.open("checkbox-radio-switch.html");
  const notify = node(await nav.readNodes(tabId), "switch", "Notifications");

  await nav.act(tabId, notify.id, "click");
  await expect(page.locator("#notify")).toHaveAttribute("aria-checked", "true");
  expect(
    node(await nav.readNodes(tabId), "switch", "Notifications").states?.checked,
  ).toBe(true);
});
