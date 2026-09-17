/**
 * Accordion / Disclosure — round 11's `expanded`/`collapsed` finding, plus the
 * one shape of this pattern the native path genuinely does not reach.
 *
 * There is no `toggle` action on the native side and none is wanted: an APG
 * accordion trigger IS a button, and a click on it is the whole interaction.
 * What round 11 found was a DISPLAY gap — a collapsed trigger showed no state
 * at all, because the panel treated `expanded: false` as "default, not worth a
 * badge". The CDP payload had it right the whole time, which is why the
 * assertion below is on the state reaching the panel's wire format.
 */

import { expect, node, nodes, test } from "./harness";

test("both expanded and collapsed triggers carry the state (round 11)", async ({
  nav,
}) => {
  const { tabId } = await nav.open("accordion.html");
  const tree = await nav.readNodes(tabId);

  // The collapsed one is the half that was invisible: `false` has to arrive as
  // `false`, not be dropped for being falsy.
  expect(node(tree, "button", "Personal Information").states?.expanded).toBe(
    false,
  );
  expect(node(tree, "button", "Billing Address").states?.expanded).toBe(true);
});

test("clicking a collapsed trigger expands it, visibly on a re-read", async ({
  nav,
}) => {
  const { page, tabId } = await nav.open("accordion.html");
  const trigger = node(await nav.readNodes(tabId), "button", "Personal");

  expect(await nav.act(tabId, trigger.id, "click")).toEqual({ success: true });
  await expect(page.locator("#personal-trigger")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(page.locator("#personal-panel")).toBeVisible();

  const after = await nav.readNodes(tabId);
  expect(node(after, "button", "Personal Information").states?.expanded).toBe(
    true,
  );
  // The revealed region joins the tree — the reason a dogfooder re-reads at all.
  expect(node(after, "region", "Personal Information")).toBeDefined();
});

test("clicking an expanded trigger collapses it", async ({ nav }) => {
  const { page, tabId } = await nav.open("accordion.html");
  const trigger = node(await nav.readNodes(tabId), "button", "Billing");

  await nav.act(tabId, trigger.id, "click");
  await expect(page.locator("#billing-panel")).toBeHidden();
  expect(
    node(await nav.readNodes(tabId), "button", "Billing Address").states
      ?.expanded,
  ).toBe(false);
});

/**
 * A real, currently-open gap in the native path, pinned so it stays a known
 * quantity rather than a surprise.
 *
 * Chromium reports a `<details>`/`<summary>` disclosure as `DisclosureTriangle`
 * — a Chromium-internal role name, not an ARIA one — which is in neither
 * `ACTABLE` nor any other panel predicate, so the panel offers no affordance
 * for it. The DOM producer has a `toggle` action for this shape; the native
 * path has no equivalent.
 *
 * Note the two halves are separate: the DISPATCH works (a click reaches the
 * summary and the browser toggles the element), it is only the AFFORDANCE that
 * is missing. So this asserts both — that dispatch succeeds if asked, and that
 * the role is a Chromium-internal one the panel's ARIA-keyed predicates were
 * never going to match. Closing the gap is a design decision, not a bug fix,
 * and is out of this suite's scope (see `e2e/README.md`).
 */
test("a native <details> disclosure has no ARIA role for the panel to match", async ({
  nav,
}) => {
  const { page, tabId } = await nav.open("accordion.html");
  const tree = await nav.readNodes(tabId);

  expect(nodes(tree, "DisclosureTriangle").map((d) => d.name)).toEqual([
    "Shipping Address",
  ]);
  const disclosure = node(tree, "DisclosureTriangle");
  expect(disclosure.states?.expanded).toBe(false);
  // Not `button`, `checkbox` or anything else `ACTABLE` knows about.
  expect(disclosure.role).not.toBe("button");

  // The dispatch itself is fine — only the affordance is missing.
  expect(await nav.act(tabId, disclosure.id, "click")).toEqual({
    success: true,
  });
  await expect(page.locator("#shipping")).toHaveAttribute("open", "");
});
