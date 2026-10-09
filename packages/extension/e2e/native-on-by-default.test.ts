/**
 * Native mode on by default, on the store build (`dist/`): a fresh profile's
 * first page read natively with nothing asked first, the one-time note about
 * Chrome's debugging bar, the Settings switch that turns native mode off and
 * back on, and a change made in another window's side panel, which every
 * open panel follows.
 *
 * These are the first things a store user meets, and the only suite that runs
 * the build the listing ships: the manifest it asks Chrome for, the absence of
 * the dogfood-only diagnostics, and native mode as it comes out of the box.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type NativeHarness } from "./harness";

test.use({ build: "store" });

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

/** Open a fixture, bind the panel to it, and start as a profile that never
 *  touched Settings and never saw the note: the store build out of the box. */
async function freshPanel(nav: NativeHarness) {
  const opened = await nav.open("native-panel.html");
  await opened.page.bringToFront();
  await nav.panel.evaluate(() =>
    chrome.storage.local.remove([
      "settings.nativeModeEnabled",
      "settings.nativeNoticeSeen",
    ]),
  );
  await nav.panel.reload();
  return opened;
}

/** Open a fixture, bind the panel to it, and start as a user who turned
 *  native mode off in Settings. */
async function offPanel(nav: NativeHarness) {
  const opened = await nav.open("native-panel.html");
  await opened.page.bringToFront();
  await nav.panel.evaluate(() =>
    chrome.storage.local.set({ "settings.nativeModeEnabled": false }),
  );
  await nav.panel.reload();
  await expect
    .poll(() => nav.panel.locator(".sn-node").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
  return opened;
}

const storedSetting = (nav: NativeHarness, key: string) =>
  nav.panel.evaluate((k) => chrome.storage.local.get(k).then((r) => r[k]), key);

const note = (nav: NativeHarness) =>
  nav.panel.getByRole("note", { name: "About Chrome's debugging bar" });

/** Open Settings and return its one switch. */
async function settingsSwitch(nav: NativeHarness) {
  await nav.panel.getByRole("button", { name: "Settings ▾" }).click();
  return nav.panel.getByRole("checkbox", {
    name: "Read pages through Chrome (recommended)",
  });
}

/** What has focus in the panel. Read from the panel itself: the fixture page
 *  has the window's focus, so Playwright's own focus check reports none. */
const focused = (nav: NativeHarness) =>
  nav.panel.evaluate(() => ({
    role: document.activeElement?.getAttribute("role") ?? null,
    label: document.activeElement?.getAttribute("aria-label") ?? "",
    type: (document.activeElement as HTMLInputElement | null)?.type ?? "",
  }));

// Each window has its own side panel, and the setting is shared: these play
// another window's panel by sending what its Settings switch sends, from
// outside this panel's own state.
const setInAnotherWindow = (nav: NativeHarness, enabled: boolean) =>
  nav.panel.evaluate(
    (on) =>
      chrome.runtime.sendMessage({ type: "NATIVE_FLAG_SET", enabled: on }),
    enabled,
  );

test("a fresh profile's first page is read natively, and a note explains Chrome's bar", async ({
  nav,
}) => {
  await freshPanel(nav);

  await expect(nav.nativeTree()).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(async () => (await nav.nativeReads()).length, { timeout: 20_000 })
    .toBe(1);
  await expect(note(nav)).toContainText("started debugging this browser");
  // Nothing was asked first.
  await expect(nav.panel.getByRole("dialog")).toHaveCount(0);
});

test("Got it hides the note for good", async ({ nav }) => {
  await freshPanel(nav);
  await note(nav).getByRole("button", { name: "Got it" }).click();

  await expect(note(nav)).toHaveCount(0);
  await expect
    .poll(() => storedSetting(nav, "settings.nativeNoticeSeen"))
    .toBe(true);
  // Its button went with it, so focus moved to the tree on screen.
  await expect.poll(async () => (await focused(nav)).role).toBe("tree");

  await nav.panel.reload();
  await expect(nav.nativeTree()).toBeVisible({ timeout: 20_000 });
  await expect(note(nav)).toHaveCount(0);
});

test("Turn off in the note shows the in-page tree, and the next panel reads nothing natively", async ({
  nav,
}) => {
  await freshPanel(nav);
  await note(nav).getByRole("button", { name: "Turn off" }).click();

  await expect(nav.viewToggle()).toBeVisible();
  await expect(nav.nativeTree()).toHaveCount(0);
  await expect(note(nav)).toHaveCount(0);
  await expect
    .poll(() => storedSetting(nav, "settings.nativeModeEnabled"))
    .toBe(false);
  await expect
    .poll(() => storedSetting(nav, "settings.nativeNoticeSeen"))
    .toBe(true);

  await nav.panel.reload();
  await expect
    .poll(() => nav.panel.locator(".sn-node").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await nav.panel.waitForTimeout(1_000);
  expect(await nav.nativeReads()).toHaveLength(0);
  await expect(await settingsSwitch(nav)).not.toBeChecked();
  await expect(nav.treeChoice("Chrome's tree")).toHaveCount(0);
});

test("Settings turns native mode off and back on, keeping focus on the switch", async ({
  nav,
}) => {
  await freshPanel(nav);
  await expect(nav.nativeTree()).toBeVisible({ timeout: 20_000 });
  const toggle = await settingsSwitch(nav);
  await expect(toggle).toBeChecked();

  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(nav.treeChoice("Chrome's tree")).toHaveCount(0);
  await expect(nav.viewToggle()).toBeVisible();
  await expect
    .poll(() => storedSetting(nav, "settings.nativeModeEnabled"))
    .toBe(false);
  expect((await focused(nav)).type).toBe("checkbox");

  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(nav.treeChoice("Chrome's tree")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // The switch is a gesture, and it reads the page at once.
  await expect
    .poll(async () => (await nav.nativeReads()).length, { timeout: 20_000 })
    .toBe(2);
  expect((await focused(nav)).type).toBe("checkbox");
});

test("Settings stays on screen in a narrow side panel", async ({ nav }) => {
  await freshPanel(nav);
  await expect(nav.nativeTree()).toBeVisible({ timeout: 20_000 });
  // The in-page tree, whose DOM / A11Y / TAB views make the widest toolbar
  // there is; its controls don't wrap.
  await nav.chooseTree("In-page tree");
  const size = nav.panel.viewportSize();
  await nav.panel.setViewportSize({ width: 320, height: size?.height ?? 720 });
  try {
    await expect(
      nav.panel.getByRole("button", { name: "Settings ▾" }),
    ).toBeInViewport({ ratio: 1 });
    await expect(await settingsSwitch(nav)).toBeInViewport({ ratio: 1 });
    for (const name of ["Chrome's tree", "In-page tree"] as const) {
      await expect(nav.treeChoice(name)).toBeInViewport({ ratio: 1 });
    }
  } finally {
    if (size) await nav.panel.setViewportSize(size);
  }
});

test("Settings holds the choice of tree, leaving the toolbar a single DOM button", async ({
  nav,
}) => {
  await freshPanel(nav);
  await expect(nav.nativeTree()).toBeVisible({ timeout: 20_000 });
  await nav.panel.getByRole("button", { name: "Settings ▾" }).click();
  await expect(nav.treeChoice("Chrome's tree")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await nav.treeChoice("In-page tree").click();
  await expect(nav.viewToggle()).toBeVisible();
  const toolbar = nav.panel.getByRole("toolbar", { name: "Tree controls" });
  await expect(
    toolbar.getByRole("button", { name: "DOM", exact: true }),
  ).toHaveCount(1);
  await expect(
    nav.panel.getByRole("button", { name: "NATIVE", exact: true }),
  ).toHaveCount(0);

  // Settings stayed open; back to Chrome's tree from there.
  await nav.treeChoice("Chrome's tree").click();
  await expect(nav.nativeTree()).toBeVisible({ timeout: 20_000 });
  await expect(nav.viewToggle()).toHaveCount(0);
  // Only this panel's tree changed, not the setting.
  expect(
    await storedSetting(nav, "settings.nativeModeEnabled"),
  ).toBeUndefined();
});

test("a change that doesn't reach the service worker says so and leaves the setting", async ({
  nav,
}) => {
  await freshPanel(nav);
  await expect(nav.nativeTree()).toBeVisible({ timeout: 20_000 });

  // NATIVE_FLAG_SET never reaching the service worker: a torn-down extension
  // context, or an MV3 worker that hasn't woken. Only that message is
  // intercepted; everything else goes through untouched.
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

  const toggle = await settingsSwitch(nav);
  await toggle.click();

  await expect(
    nav.panel.getByText("Couldn't change that setting — try again."),
  ).toBeVisible();
  await expect(toggle).toBeChecked();
  await expect(nav.treeChoice("Chrome's tree")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
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

test("turned on in another window, a panel already showing a page reads nothing", async ({
  nav,
}) => {
  await offPanel(nav);

  await setInAnotherWindow(nav, true);

  // It says where Chrome's tree now is, and offers it without taking it.
  await expect(
    nav.panel.getByText(
      "Reading pages through Chrome is on — choose Chrome's tree in Settings to see it.",
    ),
  ).toBeVisible();
  await nav.panel.getByRole("button", { name: "Settings ▾" }).click();
  await expect(nav.treeChoice("Chrome's tree")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  // Nobody pressed anything in this panel, which was already showing the
  // page, so nothing read it natively here.
  await nav.panel.waitForTimeout(1_000);
  expect(await nav.nativeReads()).toHaveLength(0);
});

test("turned on in another window, a panel that never connected reads its first page", async ({
  nav,
}) => {
  // Opened on a tab with no page to connect to.
  await nav.panel.evaluate(() =>
    chrome.storage.local.set({ "settings.nativeModeEnabled": false }),
  );
  await nav.panel.bringToFront();
  await nav.panel.reload();
  await setInAnotherWindow(nav, true);

  const { page } = await nav.open("native-panel.html");
  await page.bringToFront();
  await nav.panel
    .getByRole("button", { name: /Load tree|Refresh tree/ })
    .first()
    .click();

  // As for a panel opened with native mode on.
  await expect(nav.nativeTree()).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(async () => (await nav.nativeReads()).length, { timeout: 20_000 })
    .toBe(1);
});

test("turned off in another window, this panel returns to the in-page tree with focus on it", async ({
  nav,
}) => {
  await freshPanel(nav);
  await expect(
    nav.panel.getByRole("button", { name: "Refresh native tree" }),
  ).toBeVisible({ timeout: 20_000 });
  // A keyboard user in the native tree, which goes away with native mode.
  // Its rows aren't focusable themselves (aria-activedescendant): the tree is.
  await nav.nativeTree().focus();
  await expect.poll(async () => (await focused(nav)).role).toBe("tree");

  await setInAnotherWindow(nav, false);

  await expect(nav.viewToggle()).toBeVisible();
  await expect(
    nav.panel.getByRole("button", { name: "Refresh native tree" }),
  ).toHaveCount(0);
  // Focus is on the tree that replaced it, not the page body.
  await expect
    .poll(async () => (await focused(nav)).label)
    .toMatch(/^Semantic tree/);
});

test("turned off in another window, focus on the choice of tree stays in Settings", async ({
  nav,
}) => {
  await freshPanel(nav);
  await expect(nav.nativeTree()).toBeVisible({ timeout: 20_000 });
  await nav.panel.getByRole("button", { name: "Settings ▾" }).click();
  await nav.treeChoice("In-page tree").focus();
  await expect
    .poll(() =>
      nav.panel.evaluate(() => document.activeElement?.textContent?.trim()),
    )
    .toBe("In-page tree");

  await setInAnotherWindow(nav, false);

  await expect(nav.treeChoice("In-page tree")).toHaveCount(0);
  // On the switch above it, in Settings, which stays open.
  await expect.poll(async () => (await focused(nav)).type).toBe("checkbox");
});

test("turned off in another window, a native edit box closes", async ({
  nav,
}) => {
  const { page } = await freshPanel(nav);
  // The native tree, not the DOM one behind it: both have Expand all.
  await expect(
    nav.panel.getByRole("button", { name: "Refresh native tree" }),
  ).toBeVisible({ timeout: 20_000 });
  await nav.panel.getByRole("button", { name: "Expand all" }).click();
  const pwRow = nav.panel.getByRole("treeitem", { name: "Password" });
  await pwRow.getByTitle("Type (Enter)").click();
  const field = nav.panel.locator(".sn-input-panel-field");
  await expect(field).toBeVisible();

  await setInAnotherWindow(nav, false);

  // It acts through native mode, which is off now: left open, what was
  // typed into it would go nowhere.
  await expect(field).toHaveCount(0);
  await expect(nav.viewToggle()).toBeVisible();
  await expect
    .poll(async () => (await focused(nav)).label)
    .toMatch(/^Semantic tree/);
  await expect(page.locator("#pw")).toHaveValue("hunter2");
});
