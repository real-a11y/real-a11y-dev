/**
 * Production side-panel coverage for the native producer's OWN UI —
 * `NativeTreeView.tsx` and `App.tsx`'s `handleNativeActivate` — which no
 * other e2e suite touches: everything else in `e2e/` drives either the
 * message channel directly or the dev-only `DogfoodPanel` widget
 * (`panel-ui.test.ts`), never the production tree the toolbar's NATIVE
 * toggle switches to.
 *
 * Every test here pins a real bug a review round (or a user's own
 * hands-on pass) caught that no test would have — proof this gap was worth
 * closing rather than assumed:
 *
 *  - `useVirtualTree`'s `containerRef` went unwired in `NativeTreeView.tsx`,
 *    which silently capped the rendered tree at the hook's fixed ~10-row
 *    fallback window and made `scrollToIndex` a permanent no-op. A page with
 *    more real nodes than that just lost everything past the tenth, with no
 *    error anywhere.
 *  - A native field whose value is redacted opened `InputPanel` with no
 *    `inputType` set, so a retyped replacement for a password field rendered
 *    in plaintext — masking only ever applied to the DOM producer's own
 *    password fields before this.
 *  - Activating a link through the native tree left the panel on a blank
 *    tree after the navigation it caused: `dispatchNativeAction`'s own
 *    post-action re-read got cancelled by the very `PAGE_NAVIGATED` its
 *    click triggered, and nothing else was scheduled to pick it back up —
 *    see `recoverFromOwnNavigation`'s own comment in `App.tsx` for why
 *    re-reading here does NOT reopen the tab-switch anti-silent-reattach
 *    hole `hasAutoLoadedNative` exists to close.
 *  - The fix for the bug above only covered a single navigation: a link
 *    landing on a page that itself client-redirects onward (a login page
 *    landing on a dashboard) fires a SECOND `PAGE_NAVIGATED`, which
 *    unconditionally clears the tree again and either lands the one-shot
 *    recovery read on the intermediate document or gets that read's result
 *    silently discarded by `loadNativeTreeCore`'s own staleness check —
 *    caught by an external review round, not this suite, before this test
 *    was added to close the gap. `recoverFromOwnNavigation` now waits out a
 *    settle window and re-checks, looping (bounded by
 *    `MAX_NAV_RECOVERY_HOPS`) until a full settle window passes with no
 *    further navigation.
 *  - Native rows had no `onDblClick` at all (the DOM tree's own row does),
 *    so double-clicking a native row silently did nothing where the DOM
 *    producer would activate it.
 *  - A mouse click on a native row never moved real DOM focus onto `.sn-tree`
 *    (only `aria-activedescendant` updated), so the selected row's
 *    `:focus-visible` outline — keyed off the *container's* focus state —
 *    never appeared. The DOM tree's own `handleSelect` calls
 *    `treeRef.current?.focus()` after selecting; `NativeTreeView`'s row
 *    `onClick` never did.
 */

import { expect, test, type NativeHarness } from "./harness";

type PanelPage = import("@playwright/test").Page;

/**
 * Bring a fixture to the foreground, switch the panel to NATIVE, and wait
 * for its auto-load to land at least one row.
 *
 * Mirrors `panel-ui.test.ts`'s own `show()`: reload the panel first so every
 * test starts from a clean mount, and bring the fixture to the foreground
 * BEFORE that reload — `myTabId` resolves off `chrome.tabs.query({active:
 * true, currentWindow: true})`, so the ordering matters exactly as it does
 * there.
 */
async function showNative(
  nav: NativeHarness,
  fixture: string,
): Promise<PanelPage> {
  const { page } = await nav.open(fixture);
  await page.bringToFront();
  await nav.panel.reload();

  // The NATIVE toggle lives past App.tsx's `!connected` early return, so
  // waiting for it to appear is waiting for the DOM producer's own
  // auto-connect — the toggle cannot render before that regardless of native
  // mode itself.
  const nativeToggle = nav.panel.getByRole("button", {
    name: "NATIVE",
    exact: true,
  });
  await expect(nativeToggle).toBeVisible({ timeout: 20_000 });
  await nativeToggle.click();

  // Auto-load fires once `producer` becomes "native" (hasAutoLoadedNative) —
  // no refresh click needed, just the read to land.
  await expect
    .poll(() => nav.panel.locator(".sn-node").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);

  return page;
}

