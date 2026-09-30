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
 *
 * The text is not hidden, though: under ADR-0001 an editor's content is page
 * content, shown as the editor's value — the place a screen reader reads it
 * from.
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
  // Both `document`s: the synthetic root first, then the editor.
  expect(nodes(tree, "document").map((n) => n.name)).toEqual(["", ""]);
  // The role-less editor inside it is dropped; its text is still not the
  // item's name.
  expect(node(tree, "listitem").name).toBe("");
  // Not every name is stripped: the same kind of role with no value keeps its
  // text.
  expect(node(tree, "log").name).toBe("Saved at 10:00");

  // Never a name, and never the serialized structure.
  for (const n of tree) expect(n.name).not.toContain("SECRET");
  expect(result.serialized).not.toContain("SECRET");

  // Its VALUE is where it belongs (ADR-0001): an editor's content is page
  // content, and a screen reader reads it — so the tree shows it there.
  expect(nodes(tree, "application").map((n) => n.value)).toEqual([
    TYPED.app,
    TYPED.labelled,
  ]);
  // Two `document`s: the synthetic root adopting this page's several
  // top-level nodes comes first, the editor second.
  expect(nodes(tree, "document").map((n) => n.value)).toEqual([
    undefined,
    TYPED.doc,
  ]);
});
