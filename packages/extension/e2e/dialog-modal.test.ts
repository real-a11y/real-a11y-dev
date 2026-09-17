/**
 * Dialog (Modal) — past the click, which is the only part that was ever in
 * doubt.
 *
 * Mechanically a dialog is just buttons: the trigger click always reports
 * success. What that cannot tell you is whether the page behind it really went
 * inert — precisely the "looks fine, isn't" shape round 15's slider half warns
 * about. So these tests assert on what the dogfooder is actually reading and
 * acting through once the modal is open.
 */

import { expect, node, test } from "./harness";

test("opening a modal replaces the tree with the dialog's own", async ({
  nav,
}) => {
  const { page, tabId } = await nav.open("dialog-modal.html");
  const trigger = node(
    await nav.readNodes(tabId),
    "button",
    "Add delivery address",
  );

  expect(await nav.act(tabId, trigger.id, "click")).toEqual({ success: true });
  await expect(page.locator("#address-dialog")).toHaveAttribute("open", "");

  // Chromium's own tree goes inert-aware: with the modal open, the background
  // is GONE from the tree, not merely marked. That is the real answer to "is
  // the dogfooder reading the dialog?" — and it is a property of the native
  // producer worth pinning, since nothing else in the suite exercises it.
  const inside = await nav.readNodes(tabId);
  expect(node(inside, "dialog").states?.modal).toBe(true);
  expect(inside.some((n) => n.name === "Background action")).toBe(false);
  expect(node(inside, "textbox", "Street")).toBeDefined();
});

test("acting through the dialog works and closes it", async ({ nav }) => {
  const { page, tabId } = await nav.open("dialog-modal.html");
  await nav.act(
    tabId,
    node(await nav.readNodes(tabId), "button", "Add delivery address").id,
    "click",
  );

  const inside = await nav.readNodes(tabId);
  expect(
    await nav.act(
      tabId,
      node(inside, "textbox", "Street").id,
      "type",
      "12 Mill Lane",
    ),
  ).toEqual({ success: true });
  await expect(page.locator("#street")).toHaveValue("12 Mill Lane");

  await nav.act(tabId, node(inside, "button", "Save").id, "click");
  await expect(page.locator("#address-dialog")).not.toHaveAttribute("open", "");
  await expect(page.locator("#dialog-echo")).toHaveText("saved:12 Mill Lane");

  // The background is back on the tree once the modal is gone.
  expect(
    node(await nav.readNodes(tabId), "button", "Background action"),
  ).toBeDefined();
});

test("cancel closes without saving", async ({ nav }) => {
  const { page, tabId } = await nav.open("dialog-modal.html");
  await nav.act(
    tabId,
    node(await nav.readNodes(tabId), "button", "Add delivery address").id,
    "click",
  );

  const inside = await nav.readNodes(tabId);
  await nav.act(tabId, node(inside, "button", "Cancel").id, "click");
  await expect(page.locator("#address-dialog")).not.toHaveAttribute("open", "");
  await expect(page.locator("#dialog-echo")).toHaveText("none");
});

/**
 * A limitation this suite found, pinned as current behaviour.
 *
 * `pageClick` drives the page with `dispatchEvent`, and `dispatchEvent` reaches
 * a listener regardless of whether the element is inert — so a node id captured
 * BEFORE a modal opened still fires its handler afterwards, and the marker
 * reports success. A real pointer could not do this.
 *
 * Three things bound how much this matters, and all three are why it is
 * recorded rather than fixed here. It needs a STALE id: the background node is
 * absent from the tree while the modal is open (the first test above), so the
 * panel cannot offer it. It is inherent to synthetic dispatch rather than
 * specific to the native path — `element.click()` behaves identically, and the
 * DOM producer dispatches the same way. And the alternative (an inertness check
 * before dispatch) is a change to shipped dispatch code, which is the
 * maintainer's call, not this suite's.
 */
test("KNOWN GAP: a stale background id still dispatches through an open modal", async ({
  nav,
}) => {
  const { page, tabId } = await nav.open("dialog-modal.html");
  const before = await nav.readNodes(tabId);
  const background = node(before, "button", "Background action");

  await nav.act(
    tabId,
    node(before, "button", "Add delivery address").id,
    "click",
  );
  await expect(page.locator("#address-dialog")).toHaveAttribute("open", "");

  expect(await nav.act(tabId, background.id, "click")).toEqual({
    success: true,
  });
  await expect(page.locator("#dialog-echo")).toHaveText("background!");
});