test("a row past the virtualization window is reachable and actionable", async ({
  nav,
}) => {
  const page = await showNative(nav, "native-panel.html");

  // The 16 buttons are nested one level under the fixture's own section, not
  // the tree's root, so they need this regardless of how deep the view's
  // own default-expand seeding goes. A plain mouse click, deliberately never
  // a keyboard press: focusing the tree via `.press()` lets the *browser's*
  // own default "scroll the focused element into view" fire a real `scroll`
  // event on `.sn-tree-container`, which self-heals `useVirtualTree`'s
  // `viewportHeight` through the (always-correctly-wired) `onScroll` handler
  // regardless of whether `containerRef` itself is wired — that masked this
  // exact bug in manual testing once already, so this test earns its keep
  // only by not repeating that mistake. A click on a button outside the
  // scrollable container triggers no such scroll.
  await nav.panel.getByRole("button", { name: "Expand all" }).click();

  const lastRow = nav.panel.getByRole("treeitem", { name: "Item 16" });
  // With the containerRef bug back, `viewportHeight` never leaves its
  // initial 0 (nothing ever calls `updateViewport`), which caps the render
  // window at `useVirtualTree`'s fixed ~10-row fallback regardless of the
  // 21 real nodes Expand All just revealed — this row sits past it. A
  // correctly wired ref measures the real viewport on mount, before any
  // interaction, so this needs no scroll or selection to already be true.
  await expect(lastRow).toBeVisible();

  await lastRow.getByTitle("Click (Enter)").click();
  await expect(page.locator("#item-16")).toHaveAttribute(
    "data-clicked",
    "true",
  );
});

test("a redacted field's retype panel never shows the real value, and masks it", async ({
  nav,
}) => {
  const page = await showNative(nav, "native-panel.html");
  await nav.panel.getByRole("button", { name: "Expand all" }).click();

  const pwRow = nav.panel.getByRole("treeitem", { name: "Password" });
  await expect(pwRow).toContainText("[redacted]");
  await expect(pwRow).not.toContainText("hunter2");

  const field = nav.panel.locator(".sn-input-panel-field");

  await pwRow.getByTitle("Type (Enter)").click();
  await expect(field).toHaveValue("");
  await expect(field).toHaveAttribute("type", "password");

  // Submitting unedited is a no-op (R1: never blank a live value the user
  // never touched) — the panel still closes, but the real field is
  // untouched.
  await field.press("Enter");
  await expect(field).toHaveCount(0);
  await expect(page.locator("#pw")).toHaveValue("hunter2");

  // A real edit dispatches normally, masked the whole way through.
  await pwRow.getByTitle("Type (Enter)").click();
  await expect(field).toHaveValue("");
  await expect(field).toHaveAttribute("type", "password");
  await field.fill("newpass456");
  await field.press("Enter");
  await expect(page.locator("#pw")).toHaveValue("newpass456");

  // The post-dispatch re-read still redacts — the sentinel is not a
  // load-time special case a refresh can bypass.
  await nav.panel.getByRole("button", { name: "Refresh native tree" }).click();
  await expect(pwRow).toContainText("[redacted]");
  await expect(pwRow).not.toContainText("newpass456");
});

