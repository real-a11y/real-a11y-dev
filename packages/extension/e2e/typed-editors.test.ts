/**
 * What a user types into a rich-text editor never becomes that editor's name.
 *
 * Chromium reports an editor's text as its AX value and again on a StaticText
 * child. Core's name promotion used to copy that child into the name of any
 * role it names from text, so `<div role="application" contenteditable>`
 * read `application "<everything typed>"` in the native tree. The CLI and
 * MCP stripped it in `@real-a11y-dev/browser`; this path applied no such step.
 * Core now refuses to promote a node's value into its name, for every
 * transport — this pins it through the real build, in real Chromium, with the
 * text typed through the keyboard.
 */

import { expect, node, nodes, test } from "./harness";

const TYPED = {
  app: "typed-SECRET-app",
  doc: "typed-SECRET-doc",
  labelled: "typed-SECRET-labelled",
  item: "typed-SECRET-item",
};

test("an editor's typed text is never its name", async ({ nav }) => {
  const { page, tabId } = await nav.open("typed-editors.html");
  for (const [id, text] of Object.entries(TYPED)) {
    await page.click(`#${id}`);
    await page.keyboard.type(text);
  }
  // The text really is in the page, so the assertions below cannot pass
  // because nothing was typed.
  await expect(page.locator("#app")).toHaveText(TYPED.app);

  const result = await nav.read(tabId);
  expect(result.ok).toBe(true);
  const tree = result.nodes ?? [];

  expect(nodes(tree, "application").map((n) => n.name)).toEqual([
    "",
    // Named by its author, so Chromium's own name stands.
    "Message",
  ]);
  expect(node(tree, "document").name).toBe("");
  // The role-less editor inside it is dropped; its text is still not the
  // item's name.
  expect(node(tree, "listitem").name).toBe("");
  // Not every name is stripped: the same kind of role with no value keeps its
  // text.
  expect(node(tree, "log").name).toBe("Saved at 10:00");

  // Nowhere on the wire: not a name, not the serialized tree, not a value.
  expect(JSON.stringify(result)).not.toContain("SECRET");
});
