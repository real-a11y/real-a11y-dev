/**
 * A custom element that is a textbox itself, around a password or card input
 * in a shadow root of its own, is withheld as an editor around one is
 * (ADR-0001): its row reads `valueWithheld: true`, the verdict the side
 * panel's edit box masks by.
 *
 * Chromium's tree flattens shadow roots, so the host's row sits over its
 * input's, and the read withholds every row a withheld field sits under
 * there, wherever the document has the field. For a field with no row in the
 * tree, the read's own walk of the document says what it is and which
 * elements it sits in, through shadow roots and slots, since the page can't
 * see into a closed root.
 */

import { expect, node, test } from "./harness";

/** Each row withheld for a field in a shadow root, by its name. */
const WITHHELD = [
  "Open root password",
  "Closed root password",
  // Empty: which edit box masks keys on the verdict, not on a value.
  "Empty password",
  "Closed root card",
  // Hidden at the root's top: Chromium keeps an ignored node for the input,
  // and no row, so its markup says what it is.
  "Hidden input password",
  "Undisplayed password",
  // Below a hidden wrapper: no node at all, so only the document says the
  // input is there.
  "Deeper hidden password",
  // A textbox by its ElementInternals, not by an attribute.
  "Internals password",
  // A textbox in a closed root, around the host's own hidden input, which a
  // <slot> shows inside it. Deeper, only the slot places the input there.
  "Slotted password",
  "Slotted deeper password",
  // An editor holding such a host: its edit box types into the page.
  "Editor around a shadow password",
];
/** The rows whose inputs have no row of their own: the walk's to find. */
const ROWLESS = [
  "Hidden input password",
  "Undisplayed password",
  "Deeper hidden password",
  "Slotted password",
  "Slotted deeper password",
];
/** Each host around an ordinary input, hidden or slotted or not. */
const PLAIN = ["Closed root name", "Hidden input name", "Slotted name"];

test("NATIVE_READ withholds a host around a sensitive field in its shadow root, open or closed", async ({
  nav,
}) => {
  const { tabId } = await nav.open("native-shadow-fields.html");
  const nodes = await nav.readNodes(tabId);

  for (const name of WITHHELD) {
    const host = node(nodes, "textbox", name);
    expect(host.valueWithheld, name).toBe(true);
    expect(host.value, name).toBeUndefined();
  }
  for (const name of ROWLESS) {
    const host = node(nodes, "textbox", name);
    const rows = nodes.filter((n) => host.childIds?.includes(n.id));
    expect(
      rows.filter((n) => n.role === "textbox"),
      name,
    ).toEqual([]);
  }

  // A combobox with no part of the card field in the document, whose row
  // Chromium's tree puts the field's under (`aria-owns`).
  const owner = node(nodes, "combobox", "Combobox owning a card");
  expect(owner.valueWithheld).toBe(true);
  expect(owner.value).toBeUndefined();

  // A host around an ordinary input is as it was, and so is the input.
  for (const name of PLAIN) {
    expect(node(nodes, "textbox", name).valueWithheld, name).toBe(false);
  }
  const name = node(nodes, "textbox", "Closed root name");
  const inner = nodes.find((n) => name.childIds?.includes(n.id));
  expect(inner?.value).toBe("Jane");

  const wire = JSON.stringify(nodes);
  for (const secret of ["hunter2", "4111111111111111"]) {
    expect(wire).not.toContain(secret);
  }
  // Chromium's own mask for a password: one bullet per character.
  expect(wire).not.toMatch(/[•●]/);
});

test("NATIVE panel: a host's edit box masks what is typed, as its verdict says", async ({
  nav,
}) => {
  await nav.showNative("native-shadow-fields.html");
  await nav.panel.getByRole("button", { name: "Expand all" }).click();
  const field = nav.panel.locator(".sn-input-panel-field");
  const retype = async (name: string, type: string) => {
    await nav.panel
      .getByRole("treeitem", { name })
      .getByTitle("Type (Enter)")
      .click();
    await expect(field, name).toHaveAttribute("type", type);
    await field.press("Escape");
    await expect(field).toHaveCount(0);
  };
  for (const name of WITHHELD) await retype(name, "password");
  for (const name of PLAIN) await retype(name, "text");
});
