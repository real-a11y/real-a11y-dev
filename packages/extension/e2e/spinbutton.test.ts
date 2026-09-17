/**
 * Spinbutton — the one role that is typable AND steppable at once.
 *
 * `getActions` gives it `focus, type, increment, decrement`, and the panel
 * mirrors that: `spinbutton` is in `ACTABLE`, in `isTypableRole`, and in
 * `isSteppableRole` simultaneously. Both halves are exercised here, against
 * both backing shapes — a custom `role="spinbutton"` div and a native
 * `<input type="number">`.
 */

import { expect, node, nodes, test } from "./harness";

test("both shapes surface as spinbuttons with their bounds", async ({
  nav,
}) => {
  const { tabId } = await nav.open("spinbutton.html");
  const tree = await nav.readNodes(tabId);

  expect(nodes(tree, "spinbutton").map((s) => s.name)).toEqual([
    "Day",
    "Quantity",
  ]);
  expect(node(tree, "spinbutton", "Day").properties).toMatchObject({
    valuemin: "1",
    valuemax: "31",
  });
});

test("a custom role=spinbutton steps via the keyboard path", async ({
  nav,
}) => {
  const { page, tabId } = await nav.open("spinbutton.html");
  const day = node(await nav.readNodes(tabId), "spinbutton", "Day");

  await nav.act(tabId, day.id, "increment");
  await expect(page.locator("#day")).toHaveAttribute("aria-valuenow", "13");
  await expect(page.locator("#day")).toHaveText("13");

  await nav.act(tabId, day.id, "decrement");
  await expect(page.locator("#day")).toHaveAttribute("aria-valuenow", "12");
});

test("a native number input steps and accepts typed text", async ({ nav }) => {
  const { page, tabId } = await nav.open("spinbutton.html");
  const qty = node(await nav.readNodes(tabId), "spinbutton", "Quantity");

  await nav.act(tabId, qty.id, "increment");
  await expect(page.locator("#qty")).toHaveValue("4");
  await expect(page.locator("#qty-out")).toHaveText("4");

  expect(await nav.act(tabId, qty.id, "type", "42")).toEqual({ success: true });
  await expect(page.locator("#qty")).toHaveValue("42");
  await expect(page.locator("#qty-out")).toHaveText("42");
});

/**
 * A real, currently-open gap, pinned rather than papered over.
 *
 * `isTypableRole` returns true for EVERY `spinbutton`, because the DOM
 * producer's `getActions` does — but the DOM producer reaches that branch off
 * the element's tag, and the native tree has no tag to check. So the panel
 * offers a type button on a custom `role="spinbutton"` div, and `pageType`
 * refuses it in-page with `not-a-text-field`.
 *
 * The refusal is the correct behaviour (it is exactly the in-page check that
 * keeps a custom element away from a native setter); the affordance is the
 * imprecise part. It is the same role-only ambiguity `ACTABLE` documents for
 * `row`/`listbox`/`option`, and it fails safe here — a clean refusal, not a
 * misfire — so this test records the shape rather than asserting it should
 * change. If a future change narrows the affordance, this is the test that
 * should be updated deliberately.
 */
test("typing into a custom role=spinbutton refuses cleanly", async ({
  nav,
}) => {
  const { page, tabId } = await nav.open("spinbutton.html");
  const day = node(await nav.readNodes(tabId), "spinbutton", "Day");

  expect(await nav.act(tabId, day.id, "type", "9")).toEqual({
    success: false,
    error: "not-a-text-field",
  });
  // Refused, not half-applied: the widget is exactly where it started.
  await expect(page.locator("#day")).toHaveAttribute("aria-valuenow", "12");
  await expect(page.locator("#day")).toHaveText("12");
});
