/**
 * Slider (single-thumb) — both shapes the APG demonstrates.
 *
 * `pageStep` takes materially different paths for the two: native
 * `stepUp()`/`stepDown()` for an `<input type="range">`, an ArrowRight/Left
 * dispatch for a custom `role="slider"` widget. Covering only one leaves half
 * the function untested against a real browser.
 */

import { expect, node, nodes, test } from "./harness";

test("both shapes surface as sliders, with bounds but no value property", async ({
  nav,
}) => {
  const { tabId } = await nav.open("slider-single.html");
  const tree = await nav.readNodes(tabId);

  expect(nodes(tree, "slider").map((s) => s.name)).toEqual([
    "Temperature",
    "Red",
  ]);
  // R1, pinned against a real browser rather than a hand-built CDP payload:
  // `valuemin`/`valuemax` are authored bounds and survive; `valuenow` and
  // `valuetext` are excluded from `DETAIL_PROPS` because Chromium's own payload
  // cannot be trusted to have redacted a value-bearing control.
  const temperature = node(tree, "slider", "Temperature");
  expect(temperature.properties).toMatchObject({
    valuemin: "50",
    valuemax: "100",
  });
  expect(temperature.properties?.valuenow).toBeUndefined();
  expect(temperature.properties?.valuetext).toBeUndefined();
});

test("a custom role=slider steps via the keyboard path", async ({ nav }) => {
  const { page, tabId } = await nav.open("slider-single.html");
  const thumb = node(await nav.readNodes(tabId), "slider", "Temperature");

  expect(await nav.act(tabId, thumb.id, "increment")).toEqual({
    success: true,
  });
  await expect(page.locator("#temp-thumb")).toHaveAttribute(
    "aria-valuenow",
    "69",
  );
  // The page's own handler ran — not just the attribute being written by us.
  await expect(page.locator("#temp-out")).toHaveText("69");

  await nav.act(tabId, thumb.id, "decrement");
  await expect(page.locator("#temp-thumb")).toHaveAttribute(
    "aria-valuenow",
    "68",
  );
});

test("a native range input steps via stepUp/stepDown and fires input", async ({
  nav,
}) => {
  const { page, tabId } = await nav.open("slider-single.html");
  const range = node(await nav.readNodes(tabId), "slider", "Red");

  await nav.act(tabId, range.id, "increment");
  await expect(page.locator("#rgb-red")).toHaveValue("129");
  // `stepUp()` alone fires nothing; `pageStep` dispatches `input`/`change`
  // itself afterwards, and this is the assertion that proves it — a page
  // listening for the event is the normal case, not an edge one.
  await expect(page.locator("#rgb-out")).toHaveText("129");

  await nav.act(tabId, range.id, "decrement");
  await expect(page.locator("#rgb-red")).toHaveValue("128");
});

/** A native input's live value is read back (round 9), where the custom
 *  widget's is not — `pageReadValue` only reads input/textarea/select, exactly
 *  as the DOM producer's own badge does. */
test("value read-back follows the backing element, not the role", async ({
  nav,
}) => {
  const { tabId } = await nav.open("slider-single.html");
  const tree = await nav.readNodes(tabId);

  expect(node(tree, "slider", "Red").value).toBe("128");
  expect(node(tree, "slider", "Temperature").value).toBeUndefined();
});
