/**
 * Turning native mode on and off, on the store build (`dist/`): the question
 * a fresh profile is asked on its first connect, the Enable → Disable round
 * trip for a user who kept the DOM tree, and an answer given in another
 * window's side panel, which every open panel follows.
 *
 * These are the first things a store user meets, and the only suite that runs
 * the build the listing ships: the manifest it asks Chrome for, the absence of
 * the dogfood-only diagnostics, and the native-mode question itself.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type NativeHarness } from "./harness";

test.use({ build: "store", nativeEnabled: false });

const DIST = resolve(fileURLToPath(import.meta.url), "../../dist");

/** Every JavaScript file the store build ships. */
async function shippedScripts(dir = DIST): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await shippedScripts(path)));
    else if (entry.name.endsWith(".js")) out.push(path);
  }
  return out;
}

/** Open a fixture, bind the panel to it, and start as a user who answered
 *  the native-mode question by keeping the DOM tree. */
async function domChosenPanel(nav: NativeHarness) {
  const { page } = await nav.open("native-panel.html");
  await page.bringToFront();
  await nav.panel.evaluate(() =>
    chrome.storage.local.set({ "settings.nativeModeEnabled": false }),
  );
  await nav.panel.reload();
  const enableEntry = nav.panel.getByRole("button", {
    name: "Enable native mode…",
  });
  await expect(enableEntry).toBeVisible({ timeout: 20_000 });
  return { page, enableEntry };
}

/** Open a fixture, bind the panel to it, and start as a profile that has
 *  never answered the native-mode question. */
async function firstRunPanel(nav: NativeHarness) {
  const { page } = await nav.open("native-panel.html");
  await page.bringToFront();
  await nav.panel.evaluate(() =>
    chrome.storage.local.remove("settings.nativeModeEnabled"),
  );
  await nav.panel.reload();
  const question = nav.panel.getByRole("dialog", { name: "Native mode" });
  await expect(question).toBeVisible({ timeout: 20_000 });
  return { page, question };
}

const storedSetting = (nav: NativeHarness) =>
  nav.panel.evaluate(() =>
    chrome.storage.local
      .get("settings.nativeModeEnabled")
      .then((r) => r["settings.nativeModeEnabled"]),
  );

