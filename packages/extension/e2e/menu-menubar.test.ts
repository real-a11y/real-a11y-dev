/**
 * Menu and Menubar — round 7's live finding, and the composite redirect.
 *
 * `menuitemradio` rows showed a CLICK button in the DOM/A11Y tree view but not
 * on the native tree: the panel's `ACTABLE` allowlist had fallen behind the DOM
 * producer's own `getActions`, even though `pageClick`'s composite redirect
 * already handled the role correctly. So the gap was never in dispatch — which
 * is precisely why a dispatch-level test alone would have missed it, and why
 * this file asserts on the whole `menuitem` family rather than the one role
 * that was reported.
 */

import { expect, node, nodes, test } from "./harness";

test("the whole menuitem family surfaces with its checked state", async ({
  nav,
}) => {
  const { tabId } = await nav.open("menu-menubar.html");
  const tree = await nav.readNodes(tabId);

  expect(nodes(tree, "menuitem").map((m) => m.name)).toEqual([
    "Font",
    "Style",
    "About",
  ]);
  expect(
    nodes(tree, "menuitemradio").map((m) => [m.name, m.states?.checked]),
  ).toEqual([
    ["Serif", true],
    ["Sans-serif", false],
  ]);
  expect(
    nodes(tree, "menuitemcheckbox").map((m) => [m.name, m.states?.checked]),
  ).toEqual([
    ["Bold", false],
    ["Italic", false],
  ]);
});

test("clicking a menuitemradio moves aria-checked (round 7)", async ({
  nav,
}) => {
  const { page, tabId } = await nav.open("menu-menubar.html");
  const sans = node(await nav.readNodes(tabId), "menuitemradio", "Sans-serif");

  expect(await nav.act(tabId, sans.id, "click")).toEqual({ success: true });
  await expect(page.locator("#sans")).toHaveAttribute("aria-checked", "true");
  // Radio semantics: the sibling gave it up.
  await expect(page.locator("#serif")).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("#menu-echo")).toHaveText("sans");
});

test("a menuitemcheckbox toggles independently", async ({ nav }) => {
  const { page, tabId } = await nav.open("menu-menubar.html");
  const bold = node(await nav.readNodes(tabId), "menuitemcheckbox", "Bold");

  await nav.act(tabId, bold.id, "click");
  await expect(page.locator("#bold")).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#italic")).toHaveAttribute(
    "aria-checked",
    "false",
  );
});

test("a plain menuitem dispatches too", async ({ nav }) => {
  const { page, tabId } = await nav.open("menu-menubar.html");
  const about = node(await nav.readNodes(tabId), "menuitem", "About");

  expect(await nav.act(tabId, about.id, "click")).toEqual({ success: true });
  await expect(page.locator("#menu-echo")).toHaveText("about");
});

/** The state change is visible on a RE-READ of the native tree, not only in
 *  the page — a dogfooder reads the tree again after acting, and a stale tree
 *  is what makes an action look like it did nothing. */
test("the new checked state shows on a re-read", async ({ nav }) => {
  const { tabId } = await nav.open("menu-menubar.html");
  const sans = node(await nav.readNodes(tabId), "menuitemradio", "Sans-serif");
  await nav.act(tabId, sans.id, "click");

  const after = await nav.readNodes(tabId);
  expect(node(after, "menuitemradio", "Sans-serif").states?.checked).toBe(true);
  expect(node(after, "menuitemradio", "Serif").states?.checked).toBe(false);
});
