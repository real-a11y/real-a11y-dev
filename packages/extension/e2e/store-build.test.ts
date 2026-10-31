/**
 * The store build (`dist/`), as a store user meets it: a fresh profile's first
 * page read through Chrome with nothing asked first, the one-time note about
 * Chrome's debugging bar, Settings, and a profile an older version left with
 * native mode turned off, which gets Chrome's tree now too.
 *
 * The only suite that runs the build the listing ships: the manifest it asks
 * Chrome for, and the absence of the dogfood-only diagnostics.
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

/** Open a fixture, bind the panel to it, and start with `stored` in place of
 *  whatever the settings were: by default, a profile that never touched
 *  Settings and never saw the note, the store build out of the box. */
async function freshPanel(
  nav: NativeHarness,
  stored: Record<string, unknown> = {},
) {
  const opened = await nav.open("native-panel.html");
  await opened.page.bringToFront();
  await nav.panel.evaluate(async (items) => {
    await chrome.storage.local.remove([
      "settings.nativeModeEnabled",
      "settings.nativeNoticeSeen",
      "settings.showFullNames",
    ]);
    await chrome.storage.local.set(items);
  }, stored);
  await nav.panel.reload();
  return opened;
}

const storedSetting = (nav: NativeHarness, key: string) =>
  nav.panel.evaluate((k) => chrome.storage.local.get(k).then((r) => r[k]), key);

const note = (nav: NativeHarness) =>
  nav.panel.getByRole("note", { name: "About Chrome's debugging bar" });

/** What has focus in the panel. Read from the panel itself: the fixture page
 *  has the window's focus, so Playwright's own focus check reports none. */
const focused = (nav: NativeHarness) =>
  nav.panel.evaluate(() => ({
    role: document.activeElement?.getAttribute("role") ?? null,
    label: document.activeElement?.getAttribute("aria-label") ?? "",
  }));

test("a fresh profile's first page is read through Chrome, and a note explains Chrome's bar", async ({
  nav,
}) => {
  await freshPanel(nav);

  await expect(nav.nativeTree()).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(async () => (await nav.nativeReads()).length, { timeout: 20_000 })
    .toBe(1);
  await expect(note(nav)).toContainText("started debugging this browser");
  // Acknowledging it is all there is to do: there is no other tree.
  await expect(note(nav).getByRole("button")).toHaveText(["Got it"]);
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

test("a profile an older version left with native mode off gets Chrome's tree", async ({
  nav,
}) => {
  // Up to 0.1.17, Settings could turn native mode off, and the panel then
  // showed the in-page tree. That tree is gone, and what was stored for it
  // no longer counts.
  await freshPanel(nav, {
    "settings.nativeModeEnabled": false,
    "settings.nativeNoticeSeen": true,
  });

  await expect(nav.nativeTree()).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(async () => (await nav.nativeReads()).length, { timeout: 20_000 })
    .toBe(1);
  await expect(
    nav.panel.getByRole("group", { name: "Tree view mode" }),
  ).toHaveCount(0);
});

test("Settings holds Show full names alone, and stays on screen in a narrow side panel", async ({
  nav,
}) => {
  await freshPanel(nav, { "settings.nativeNoticeSeen": true });
  await expect(nav.nativeTree()).toBeVisible({ timeout: 20_000 });
  const size = nav.panel.viewportSize();
  await nav.panel.setViewportSize({ width: 320, height: size?.height ?? 720 });
  try {
    const settings = nav.panel.getByRole("button", { name: "Settings ▾" });
    await expect(settings).toBeInViewport({ ratio: 1 });
    await settings.click();
    const group = nav.panel.getByRole("group", { name: "Settings" });
    await expect(group.getByRole("checkbox")).toHaveCount(1);
    await expect(
      group.getByRole("checkbox", { name: "Show full names" }),
    ).toBeInViewport({ ratio: 1 });
    // No choice of tree, nor a switch for reading through Chrome.
    await expect(group.getByRole("button")).toHaveCount(0);
  } finally {
    if (size) await nav.panel.setViewportSize(size);
  }
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

test("the store build runs its content script in a page's blank frames, and asks for nothing more to do it", async ({
  nav,
}) => {
  const manifest = await nav.panel.evaluate(() => chrome.runtime.getManifest());
  // Which frames get the script: every frame of a page, and with
  // `match_about_blank` its `about:blank` and `srcdoc` frames. Not
  // `match_origin_as_fallback`, which would add sandboxed, `data:` and
  // `blob:` frames, none of which either tree could place.
  expect(manifest.content_scripts).toEqual([
    {
      matches: ["<all_urls>"],
      js: ["content.js"],
      run_at: "document_idle",
      all_frames: true,
      match_about_blank: true,
    },
  ]);
  // What the extension may access is as it was. A permission added here is
  // one every user is asked to accept again on the update that carries it.
  expect([...(manifest.permissions ?? [])].sort()).toEqual([
    "activeTab",
    "debugger",
    "sidePanel",
    "storage",
    "tabs",
    "webNavigation",
  ]);
  expect(manifest.host_permissions ?? []).toEqual([]);
  expect(manifest.optional_permissions ?? []).toEqual([]);
});
