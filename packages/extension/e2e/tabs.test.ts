/**
 * Tabs — click dispatch on a `tab`, and the selection it has to move.
 *
 * `packages/browser/e2e/corpus/app-shell.html` already carries a tablist, but
 * only for DOM↔native tree-shape parity: it is never dispatched into. This is
 * the interaction half.
 */

import { expect, node, nodes, test } from "./harness";

test("tabs surface with their selected state", async ({ nav }) => {
  const { tabId } = await nav.open("tabs.html");
  const tree = await nav.readNodes(tabId);

  expect(nodes(tree, "tab").map((t) => [t.name, t.states?.selected])).toEqual([
    ["Nils Frahm", true],
    ["Agnes Obel", false],
    ["Joke Bot", false],
  ]);
});

test("clicking a tab moves the selection and swaps the panel", async ({
  nav,
}) => {
  const { page, tabId } = await nav.open("tabs.html");
  const agnes = node(await nav.readNodes(tabId), "tab", "Agnes");

  expect(await nav.act(tabId, agnes.id, "click")).toEqual({ success: true });
  await expect(page.locator("#tab-agnes")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#tab-nils")).toHaveAttribute(
    "aria-selected",
    "false",
  );
  await expect(page.locator("#panel-agnes")).toBeVisible();
  await expect(page.locator("#panel-nils")).toBeHidden();
});

/**
 * The newly-revealed tabpanel appears on a re-read. This is the assertion a
 * tree-shape-only fixture cannot make at all: it needs a dispatch first, and it
 * is what tells a dogfooder the click actually changed the page rather than
 * just the attribute they were looking at.
 */
test("the revealed panel's content appears on a re-read", async ({ nav }) => {
  const { tabId } = await nav.open("tabs.html");
  const before = await nav.readNodes(tabId);
  expect(node(before, "tabpanel").name).toBe("Nils Frahm");

  await nav.act(tabId, node(before, "tab", "Joke Bot").id, "click");

  const after = await nav.readNodes(tabId);
  expect(node(after, "tabpanel").name).toBe("Joke Bot");
  expect(after.some((n) => n.name.includes("chicken"))).toBe(true);
  expect(node(after, "tab", "Joke Bot").states?.selected).toBe(true);
});
