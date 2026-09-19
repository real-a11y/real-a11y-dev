/**
 * Combobox — both ARIA shapes, in one file deliberately.
 *
 * ARIA overloads `combobox` across an EDITABLE autocomplete input and a
 * SELECT-ONLY trigger, and the project has now been burned once in each
 * direction: round 4 found a select-only combobox prompting for text it had
 * nowhere to put, and round 13 found an editable one that would only ever
 * click. The fix for either is only correct if it does not re-break the other,
 * so the pair is tested together.
 *
 * The discriminator is the native tree's own `editable` state — Chromium's
 * answer to "does this AX node accept typed text" — which `isTypableRole`
 * consults for `combobox` and for no other role.
 */

import { expect, node, test } from "./harness";

test("an editable combobox reports the editable state", async ({ nav }) => {
  const { tabId } = await nav.open("combobox-editable.html");
  const combobox = node(await nav.readNodes(tabId), "combobox");

  expect(combobox.name).toBe("Choose a fruit");
  // "plaintext" rather than `true` — Chromium sends the editability KIND here,
  // which is why `isTypableRole` coerces with `Boolean(...)` rather than
  // comparing against `true`.
  expect(combobox.states?.editable).toBe("plaintext");
  expect(combobox.properties).toMatchObject({ autocomplete: "list" });
});

test("a select-only combobox reports NO editable state", async ({ nav }) => {
  const { tabId } = await nav.open("combobox-select-only.html");
  const combobox = node(await nav.readNodes(tabId), "combobox");

  expect(combobox.name).toBe("Favorite Fruit");
  expect(combobox.states?.editable).toBeUndefined();
});

test("typing into an editable combobox lands in the page", async ({ nav }) => {
  const { page, tabId } = await nav.open("combobox-editable.html");
  const combobox = node(await nav.readNodes(tabId), "combobox");

  expect(await nav.act(tabId, combobox.id, "type", "Ban")).toEqual({
    success: true,
  });
  await expect(page.locator("#fruit")).toHaveValue("Ban");
  // The page's own `input` handler ran — the value was not merely written
  // behind its back, which is the whole reason `pageType` goes through the
  // native setter and then dispatches the event itself.
  await expect(page.locator("#fruit-echo")).toHaveText("Ban");
  // And the widget reacted the way an autocomplete combobox is supposed to.
  await expect(page.locator("#fruit")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#opt-banana")).toBeVisible();
  await expect(page.locator("#opt-apple")).toBeHidden();
});

test("R1: the typed text never comes back out", async ({ nav }) => {
  const { tabId } = await nav.open("combobox-editable.html");
  const combobox = node(await nav.readNodes(tabId), "combobox");

  const result = await nav.act(tabId, combobox.id, "type", "secret-sauce");
  // The marker is structural only. Asserted on the serialized response rather
  // than field-by-field, so a future field carrying page text is caught too.
  expect(JSON.stringify(result)).not.toContain("secret-sauce");
  expect(result).toEqual({ success: true });
});

test("clicking a select-only combobox opens it (round 4)", async ({ nav }) => {
  const { page, tabId } = await nav.open("combobox-select-only.html");
  const combobox = node(await nav.readNodes(tabId), "combobox");

  expect(await nav.act(tabId, combobox.id, "click")).toEqual({ success: true });
  await expect(page.locator("#favorite")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(page.locator("#favorite-state")).toHaveText("open");
});

/**
 * The refusal round 4's prompt-dialog bug was hiding behind. The dispatch
 * mechanism was never wrong — `pageType` correctly refuses a non-editable
 * element — so this pins the in-page check itself, independent of whether the
 * panel ever offers the affordance.
 */
test("typing into a select-only combobox refuses cleanly", async ({ nav }) => {
  const { page, tabId } = await nav.open("combobox-select-only.html");
  const combobox = node(await nav.readNodes(tabId), "combobox");

  expect(await nav.act(tabId, combobox.id, "type", "Banana")).toEqual({
    success: false,
    error: "not-a-text-field",
  });
  await expect(page.locator("#favorite")).toHaveText("Apple");
  await expect(page.locator("#favorite-state")).toHaveText("closed");
});
