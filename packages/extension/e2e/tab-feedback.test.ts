/**
 * The TAB view's feedback line after a row's action, through the real build
 * in real Chromium (ADR-0001). Naming the item a user picked in a sensitive
 * field's popup says what the field holds, and a TAB row can't tell such an
 * item from an ordinary one with no state: the content script says, read
 * from the page before the action lands (`DISPATCH_ACTION`'s
 * `choiceWithheld`), and the line waits for it.
 */

import { expect, test, type NativeHarness } from "./harness";

/** Select the tab stop named `name` and Activate it, from inside the panel:
 *  a Playwright click would bring the panel's own tab to the front first. */
async function activate(nav: NativeHarness, name: string): Promise<void> {
  await nav.panel.evaluate((want) => {
    const stop = [
      ...document.querySelectorAll(
        '[aria-label="Tab sequence"] [role="option"]',
      ),
    ].find((o) => o.querySelector(".sn-tab-name")?.textContent === want);
    if (!stop) throw new Error(`no tab stop ${want}`);
    (stop as HTMLElement).click();
  }, name);
  await expect(
    nav.tabStops().getByRole("option", { selected: true }),
  ).toContainText(name);
  await nav.panel.evaluate(() => {
    const button = [
      ...document.querySelectorAll<HTMLButtonElement>(".sn-list-action-btn"),
    ].find((b) => b.textContent?.trim() === "Activate");
    if (!button || button.disabled) throw new Error("no Activate");
    button.click();
  });
}

/** Every feedback line the panel shows from here on, in order. */
async function recordFeedback(
  nav: NativeHarness,
): Promise<() => Promise<string[]>> {
  await nav.panel.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __feedback: string[] }).__feedback = seen;
    new MutationObserver(() => {
      const text = document
        .querySelector(".sn-action-feedback-text")
        ?.textContent?.trim();
      if (text && seen[seen.length - 1] !== text) seen.push(text);
    }).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
  return () =>
    nav.panel.evaluate(
      () => (window as unknown as { __feedback: string[] }).__feedback,
    );
}

test("TAB view: picking an item in a sensitive popup names no item; an ordinary one names itself", async ({
  nav,
}) => {
  const { page } = await nav.showTabOrder("tab-feedback.html");
  await nav.routeToPage(["DISPATCH_ACTION"]);
  const feedback = await recordFeedback(nav);

  // The TAB list names it no more than the line does: under a roving
  // tabindex the stop would say which month is chosen.
  await expect(nav.tabStops()).not.toContainText("03");
  await activate(nav, "[redacted]");
  await expect.poll(feedback).toEqual(["Selected an option in this field"]);
  // The click landed, and closed the popup it was picked in.
  await expect(page.locator("#months")).toBeHidden();

  await activate(nav, "Red");
  await activate(nav, "Guides");
  await expect
    .poll(feedback)
    .toEqual([
      "Selected an option in this field",
      "Click: Red",
      "Click: Guides",
    ]);
});