test("activating a link through the native tree re-reads the page it navigated to", async ({
  nav,
}) => {
  const page = await showNative(nav, "native-nav-link.html");

  const linkRow = nav.panel.getByRole("treeitem", { name: "Go to tree view" });
  await expect(linkRow).toBeVisible();
  await linkRow.getByTitle("Click (Enter)").click();

  // The click is a real, un-prevented <a href> — the tab actually
  // navigates, same as a user following any other link.
  await page.waitForURL(/tree-view\.html/);

  // No "Refresh native tree" click anywhere in this test — that omission is
  // the assertion. Without the fix, `dispatchNativeAction`'s own scheduled
  // re-read gets cancelled by the very PAGE_NAVIGATED its click causes, and
  // nothing else fires one (hasAutoLoadedNative is deliberately never reset
  // by a navigation, for the unrelated tab-switch case), so the tree would
  // sit empty here. tree-view.html's own <h1> — a node that only exists on
  // the NEW page, and a root-level one that needs no "Expand all" first —
  // is proof this is a genuine fresh read, not a stale tree that happened
  // to still render something.
  await expect(
    nav.panel.getByRole("treeitem", { name: "Tree View" }),
  ).toBeVisible({ timeout: 10_000 });
});

test("activating a link that redirects onward still recovers on the final page", async ({
  nav,
}) => {
  const page = await showNative(nav, "native-nav-redirect.html");

  const linkRow = nav.panel.getByRole("treeitem", { name: "Go via redirect" });
  await expect(linkRow).toBeVisible();
  await linkRow.getByTitle("Click (Enter)").click();

  // Two navigations happen here, not one: the click lands on
  // native-nav-redirect-mid.html, which itself client-redirects to
  // tree-view.html before a human would ever see it — a login page landing
  // on a dashboard, a tracking link resolving to its destination. Each hop
  // fires its own PAGE_NAVIGATED.
  await page.waitForURL(/tree-view\.html/);

  // Without the settle-loop, a one-shot recovery reads the FIRST document
  // (or has its read of it discarded by the second PAGE_NAVIGATED) and never
  // gets a second attempt — the tree sits empty, or shows the intermediate
  // page's own "Redirecting…" heading instead of the final page's. Waiting
  // for tree-view.html's own root-level <h1> is proof this is the final
  // document, not the intermediate one.
  await expect(
    nav.panel.getByRole("treeitem", { name: "Tree View" }),
  ).toBeVisible({ timeout: 10_000 });
});

test("a busy region shows a bare busy badge, not busy=1", async ({ nav }) => {
  await showNative(nav, "native-busy.html");

  // Chromium sends `aria-busy="true"` as `{"type":"boolean","value":1}`.
  // Read as text, the row's badge said `busy=1`; the DOM tree says `busy`.
  const badges = nav.panel
    .getByRole("treeitem", { name: "Results" })
    .locator(".sn-state-badge");
  await expect(badges).toHaveText(["busy"]);
});

test("double-clicking a row activates it, same as the DOM tree's own row", async ({
  nav,
}) => {
  const page = await showNative(nav, "native-panel.html");
  await nav.panel.getByRole("button", { name: "Expand all" }).click();

  const lastRow = nav.panel.getByRole("treeitem", { name: "Item 16" });
  await expect(lastRow).toBeVisible();

  // The row body, not its "Click (Enter)" action button — a plain
  // double-click anywhere on the row is what the DOM tree's own row
  // already honors (App.tsx's `onDblClick`).
  await lastRow.dblclick({ position: { x: 5, y: 5 } });
  await expect(page.locator("#item-16")).toHaveAttribute(
    "data-clicked",
    "true",
  );
});

test("clicking a row gives the tree its own focus-visible outline", async ({
  nav,
}) => {
  await showNative(nav, "native-panel.html");
  await nav.panel.getByRole("button", { name: "Expand all" }).click();

  const row = nav.panel.getByRole("treeitem", { name: "Item 16" });
  await expect(row).toBeVisible();
  await row.click({ position: { x: 5, y: 5 } });

  // `.sn-tree:focus-visible .sn-node--selected` is the only thing that
  // paints the outline — real DOM focus has to land on the container for
  // it to ever apply.
  await expect(nav.panel.locator(".sn-tree")).toBeFocused();
});

// ---- Native as the default view ----
//
// The harness turns native mode on before any test runs, as if the user had
// opted in during an earlier session: the case where the panel opens on the
// native tree by itself. None of these tests click NATIVE.

/** Bring a fixture forward and remount the panel, which then defaults to the
 *  native tree on its own. */
