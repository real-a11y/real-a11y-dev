/**
 * A sensitive field's value never reaches another node's name or
 * description in the native tree (ADR-0001).
 *
 * Chromium names a cell, a link or a `<label>`-wrapped control from its
 * contents, and an embedded field's value is part of them. core's
 * `withholdSensitiveFieldNames`, which the CLI and MCP producer already
 * applied, now runs in the extension's debugger mode too.
 */

import { expect, test } from "./harness";

test("NATIVE_READ keeps a card number out of every name around it", async ({
  nav,
}) => {
  const { tabId } = await nav.open("native-sensitive-names.html");
  const nodes = await nav.readNodes(tabId);
  const wire = JSON.stringify(nodes);
  for (const secret of [
    "4111111111111111",
    "5555444433332222",
    "378282246310005",
    "hunter2xyz",
    "hunter2own",
    "6011000990139424",
  ]) {
    expect(wire).not.toContain(secret);
  }
  // Chromium masks a password's value, so its length would leak as bullets.
  expect(wire).not.toMatch(/[•●]/);

  const named = (role: string, name: string | RegExp) =>
    nodes.filter(
      (n) =>
        n.role === role &&
        (typeof name === "string" ? n.name === name : name.test(n.name)),
    );
  // The checkboxes wrapped with a filled card field and a card month are
  // withheld, not unlabeled.
  expect(named("checkbox", "[redacted]")).toHaveLength(2);
  // An empty card field gives nothing away: its checkbox keeps its label.
  expect(named("checkbox", /Remember/)).toHaveLength(1);
  // A value that isn't sensitive still names its cell.
  expect(nodes.some((n) => n.name.includes("leave at door"))).toBe(true);
  // A name or description by reference to the password is withheld too.
  const show = named("button", "Show")[0];
  expect(show).toBeDefined();
  expect(show?.description ?? "").toBe("");
  // So is one by reference to a card field the tree never shows.
  expect(named("region", "[redacted]")).toHaveLength(1);

  // A field's own label still names it, its value withheld.
  for (const name of ["Password", "Card number"]) {
    const field = named("textbox", name);
    expect(field).toHaveLength(1);
    expect(field[0]?.value).toBe("[redacted]");
  }

  // A card month select's chosen option names nothing around it: not a
  // description, a group, a label or a cell. The months are on the wire as
  // the options' own names; which one is chosen is what's withheld.
  const pay = named("button", "Pay")[0];
  expect(pay).toBeDefined();
  expect(pay?.description ?? "").toBe("");
  expect(named("group", "[redacted]")).toHaveLength(2);
  const month = /\b0[4-9]\b/;
  expect(
    nodes.filter(
      (n) =>
        n.role !== "option" &&
        (month.test(n.name) || month.test(n.description ?? "")),
    ),
  ).toEqual([]);
  // The layout cell holding the month is still in the tree, withheld.
  expect(named("LayoutTableCell", "[redacted]")).toHaveLength(2);
});

test("the panel shows no card number in any row", async ({ nav }) => {
  const { page } = await nav.open("native-sensitive-names.html");
  await page.bringToFront();
  await nav.panel.reload();
  const toggle = nav.panel
    .getByRole("group", { name: "Tree producer" })
    .getByRole("button", { name: "NATIVE", exact: true });
  await expect(toggle).toBeVisible({ timeout: 20_000 });
  await toggle.click();
  await expect
    .poll(() => nav.panel.locator(".sn-node").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await nav.panel.getByRole("button", { name: "Expand all" }).click();
  const tree = nav.panel.getByRole("tree");
  await expect(tree).toContainText("leave at door");
  // The rows the card numbers would be in are on screen, withheld.
  await expect(
    nav.panel.getByRole("treeitem", { name: /^checkbox "\[redacted\]"/ }),
  ).toBeVisible();
  // A filled password still reads its own label.
  await expect(
    nav.panel.getByRole("treeitem", { name: /^textbox "Password"/ }),
  ).toBeVisible();
  await expect(tree).not.toContainText("4111");
  await expect(tree).not.toContainText("5555");
});
