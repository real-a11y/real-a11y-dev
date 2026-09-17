/**
 * Listbox (multi-select) — a limitation documented with a fixture rather than
 * left unknown.
 *
 * `pageSelectOption` mirrors the DOM producer's own `handleSelect`: it sets the
 * owning `<select>`'s `value`, which on a `<select multiple>` collapses the
 * whole selection down to the one option. Both producers behave this way, so
 * this is a shared limitation of the `select` action rather than a native-path
 * bug — but nothing had ever exercised it against a real multi-select, so
 * "shared limitation" was an inference, not a measurement. It is measured here.
 */

import { expect, node, nodes, test } from "./harness";

test("a native multi-select surfaces as a listbox with per-option state", async ({
  nav,
}) => {
  const { tabId } = await nav.open("listbox-multi.html");
  const tree = await nav.readNodes(tabId);

  const toppings = node(tree, "listbox", "Toppings");
  // `pageReadValue` reads `HTMLSelectElement.value`, which on a multi-select is
  // the FIRST selected option, not all of them. Worth pinning: the panel shows
  // this as the control's value, and "cheese" alone under-reports a selection
  // of cheese + basil.
  expect(toppings.value).toBe("cheese");

  expect(
    nodes(tree, "option")
      .slice(0, 3)
      .map((o) => [o.name, o.states?.selected]),
  ).toEqual([
    ["Cheese", true],
    ["Basil", true],
    ["Olives", false],
  ]);
});

/**
 * The limitation itself. Selecting a third option does not ADD to the
 * selection — it replaces it. Asserted on `selectedOptions`, so the collapse is
 * visible rather than implied by a single-value read.
 */
test("DOCUMENTED LIMITATION: select replaces a multi-selection", async ({
  nav,
}) => {
  const { page, tabId } = await nav.open("listbox-multi.html");
  const olives = node(await nav.readNodes(tabId), "option", "Olives");

  expect(await nav.act(tabId, olives.id, "select")).toEqual({ success: true });

  await expect
    .poll(() =>
      page.evaluate(() =>
        Array.from(
          (document.getElementById("toppings") as HTMLSelectElement)
            .selectedOptions,
        ).map((o) => o.value),
      ),
    )
    .toEqual(["olives"]);
  // The page's own `change` listener saw the collapsed selection too.
  await expect(page.locator("#toppings-echo")).toHaveText("olives");
});

/** A custom `role="listbox"` widget's options are not real `<option>`s, so the
 *  in-page `instanceof` check refuses — the same boundary as the single-select
 *  fixture, re-pinned here because `aria-multiselectable` does not change it. */
test("a custom multi-selectable listbox's options still refuse", async ({
  nav,
}) => {
  const { page, tabId } = await nav.open("listbox-multi.html");
  const blue = node(await nav.readNodes(tabId), "option", "Blue");

  expect(await nav.act(tabId, blue.id, "select")).toEqual({
    success: false,
    error: "not-an-option",
  });
  await expect(page.locator("#color-blue")).toHaveAttribute(
    "aria-selected",
    "false",
  );
});