async function showNativeByDefault(
  nav: NativeHarness,
  fixture: string,
): Promise<PanelPage> {
  const { page } = await nav.open(fixture);
  await page.bringToFront();
  await nav.panel.reload();
  await expect
    .poll(() => nav.panel.locator(".sn-node").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await expect(
    nav.panel.getByRole("button", { name: "NATIVE", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  return page;
}

/** How long a test waits for a read that should NOT be sent. The panel sends
 *  NATIVE_READ from an effect within milliseconds of the trigger, and these
 *  tests count messages sent, not reads finished, so the attach's own speed
 *  doesn't matter here. */
const NO_READ_WINDOW_MS = 1_500;

test("native mode defaults to the native producer on first connect, with no click", async ({
  nav,
}) => {
  await showNativeByDefault(nav, "native-panel.html");
  // native-panel.html's own rows, so this is the native producer's tree.
  await nav.panel.getByRole("button", { name: "Expand all" }).click();
  // Anchored, so it doesn't also match "Item 10".."Item 16".
  await expect(
    nav.panel.getByRole("treeitem", { name: /^button "Item 1" focusable/ }),
  ).toBeVisible();
  expect(await nav.nativeReads()).toHaveLength(1);
});

test("switching tabs after the default sends no read for the new tab", async ({
  nav,
}) => {
  await showNativeByDefault(nav, "native-panel.html");
  const second = await nav.open("tree-view.html");
  await second.page.bringToFront();

  // The switch clears the old tab's tree, and must not attach to the new one
  // without a gesture.
  await expect
    .poll(() => nav.panel.locator(".sn-node").count(), { timeout: 5_000 })
    .toBe(0);
  await nav.panel.waitForTimeout(NO_READ_WINDOW_MS);
  expect(await nav.nativeReads()).toHaveLength(1);

  // The producer stays NATIVE, and Refresh reads normally.
  await expect(
    nav.panel.getByRole("button", { name: "NATIVE", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await nav.panel.getByRole("button", { name: "Refresh native tree" }).click();
  await expect
    .poll(() => nav.panel.locator(".sn-node").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
  expect(await nav.nativeReads()).toHaveLength(2);
});

test("a default that can't read the page falls back to DOM, says why, and doesn't retry that tab", async ({
  nav,
}) => {
  await nav.setNativeReads("fail");
  const { page } = await nav.open("native-panel.html");
  await page.bringToFront();
  await nav.panel.reload();

  await expect(
    nav.panel.getByText(/Native mode: showing the DOM tree — .*DevTools/),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    nav.panel.getByRole("button", { name: "DOM", exact: true }).first(),
  ).toHaveAttribute("aria-pressed", "true");
  // One attempt, and no more for this tab: each retry would attach again.
  await nav.panel.waitForTimeout(NO_READ_WINDOW_MS);
  expect(await nav.nativeReads()).toHaveLength(1);
});

test("Disable while the default's read is in flight leaves the panel on DOM", async ({
  nav,
}) => {
  await nav.setNativeReads("delay:2000");
  const { page } = await nav.open("native-panel.html");
  await page.bringToFront();
  await nav.panel.reload();
  await expect(
    nav.panel.getByRole("button", { name: "NATIVE", exact: true }),
  ).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
  expect(await nav.nativeReads()).toHaveLength(1);

  await nav.panel.getByRole("button", { name: "Disable native mode" }).click();
  const enableEntry = nav.panel.getByRole("button", {
    name: "Enable native mode…",
  });
  await expect(enableEntry).toBeVisible();
  // The delayed reply lands after the disable; it must not bring the native
  // tree back or flip the view.
  await nav.panel.waitForTimeout(2_500);
  await expect(enableEntry).toBeVisible();
  await expect(
    nav.panel.getByRole("button", { name: "Refresh native tree" }),
  ).toHaveCount(0);

  // This worker's other tests expect native mode on.
  await nav.panel.evaluate(() =>
    chrome.storage.local.set({ "settings.nativeModeEnabled": true }),
  );
});

// ---- Copy/export for the native tree ----
//
// `doExport` previously only knew the DOM producer's `nodes` state — the
// `Copy ▾` menu was hidden entirely under `producer === "dom"`. Stubs
// `navigator.clipboard.writeText` rather than relying on the real OS
// clipboard (the app itself already treats a real write as unreliable in an
// automated context — see the "Clipboard blocked" fallback message in
// `App.tsx`), same rationale as the sendMessage stub above: intercept before
// the unreliable browser API is ever reached.
async function stubClipboard(nav: NativeHarness): Promise<void> {
  await nav.panel.evaluate(() => {
    (window as typeof window & { __copiedText?: string }).__copiedText =
      undefined;
    navigator.clipboard.writeText = ((text: string) => {
      (window as typeof window & { __copiedText?: string }).__copiedText = text;
      return Promise.resolve();
    }) as typeof navigator.clipboard.writeText;
  });
}

async function readClipboardStub(
  nav: NativeHarness,
): Promise<string | undefined> {
  return nav.panel.evaluate(
    () => (window as typeof window & { __copiedText?: string }).__copiedText,
  );
}

test("Copy on the native tree offers no Tab sequence — native has no tab-order data", async ({
  nav,
}) => {
  await showNative(nav, "native-panel.html");

  // The button's accessible name is its text content ("Copy ▾"), not its
  // `title` — accname prefers content over title, so a `title`-shaped
  // locator here never resolves.
  await nav.panel.getByRole("button", { name: "Copy ▾" }).click();
  const menu = nav.panel.locator(".sn-export-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("button", { name: "Native tree" })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Headings" })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Tab sequence" })).toHaveCount(
    0,
  );
});

/** Open the export fixture on the native tree and copy one Copy ▾ item. */
async function copyNative(nav: NativeHarness, item: string): Promise<string> {
  const page = await showNative(nav, "native-export.html");
  await stubClipboard(nav);
  await nav.panel.getByRole("button", { name: "Copy ▾" }).click();
  await nav.panel
    .locator(".sn-export-menu")
    .getByRole("button", { name: item })
    .click();
  await expect.poll(() => readClipboardStub(nav)).toBeDefined();
  const markdown = (await readClipboardStub(nav))!;

  // Every item says which producer built it, and where it was read from:
  // the native read's own page, not the DOM producer's.
  expect(markdown).toContain(
    "**Producer:** native (Chromium's own accessibility tree)",
  );
  expect(markdown).toMatch(
    /^# Accessibility report — (Native export fixture|http:\/\/127\.0\.0\.1)/,
  );
  expect(markdown).toContain(`**URL:** ${page.url()}`);
  // A field's value never reaches a copied report, redacted or not.
  expect(markdown).not.toContain("hunter2");
  expect(markdown).not.toContain("[redacted]");
  expect(markdown).not.toContain("## Tab sequence");
  return markdown;
}

test("Copy → Everything copies the native tree and its headings", async ({
  nav,
}) => {
  const markdown = await copyNative(nav, "Everything");
  expect(markdown).toContain("## Native accessibility tree");
  expect(markdown).toContain("## Heading outline");
  expect(markdown).toContain("h1 Native export fixture");
  expect(markdown).toMatch(/button "Sign in"/);
  // A named generic group survives into the report (`includeGeneric: true`).
  expect(markdown).toMatch(/generic "Sign-in group"/);
});

test("Copy → Native tree copies the tree alone", async ({ nav }) => {
  const markdown = await copyNative(nav, "Native tree");
  expect(markdown).toContain("## Native accessibility tree");
  expect(markdown).not.toContain("## Heading outline");
  expect(markdown).toMatch(/textbox "Password"/);
  expect(markdown).toMatch(/generic "Sign-in group"/);
});

test("Copy → Headings copies the outline alone, still marked native", async ({
  nav,
}) => {
  const markdown = await copyNative(nav, "Headings");
  expect(markdown).toContain("## Heading outline");
  expect(markdown).not.toContain("## Native accessibility tree");
  expect(markdown).toContain("h1 Native export fixture");
  expect(markdown).toContain("h2 Sign in");
});