test("a fresh profile is asked on its first connect, before anything attaches", async ({
  nav,
}) => {
  const { question } = await firstRunPanel(nav);
  // What the user is agreeing to is the dialog's description, so a screen
  // reader announces it along with the button that has focus.
  await expect(question).toHaveAccessibleDescription(
    /started debugging this browser.*Or keep the DOM tree/,
  );
  // The fixture page has the window's focus, so read the panel's own
  // active element rather than asking Playwright whether it is focused.
  await expect
    .poll(() =>
      nav.panel.evaluate(() => document.activeElement?.textContent?.trim()),
    )
    .toBe("Use native mode");
  // The DOM tree shows behind the question; nothing native has been read.
  await expect
    .poll(() => nav.panel.locator(".sn-node").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
  expect(await nav.nativeReads()).toHaveLength(0);
  expect(await storedSetting(nav)).toBeUndefined();
});

test("using native mode from the first-run question reads the native tree", async ({
  nav,
}) => {
  const { question } = await firstRunPanel(nav);
  await question.getByRole("button", { name: "Use native mode" }).click();

  await expect(
    nav.panel.getByRole("button", { name: "NATIVE", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    nav.panel.getByRole("button", { name: "Refresh native tree" }),
  ).toBeVisible();
  await expect(question).toHaveCount(0);
  // One read: the answer's own. The once-per-session native default is
  // spent by turning native mode on, so it doesn't read a second time.
  await expect
    .poll(async () => (await nav.nativeReads()).length, { timeout: 20_000 })
    .toBe(1);
  await nav.panel.waitForTimeout(1_000);
  expect(await nav.nativeReads()).toHaveLength(1);
  expect(await storedSetting(nav)).toBe(true);
});

test("keeping the DOM tree is remembered, so the next panel doesn't ask", async ({
  nav,
}) => {
  const { question } = await firstRunPanel(nav);
  await question.getByRole("button", { name: "Keep the DOM tree" }).click();
  await expect(question).toHaveCount(0);
  await expect(nav.panel.getByText("Keeping the DOM tree")).toBeVisible();
  await expect.poll(() => storedSetting(nav)).toBe(false);

  await nav.panel.reload();
  await expect(
    nav.panel.getByRole("button", { name: "Enable native mode…" }),
  ).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(() => nav.panel.locator(".sn-node").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await expect(
    nav.panel.getByRole("dialog", { name: "Native mode" }),
  ).toHaveCount(0);
  expect(await nav.nativeReads()).toHaveLength(0);
});

test("keeping the DOM tree puts focus on Enable native mode…", async ({
  nav,
}) => {
  // The question opened by itself, so nothing in the panel had focus before
  // it: without a target, focus would fall to the page body.
  const { question } = await firstRunPanel(nav);
  await question
    .getByRole("button", { name: "Use native mode" })
    .press("Escape");
  await expect(question).toHaveCount(0);
  await expect
    .poll(() =>
      nav.panel.evaluate(() => document.activeElement?.textContent?.trim()),
    )
    .toBe("Enable native mode…");
});

// Each window has its own side panel, and the setting is shared: these play
// another window's panel by sending what it sends, from outside this
// panel's own state.
const answerInAnotherWindow = (nav: NativeHarness, enabled: boolean) =>
  nav.panel.evaluate(
    (on) =>
      chrome.runtime.sendMessage({ type: "NATIVE_FLAG_SET", enabled: on }),
    enabled,
  );

test("a yes in another window closes this panel's question without reading here", async ({
  nav,
}) => {
  const { question } = await firstRunPanel(nav);
  await answerInAnotherWindow(nav, true);

  await expect(question).toHaveCount(0);
  await expect(
    nav.panel.getByRole("group", { name: "Tree producer" }),
  ).toBeVisible();
  // This panel was already showing the page, and nobody pressed anything in
  // it, so nothing read the page natively here.
  await nav.panel.waitForTimeout(1_000);
  expect(await nav.nativeReads()).toHaveLength(0);
  expect(await storedSetting(nav)).toBe(true);
});

test("keeping the DOM tree never turns off native mode another window turned on", async ({
  nav,
}) => {
  const { tabId } = await nav.open("native-panel.html");
  await answerInAnotherWindow(nav, true);

  // What a question still open in this window sends when the user keeps
  // the DOM tree there.
  const reply = await nav.panel.evaluate(() =>
    chrome.runtime.sendMessage({ type: "NATIVE_FLAG_DECLINE" }),
  );
  expect(reply).toEqual({ enabled: true, chosen: true });
  expect(await storedSetting(nav)).toBe(true);
  // The other window's native tree still reads: nothing was detached or
  // switched off under it.
  const read = await nav.read(tabId);
  expect(read.ok).toBe(true);
});

test("a panel opened before another window answered doesn't ask, and reads its first page", async ({
  nav,
}) => {
  // Opened on a tab with no page to connect to, so it hasn't asked yet.
  await nav.panel.evaluate(() =>
    chrome.storage.local.remove("settings.nativeModeEnabled"),
  );
  await nav.panel.bringToFront();
  await nav.panel.reload();
  await answerInAnotherWindow(nav, true);

  const { page } = await nav.open("native-panel.html");
  await page.bringToFront();
  await nav.panel
    .getByRole("button", { name: /Load tree|Refresh tree/ })
    .first()
    .click();

  // Its first page reads natively, as for a panel opened with native mode on.
  await expect(
    nav.panel.getByRole("button", { name: "NATIVE", exact: true }),
  ).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
  await expect(
    nav.panel.getByRole("dialog", { name: "Native mode" }),
  ).toHaveCount(0);
  await expect
    .poll(async () => (await nav.nativeReads()).length, { timeout: 20_000 })
    .toBe(1);
});

test("native mode turned off in another window returns this panel to the DOM tree", async ({
  nav,
}) => {
  const { enableEntry } = await domChosenPanel(nav);
  await enableEntry.click();
  await nav.panel
    .getByRole("dialog", { name: "Native mode" })
    .getByRole("button", { name: "Use native mode" })
    .click();
  await expect(
    nav.panel.getByRole("button", { name: "Refresh native tree" }),
  ).toBeVisible({ timeout: 20_000 });

  await answerInAnotherWindow(nav, false);

  await expect(
    nav.panel.getByRole("button", { name: "Enable native mode…" }),
  ).toBeVisible();
  await expect(
    nav.panel.getByRole("button", { name: "Refresh native tree" }),
  ).toHaveCount(0);
  await expect(
    nav.panel.getByRole("button", { name: "NATIVE", exact: true }),
  ).toHaveCount(0);
});

test("the store build asks for native mode's permissions and ships no dogfood diagnostics", async ({
  nav,
}) => {
  const permissions = await nav.panel.evaluate(
    () => chrome.runtime.getManifest().permissions,
  );
  expect(permissions).toEqual(
    expect.arrayContaining(["debugger", "tabs", "storage"]),
  );

  // Message types only the dogfood build's report and clear buttons send. A
  // component name can't be grepped for, since minification removes it.
  const bundle = (
    await Promise.all((await shippedScripts()).map((f) => readFile(f, "utf8")))
  ).join("\n");
  expect(bundle).not.toContain("NATIVE_DOGFOOD_REPORT");
  expect(bundle).not.toContain("NATIVE_DOGFOOD_CLEAR");
  expect(bundle).toContain("chrome.debugger");
});

test("after keeping the DOM tree, the toolbar offers Enable and no NATIVE toggle", async ({
  nav,
}) => {
  const { enableEntry } = await domChosenPanel(nav);
  await expect(enableEntry).toHaveAttribute("aria-haspopup", "dialog");
  await expect(enableEntry).toHaveAttribute("aria-expanded", "false");
  await expect(
    nav.panel.getByRole("group", { name: "Tree producer" }),
  ).toHaveCount(0);
  // NativeTreeView, and its refresh button, isn't mounted.
  await expect(
    nav.panel.getByRole("button", { name: "Refresh native tree" }),
  ).toHaveCount(0);
});

test("Enable native mode… asks again, and saying yes moves focus to NATIVE and reads the tree", async ({
  nav,
}) => {
  const { enableEntry } = await domChosenPanel(nav);
  await enableEntry.click();
  await expect(enableEntry).toHaveAttribute("aria-expanded", "true");
  const banner = nav.panel.getByRole("dialog", { name: "Native mode" });
  await expect(banner).toContainText("started debugging this browser");
  await banner.getByRole("button", { name: "Use native mode" }).click();

  const nativeToggle = nav.panel.getByRole("button", {
    name: "NATIVE",
    exact: true,
  });
  await expect(nativeToggle).toHaveAttribute("aria-pressed", "true");
  await expect(nativeToggle).toBeFocused();
  await expect(nav.panel.getByText("Native mode on")).toBeVisible();
  await expect
    .poll(() => nav.panel.locator(".sn-node").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
  // One read: the consent click's own. The once-per-session native default
  // is spent by turning native mode on, so it doesn't read a second time.
  expect(await nav.nativeReads()).toHaveLength(1);
  expect(
    await nav.panel.evaluate(() =>
      chrome.storage.local
        .get("settings.nativeModeEnabled")
        .then((r) => r["settings.nativeModeEnabled"]),
    ),
  ).toBe(true);
});

test("Disable returns to DOM, hides the toggle and moves focus to Enable", async ({
  nav,
}) => {
  const { enableEntry } = await domChosenPanel(nav);
  await enableEntry.click();
  await nav.panel
    .getByRole("dialog", { name: "Native mode" })
    .getByRole("button", { name: "Use native mode" })
    .click();
  await expect
    .poll(() => nav.panel.locator(".sn-node").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);

  await nav.panel.getByRole("button", { name: "Disable native mode" }).click();

  await expect(enableEntry).toBeFocused();
  await expect(nav.panel.getByText("Native mode off")).toBeVisible();
  await expect(
    nav.panel.getByRole("group", { name: "Tree producer" }),
  ).toHaveCount(0);
  // Back on the DOM tree: the native tree's view is gone.
  await expect(
    nav.panel.getByRole("button", { name: "Refresh native tree" }),
  ).toHaveCount(0);
  expect(
    await nav.panel.evaluate(() =>
      chrome.storage.local
        .get("settings.nativeModeEnabled")
        .then((r) => r["settings.nativeModeEnabled"]),
    ),
  ).toBe(false);
});

test("a failed turn-on surfaces its error inline and never flips the setting", async ({
  nav,
}) => {
  const { enableEntry } = await domChosenPanel(nav);

  // NATIVE_FLAG_SET never reaching the service worker: a torn-down extension
  // context, or an MV3 worker that hasn't woken. Only that message is
  // intercepted; the DOM producer's own connection goes through untouched.
  await nav.panel.evaluate(() => {
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = ((message: unknown, ...rest: unknown[]) => {
      if ((message as { type?: unknown } | null)?.type === "NATIVE_FLAG_SET") {
        return Promise.reject(
          new Error("simulated: service worker unreachable"),
        );
      }
      return (
        real as (message: unknown, ...rest: unknown[]) => Promise<unknown>
      )(message, ...rest);
    }) as typeof chrome.runtime.sendMessage;
  });

  await enableEntry.click();
  const banner = nav.panel.getByRole("dialog", { name: "Native mode" });
  await banner.getByRole("button", { name: "Use native mode" }).click();

  // The banner stays open with the error; the view never switches to a
  // native tree for a setting that was never persisted.
  await expect(banner.getByRole("alert")).toContainText(
    "Couldn't enable native mode",
  );
  await expect(enableEntry).toBeVisible();
  await expect(
    nav.panel.getByRole("button", { name: "NATIVE", exact: true }),
  ).toHaveCount(0);
});

test("Keep the DOM tree waits while a yes is on its way, so it can't close over one", async ({
  nav,
}) => {
  const { enableEntry } = await domChosenPanel(nav);

  // Hold NATIVE_FLAG_SET's answer until the test lets it through: the
  // service worker may already have written the setting by then.
  await nav.panel.evaluate(() => {
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    const w = window as unknown as { releaseFlagSet?: () => void };
    chrome.runtime.sendMessage = ((message: unknown, ...rest: unknown[]) => {
      const sent = (
        real as (message: unknown, ...rest: unknown[]) => Promise<unknown>
      )(message, ...rest);
      if ((message as { type?: unknown } | null)?.type !== "NATIVE_FLAG_SET") {
        return sent;
      }
      return new Promise<unknown>((resolve) => {
        w.releaseFlagSet = () => resolve(sent);
      });
    }) as typeof chrome.runtime.sendMessage;
  });

  await enableEntry.click();
  const banner = nav.panel.getByRole("dialog", { name: "Native mode" });
  await banner.getByRole("button", { name: "Use native mode" }).click();
  const enabling = banner.getByRole("button", { name: "Turning on…" });
  await expect(enabling).toHaveAttribute("aria-disabled", "true");

  // Neither "Keep the DOM tree" nor Escape closes the banner over the
  // pending request. Dispatched, not `click()`: Playwright waits for an
  // aria-disabled button to enable, but a user's click still reaches its
  // handler.
  const keep = banner.getByRole("button", { name: "Keep the DOM tree" });
  await expect(keep).toHaveAttribute("aria-disabled", "true");
  await keep.dispatchEvent("click");
  await nav.panel.keyboard.press("Escape");
  await expect(banner).toBeVisible();

  await nav.panel.evaluate(() =>
    (window as unknown as { releaseFlagSet: () => void }).releaseFlagSet(),
  );
  await expect(
    nav.panel.getByRole("button", { name: "NATIVE", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(banner).toHaveCount(0);
});
