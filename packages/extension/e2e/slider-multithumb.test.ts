/**
 * Slider (Multi-Thumb) — the pattern this suite exists for.
 *
 * Rounds 12 and 15 of PR #348 both landed on this widget. Round 12 fixed
 * "sliders aren't interactable", verified it end-to-end in a real headed
 * Chromium, and shipped — and it was still broken here, because the
 * verification used a `<div role="slider">` with a target-bound keydown
 * handler rather than the real example's SVG `<g role="slider">` with a handler
 * gated on `document.activeElement === this`. The hand-built reproduction
 * passed while the actual target pattern kept failing.
 *
 * So every assertion below is on the **page's own state** (`aria-valuenow`),
 * never on the dispatch marker alone: round 15's whole finding was that
 * `NATIVE_ACT` reported `{ success: true }` while the widget silently ignored
 * everything.
 */

import { expect, node, nodes, test } from "./harness";

test("both SVG thumbs surface as sliders with their own values", async ({
  nav,
}) => {
  const { tabId } = await nav.open("slider-multithumb.html");
  const tree = await nav.readNodes(tabId);

  const sliders = nodes(tree, "slider");
  expect(sliders).toHaveLength(2);
  // Chromium reports the SVG `<g role="slider">` literally as `slider` rather
  // than downgrading it to `generic`/`group` — the first thing round 15 ruled
  // out, and the premise every assertion below rests on.
  expect(sliders.map((s) => s.name)).toEqual([
    "Minimum price",
    "Maximum price",
  ]);
  // Authored bounds are page data, not user input, so they survive the R1
  // allowlist — `valuenow`/`valuetext` deliberately do not.
  expect(sliders[0].properties).toMatchObject({
    valuemin: "0",
    valuemax: "100",
  });
  expect(sliders[0].properties?.valuenow).toBeUndefined();
});

test("increment moves a target-bound thumb (the APG example's own shape)", async ({
  nav,
}) => {
  const { page, tabId } = await nav.open("slider-multithumb.html");
  const thumb = node(await nav.readNodes(tabId), "slider", "Minimum");

  expect(await nav.act(tabId, thumb.id, "increment")).toEqual({
    success: true,
  });
  await expect(page.locator("#min-thumb")).toHaveAttribute(
    "aria-valuenow",
    "26",
  );
});

test("decrement moves it back", async ({ nav }) => {
  const { page, tabId } = await nav.open("slider-multithumb.html");
  const thumb = node(await nav.readNodes(tabId), "slider", "Minimum");

  await nav.act(tabId, thumb.id, "decrement");
  await expect(page.locator("#min-thumb")).toHaveAttribute(
    "aria-valuenow",
    "24",
  );
});

/**
 * The round-15 regression, pinned. Focus deliberately sits on an unrelated
 * button first — mirroring a dogfooder whose last real click was the panel's
 * own step button — so the only way `aria-valuenow` moves is `pageStep`
 * focusing the thumb before dispatching.
 */
test("increment moves a FOCUS-GATED thumb even when focus is elsewhere", async ({
  nav,
}) => {
  const { page, tabId } = await nav.open("slider-multithumb.html");
  await page.locator("#elsewhere").focus();
  expect(await page.evaluate(() => document.activeElement?.id)).toBe(
    "elsewhere",
  );

  const thumb = node(await nav.readNodes(tabId), "slider", "Maximum");
  expect(await nav.act(tabId, thumb.id, "increment")).toEqual({
    success: true,
  });

  await expect(page.locator("#max-thumb")).toHaveAttribute(
    "aria-valuenow",
    "76",
  );
});

/**
 * `pageStep`'s two-stage restore, at the level that matters to a dogfooder: the
 * focus it takes to reach a focus-gated handler is given back, so the panel
 * button they just pressed is still where the keyboard is.
 */
test("stepping restores focus to where it was", async ({ nav }) => {
  const { page, tabId } = await nav.open("slider-multithumb.html");
  await page.locator("#elsewhere").focus();

  const thumb = node(await nav.readNodes(tabId), "slider", "Maximum");
  await nav.act(tabId, thumb.id, "increment");

  // The restore's second stage runs on a `setTimeout(0)`, after the dispatch
  // has already returned — so settle the task queue before reading.
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.id))
    .toBe("elsewhere");
});

/** Each thumb is addressed independently — a multi-thumb widget's whole point,
 *  and the one thing a single-thumb fixture cannot check. */
test("thumbs move independently", async ({ nav }) => {
  const { page, tabId } = await nav.open("slider-multithumb.html");
  const tree = await nav.readNodes(tabId);

  await nav.act(tabId, node(tree, "slider", "Minimum").id, "increment");

  await expect(page.locator("#min-thumb")).toHaveAttribute(
    "aria-valuenow",
    "26",
  );
  await expect(page.locator("#max-thumb")).toHaveAttribute(
    "aria-valuenow",
    "75",
  );
});
