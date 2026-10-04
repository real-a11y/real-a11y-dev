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
  for (const secret of ["4111111111111111", "5555444433332222", "hunter2xyz"]) {
    expect(wire).not.toContain(secret);
  }

  const named = (role: string, name: string | RegExp) =>
    nodes.filter(
      (n) =>
        n.role === role &&
        (typeof name === "string" ? n.name === name : name.test(n.name)),
    );
  // The checkbox wrapped with a filled card field is withheld, not unlabeled.
  expect(named("checkbox", "[redacted]")).toHaveLength(1);
  // An empty card field gives nothing away: its checkbox keeps its label.
  expect(named("checkbox", /Remember/)).toHaveLength(1);
  // A value that isn't sensitive still names its cell.
  expect(nodes.some((n) => n.name.includes("leave at door"))).toBe(true);
  // A name or description by reference to the password is withheld too.
  const show = named("button", "Show")[0];
  expect(show?.description ?? "").toBe("");
  expect(named("group", /hunter2/)).toHaveLength(0);
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
  await expect(tree).not.toContainText("4111");
  await expect(tree).not.toContainText("5555");
});
