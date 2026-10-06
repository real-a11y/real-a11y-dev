/**
 * Turning native mode on and off, on the store build (`dist/`), from a fresh
 * profile where it has never been enabled.
 *
 * These are the first things a store user meets, and the only suite that runs
 * the build the listing ships: the manifest it asks Chrome for, the absence of
 * the dogfood-only diagnostics, and the consent → Enable → Disable round trip.
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

/** Open a fixture, bind the panel to it, and start from native mode off. */
async function freshPanel(nav: NativeHarness) {
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

test("a fresh profile offers Enable and no NATIVE toggle", async ({ nav }) => {
  const { enableEntry } = await freshPanel(nav);
  await expect(enableEntry).toHaveAttribute("aria-haspopup", "dialog");
  await expect(enableEntry).toHaveAttribute("aria-expanded", "false");
  await expect(
    nav.panel.getByRole("group", { name: "Tree producer" }),
  ).toHaveCount(0);
  await expect(nav.panel.locator(".sn-native-tree")).toHaveCount(0);
});

test("accepting the consent step turns native on, moves focus to NATIVE and reads the tree", async ({
  nav,
}) => {
  const { enableEntry } = await freshPanel(nav);
  await enableEntry.click();
  await expect(enableEntry).toHaveAttribute("aria-expanded", "true");
  const banner = nav.panel.getByRole("dialog", { name: "Enable native mode" });
  await expect(banner).toContainText("started debugging this browser");
  await banner.getByRole("button", { name: "Enable" }).click();

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
  const { enableEntry } = await freshPanel(nav);
  await enableEntry.click();
  await nav.panel
    .getByRole("dialog", { name: "Enable native mode" })
    .getByRole("button", { name: "Enable" })
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
  // Back on the DOM tree, which this view always has.
  await expect(nav.panel.locator(".sn-native-tree")).toHaveCount(0);
  expect(
    await nav.panel.evaluate(() =>
      chrome.storage.local
        .get("settings.nativeModeEnabled")
        .then((r) => r["settings.nativeModeEnabled"]),
    ),
  ).toBe(false);
});

test("a failed Enable attempt surfaces its error inline and never flips the setting", async ({
  nav,
}) => {
  const { enableEntry } = await freshPanel(nav);

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
  const banner = nav.panel.getByRole("dialog", { name: "Enable native mode" });
  await banner.getByRole("button", { name: "Enable" }).click();

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
