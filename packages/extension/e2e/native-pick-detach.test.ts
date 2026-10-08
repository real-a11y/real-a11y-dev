/**
 * An armed native pick that Chrome itself detaches, through the real
 * browser rather than a fake `chrome.debugger`: the ordering these paths
 * rely on (a pending command rejects before `onDetach` fires, with
 * `target_closed`) is Chromium's, and a future Chromium could change it.
 *
 * Both end the pick as a plain cancel, `{ cancelled: true }`, the same as
 * Escape — not as a failure, and with no second attach to re-arm it. A retry
 * would show here as an error result, since neither a closed tab nor a
 * `chrome://` page can be attached again. Chrome's debugging-bar Cancel
 * (`canceled_by_user`) takes the same path, but headless Chromium has no
 * bar to press, so the unit tests cover that reason.
 */

import { expect, test } from "./harness";

type PanelPage = import("@playwright/test").Page;

/** Record every NATIVE_PICK_RESULT the panel receives. Install after the
 *  panel's last reload. */
async function recordPickResults(
  panel: PanelPage,
): Promise<() => Promise<unknown[]>> {
  await panel.evaluate(() => {
    const w = window as typeof window & { __pickResults?: unknown[] };
    w.__pickResults = [];
    chrome.runtime.onMessage.addListener(
      (m: { type?: string; payload?: unknown }) => {
        if (m?.type === "NATIVE_PICK_RESULT") w.__pickResults!.push(m.payload);
      },
    );
  });
  return () =>
    panel.evaluate(
      () =>
        (window as typeof window & { __pickResults?: unknown[] })
          .__pickResults ?? [],
    );
}

async function armPick(panel: PanelPage): Promise<void> {
  const pickButton = panel.getByRole("button", {
    name: "Pick element in page",
  });
  await pickButton.click();
  await expect(pickButton).toHaveAttribute("aria-pressed", "true");
  await expect(pickButton).toHaveAttribute("aria-busy", "false");
}

test("closing the tab ends an armed pick as a cancel", async ({ nav }) => {
  const page = await nav.showNative("native-panel.html");
  const results = await recordPickResults(nav.panel);
  await armPick(nav.panel);

  await page.close();

  await expect
    .poll(results, { timeout: 10_000 })
    .toEqual([{ cancelled: true }]);
});

test("navigating to a chrome:// page ends an armed pick as a cancel", async ({
  nav,
}) => {
  const page = await nav.showNative("native-panel.html");
  const results = await recordPickResults(nav.panel);
  await armPick(nav.panel);

  // Chrome closes the debugging session itself (`target_closed`): this
  // extension may not debug a chrome:// page.
  await page.goto("chrome://version");

  await expect
    .poll(results, { timeout: 10_000 })
    .toEqual([{ cancelled: true }]);
});
