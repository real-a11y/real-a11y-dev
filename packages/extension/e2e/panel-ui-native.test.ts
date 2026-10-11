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

import { NATIVE_FOLLOW_DEBOUNCE_MS } from "../src/sidepanel/native-follow.ts";

import {
  expect,
  overlayCovers,
  overlayRect,
  test,
  type NativeHarness,
} from "./harness";

type PanelPage = import("@playwright/test").Page;

test("a row past the virtualization window is reachable and actionable", async ({
  nav,
}) => {
  const page = await nav.showNative("native-panel.html");

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
  const page = await nav.showNative("native-panel.html");
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
  const page = await nav.showNative("native-nav-link.html");

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
  const page = await nav.showNative("native-nav-redirect.html");

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
  await nav.showNative("native-busy.html");

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
  const page = await nav.showNative("native-panel.html");
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
  await nav.showNative("native-panel.html");
  await nav.panel.getByRole("button", { name: "Expand all" }).click();

  const row = nav.panel.getByRole("treeitem", { name: "Item 16" });
  await expect(row).toBeVisible();
  await row.click({ position: { x: 5, y: 5 } });

  // `.sn-tree:focus-visible .sn-node--selected` is the only thing that
  // paints the outline — real DOM focus has to land on the container for
  // it to ever apply.
  await expect(nav.panel.locator(".sn-tree")).toBeFocused();
});

test("selecting a native tree row highlights and focuses the page's own element", async ({
  nav,
}) => {
  // Both halves: the content script's outline lands on the element, scrolled
  // into view (the part the user sees, since focus alone paints no ring while
  // the panel has window focus), and real focus follows so keyboard use
  // resumes there.
  const page = await nav.showNative("native-panel.html");
  await nav.panel.getByRole("button", { name: "Expand all" }).click();

  const row = nav.panel.getByRole("treeitem", { name: "Item 16" });
  await expect(row).toBeVisible();
  await row.click({ position: { x: 5, y: 5 } });

  // Debounced (150ms) on the panel side, then a real chrome.debugger
  // attach→resolve→reveal→detach round trip — poll rather than assert once.
  await expect
    .poll(() => overlayCovers(page, "#item-16", { inView: true }), {
      timeout: 5_000,
    })
    .toBe(true);

  await expect
    .poll(() => page.evaluate(() => document.activeElement?.id), {
      timeout: 5_000,
    })
    .toBe("item-16");
});

test("selecting a native heading row highlights it even though it can't take focus", async ({
  nav,
}) => {
  const page = await nav.showNative("native-panel.html");
  await nav.panel.getByRole("button", { name: "Expand all" }).click();

  const row = nav.panel.getByRole("treeitem", {
    name: /Native panel fixture/,
  });
  await expect(row).toBeVisible();
  await row.click({ position: { x: 5, y: 5 } });

  await expect
    .poll(() => overlayCovers(page, "h1", { inView: true }), { timeout: 5_000 })
    .toBe(true);
});

test("clicking an item in a role-filter list highlights and focuses it on the page too", async ({
  nav,
}) => {
  // A role-filter list keeps its own selection, so it follows onto the page
  // through its own hook.
  const page = await nav.showNative("native-panel.html");

  await nav.panel
    .getByRole("button", { name: "Headings", exact: true })
    .click();
  await nav.panel.getByRole("option", { name: /Sensitive field/ }).click();
  await expect
    .poll(() => overlayCovers(page, "h2", { inView: true }), { timeout: 5_000 })
    .toBe(true);

  // A focusable item under another filter: the overlay moves AND real focus
  // lands on it, same as selecting its tree row.
  await nav.panel.getByRole("button", { name: "Buttons", exact: true }).click();
  await nav.panel.getByRole("option", { name: "Item 16" }).click();
  await expect
    .poll(() => overlayCovers(page, "#item-16", { inView: true }), {
      timeout: 5_000,
    })
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.id), {
      timeout: 5_000,
    })
    .toBe("item-16");
});

/** Every element on `page` that takes focus from now on, by id. */
async function recordFocus(page: PanelPage): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const w = window as typeof window & { __focused?: string[] };
    w.__focused = [];
    document.addEventListener(
      "focusin",
      (e) => w.__focused!.push((e.target as Element).id),
      true,
    );
  });
  return () =>
    page.evaluate(
      () =>
        (window as typeof window & { __focused?: string[] }).__focused ?? [],
    );
}

test("selecting a native tree row via the keyboard only focuses the row the selection settles on", async ({
  nav,
}) => {
  // A key-repeat burst walks the selection through several rows; only the
  // row it settles on is revealed, so page focus never trails behind on an
  // intermediate one.
  const page = await nav.showNative("native-panel.html");
  await nav.panel.getByRole("button", { name: "Expand all" }).click();
  const focused = await recordFocus(page);

  // "Item 2", not "Item 1", which also matches "Item 10".."Item 16".
  const start = nav.panel.getByRole("treeitem", { name: "Item 2" });
  await expect(start).toBeVisible();
  await start.click({ position: { x: 5, y: 5 } });
  await nav.panel.locator(".sn-tree").press("ArrowDown");
  await nav.panel.locator(".sn-tree").press("ArrowDown");
  await nav.panel.locator(".sn-tree").press("ArrowDown");

  await expect.poll(focused, { timeout: 5_000 }).toContain("item-5");
  expect(await focused()).toEqual(["item-5"]);
  expect(
    (await nav.nativeActs()).filter((a) => a.action === "reveal"),
  ).toHaveLength(1);
});

test("selecting a native tree row never reveals it while Screen Curtain is on", async ({
  nav,
}) => {
  // The page is hidden behind the curtain, and moving focus on it would still
  // scroll it underneath, so nothing is sent while the curtain is up.
  const page = await nav.showNative("native-panel.html");
  await nav.panel.getByRole("button", { name: "Expand all" }).click();
  const curtain = nav.panel.getByRole("button", {
    name: "Curtain",
    exact: true,
  });
  await curtain.click();

  await nav.panel
    .getByRole("treeitem", { name: "Item 16" })
    .click({ position: { x: 5, y: 5 } });
  // Then lift the curtain and select another row: its reveal is the first
  // one sent, so the curtained selection never sent one.
  await nav.panel.getByRole("button", { name: "Curtain ON" }).click();
  await nav.panel
    .getByRole("treeitem", { name: "Item 15" })
    .click({ position: { x: 5, y: 5 } });
  await expect
    .poll(async () =>
      (await nav.nativeActs())
        .filter((a) => a.action === "reveal")
        .map((a) => a.nodeId),
    )
    .toHaveLength(1);
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.id))
    .toBe("item-15");
});

test("a reveal the user has already moved past never attaches", async ({
  nav,
}) => {
  // An armed pick holds the tab's queue, so these reveals wait behind it.
  // When it ends, only the newest is still wanted; the others are dropped
  // before they attach.
  const page = await nav.showNative("native-panel.html");
  await nav.panel.getByRole("button", { name: "Expand all" }).click();
  await armPick(nav);
  for (const name of ["Item 14", "Item 15", "Item 16"]) {
    await nav.panel
      .getByRole("treeitem", { name })
      .click({ position: { x: 5, y: 5 } });
    await nav.panel.waitForTimeout(NATIVE_FOLLOW_DEBOUNCE_MS * 2);
  }
  await nav.panel.keyboard.press("Escape");

  await expect
    .poll(async () =>
      (await nav.nativeActs())
        .filter((a) => a.action === "reveal" && a.answer !== undefined)
        .map((a) => (a.answer as { error?: string }).error ?? "revealed"),
    )
    .toEqual(["superseded", "superseded", "revealed"]);
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.id))
    .toBe("item-16");
});

test("a reveal event the page fires itself draws nothing", async ({ nav }) => {
  const page = await nav.showNative("native-panel.html");
  await page.evaluate(() =>
    document.getElementById("item-16")!.dispatchEvent(
      new CustomEvent("real-a11y:native-reveal", {
        bubbles: true,
        composed: true,
        detail: "forged",
      }),
    ),
  );
  expect(await overlayRect(page)).toBeNull();
});

test("a same-page URL change doesn't stop the selection follow", async ({
  nav,
}) => {
  // The node ids are still good after pushState; the reveal no longer checks
  // the URL the tree was read at.
  const page = await nav.showNative("native-panel.html");
  await nav.panel.getByRole("button", { name: "Expand all" }).click();
  await page.evaluate(() => history.pushState({}, "", "#section"));
  await nav.panel
    .getByRole("treeitem", { name: "Item 16" })
    .click({ position: { x: 5, y: 5 } });
  await expect
    .poll(() => overlayCovers(page, "#item-16", { inView: true }), {
      timeout: 5_000,
    })
    .toBe(true);
});

// ---- Native as the default view ----
//
// Native mode is on out of the box, and the harness leaves it that way: the
// case where the panel opens on the native tree by itself. None of these
// tests click NATIVE.

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
  await expect(nav.nativeTree()).toBeVisible();
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

  // The panel stays on Chrome's tree, and Refresh reads normally.
  await expect(nav.viewToggle()).toHaveCount(0);
  await nav.panel.getByRole("button", { name: "Refresh native tree" }).click();
  await expect
    .poll(() => nav.panel.locator(".sn-node").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
  expect(await nav.nativeReads()).toHaveLength(2);
});

test("a default that can't read the page falls back to the in-page tree, says why, and doesn't retry that tab", async ({
  nav,
}) => {
  await nav.setNativeReads("fail");
  const { page } = await nav.open("native-panel.html");
  await page.bringToFront();
  await nav.panel.reload();

  await expect(
    nav.panel.getByText(/Native mode: showing the in-page tree — .*DevTools/),
  ).toBeVisible({ timeout: 20_000 });
  await expect(nav.viewToggle()).toBeVisible();
  // One attempt, and no more for this tab: each retry would attach again.
  await nav.panel.waitForTimeout(NO_READ_WINDOW_MS);
  expect(await nav.nativeReads()).toHaveLength(1);
});

test("turning native mode off while the default's read is in flight leaves the panel on the in-page tree", async ({
  nav,
}) => {
  await nav.setNativeReads("delay:2000");
  const { page } = await nav.open("native-panel.html");
  await page.bringToFront();
  await nav.panel.reload();
  await nav.panel.getByRole("button", { name: "Settings ▾" }).click();
  const chromeTree = nav.treeChoice("Chrome's tree");
  await expect(chromeTree).toHaveAttribute("aria-pressed", "true", {
    timeout: 20_000,
  });
  expect(await nav.nativeReads()).toHaveLength(1);

  const setting = nav.panel.getByRole("checkbox", {
    name: "Read pages through Chrome (recommended)",
  });
  await setting.click();
  await expect(setting).not.toBeChecked();
  await expect(chromeTree).toHaveCount(0);
  // The delayed reply lands after the switch; it must not bring the native
  // tree back or flip the view.
  await nav.panel.waitForTimeout(2_500);
  await expect(chromeTree).toHaveCount(0);
  await expect(nav.viewToggle()).toBeVisible();
  await expect(
    nav.panel.getByRole("button", { name: "Refresh native tree" }),
  ).toHaveCount(0);

  // This worker's other tests expect native mode on, as it comes.
  await nav.panel.evaluate(() =>
    chrome.storage.local.remove("settings.nativeModeEnabled"),
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
  await nav.showNative("native-panel.html");

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
  const page = await nav.showNative("native-export.html");
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

// ---- Picker mode for the native tree ----
//
// The DOM producer's picker uses the content script's own capture-phase
// click handler — nothing a native tree has, since native mode never injects
// one. Native goes through `chrome.debugger`'s `Overlay.setInspectMode`
// instead (the exact primitive DevTools' own "inspect element" uses), armed
// for the whole pick session inside a SINGLE `withDebugger` span
// (`runPick` in debugger-session.ts). These tests drive it through a real
// page click — Playwright's own CDP input dispatch reaches the same
// Overlay-level hit-test a real mouse click would, so `Overlay.
// inspectNodeRequested` fires for real rather than being simulated at the
// message level.

/** Press Pick and wait until Chromium's inspect mode is on: the button is
 *  pressed at once, and busy until NATIVE_PICK_ARMED arrives. */
async function armPick(nav: NativeHarness) {
  const pickButton = nav.panel.getByRole("button", {
    name: "Pick element in page",
  });
  await pickButton.click();
  await expect(pickButton).toHaveAttribute("aria-pressed", "true");
  await expect(pickButton).toHaveAttribute("aria-busy", "false");
  return pickButton;
}

/** Count clicks that reach the page itself. A click while inspect mode is on
 *  is eaten as a pick; once it's off, a click reaches the page again. */
async function countPageClicks(
  page: PanelPage,
): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const w = window as typeof window & { __clicks?: number };
    w.__clicks = 0;
    document.addEventListener(
      "click",
      () => (w.__clicks = (w.__clicks ?? 0) + 1),
      true,
    );
  });
  return () =>
    page.evaluate(
      () => (window as typeof window & { __clicks?: number }).__clicks ?? 0,
    );
}

/** After a pick ended without picking: a page click reaches the page and
 *  selects nothing in the panel, so inspect mode really is off. */
async function expectInspectModeOff(nav: NativeHarness, page: PanelPage) {
  const clicks = await countPageClicks(page);
  await page.getByRole("heading", { name: "Native panel fixture" }).click();
  await expect.poll(clicks).toBe(1);
  await expect(nav.panel.locator("[aria-selected='true']")).toHaveCount(0);
}

test("picking an element on the page selects and reveals it in the native tree", async ({
  nav,
}) => {
  const page = await nav.showNative("native-panel.html");
  const pickButton = await armPick(nav);

  // The root-level <h1> — visible without "Expand all" (root + its immediate
  // children are seeded open by default), and distinct from the buttons
  // nested a level under "Items" so this can't accidentally pass by picking
  // whatever the tree already had selected.
  await page.getByRole("heading", { name: "Native panel fixture" }).click();

  // The click resolves the pick (NATIVE_PICK_RESULT), which turns the
  // button back off without any further panel interaction.
  await expect(pickButton).toHaveAttribute("aria-pressed", "false");

  const headingRow = nav.panel.getByRole("treeitem", {
    name: "Native panel fixture",
  });
  await expect(headingRow).toBeVisible();
  await expect(headingRow).toHaveAttribute("aria-selected", "true");
  // Same focus-visible wiring the click/dblclick tests above pin for an
  // ordinary row selection — the reveal effect calls the identical
  // `treeRef.current?.focus()`.
  await expect(nav.panel.locator(".sn-tree")).toBeFocused();
});

test("switching to the in-page tree and back doesn't apply an old pick again", async ({
  nav,
}) => {
  const page = await nav.showNative("native-panel.html");
  const pickButton = await armPick(nav);
  await page.getByRole("heading", { name: "Native panel fixture" }).click();
  await expect(pickButton).toHaveAttribute("aria-pressed", "false");
  const selected = nav.panel.locator('[role="treeitem"][aria-selected="true"]');
  await expect(selected).toHaveCount(1);

  await nav.chooseTree("In-page tree");
  await nav.chooseTree("Chrome's tree");
  await expect
    .poll(() => nav.panel.locator(".sn-node").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
  // A fresh tree, with nothing picked in it.
  await expect(selected).toHaveCount(0);
});

test("picking a second time re-fires the reveal even for the same node", async ({
  nav,
}) => {
  const page = await nav.showNative("native-panel.html");
  const headingRow = nav.panel.getByRole("treeitem", {
    name: "Native panel fixture",
  });

  await armPick(nav);
  await page.getByRole("heading", { name: "Native panel fixture" }).click();
  await expect(headingRow).toHaveAttribute("aria-selected", "true");

  // Select something else first, so the second pick has somewhere to move
  // the selection back FROM — proof this is a fresh reveal, not a
  // no-op-because-unchanged effect (see NativeTreeView's own `reveal.nonce`
  // comment for why a plain `nodeId`-keyed effect would miss this).
  await nav.panel.getByRole("treeitem", { name: /Sensitive field/ }).click();
  await expect(headingRow).toHaveAttribute("aria-selected", "false");

  await armPick(nav);
  await page.getByRole("heading", { name: "Native panel fixture" }).click();
  await expect(headingRow).toHaveAttribute("aria-selected", "true");
});

test("clicking Pick again while armed cancels it without selecting anything", async ({
  nav,
}) => {
  const page = await nav.showNative("native-panel.html");
  const pickButton = await armPick(nav);
  await pickButton.click();
  await expect(pickButton).toHaveAttribute("aria-pressed", "false");
  await expectInspectModeOff(nav, page);
});

test("Escape cancels an armed native pick while the panel has focus", async ({
  nav,
}) => {
  const page = await nav.showNative("native-panel.html");
  const pickButton = await armPick(nav);
  await nav.panel.keyboard.press("Escape");
  await expect(pickButton).toHaveAttribute("aria-pressed", "false");
  await expectInspectModeOff(nav, page);
});

test("Escape on the inspected page itself also cancels an armed native pick", async ({
  nav,
}) => {
  // The panel's own Escape listener (previous test) is scoped to the panel's
  // document and never sees a keystroke on the inspected page — there's no
  // content script in native mode to relay one. Chromium's Overlay domain
  // fires `Overlay.inspectModeCanceled` for exactly this case (confirmed
  // against a real browser, not assumed from the CDP spec), which `runPick`
  // now also listens for.
  const page = await nav.showNative("native-panel.html");
  const pickButton = await armPick(nav);

  await page.bringToFront();
  // No click here — clicking anything while inspect mode is armed IS a pick.
  // One Escape, once the pick is armed, is what this pins.
  await page.keyboard.press("Escape");
  await expect(pickButton).toHaveAttribute("aria-pressed", "false");
  await expectInspectModeOff(nav, page);

  // The tab's per-operation queue isn't stuck behind the (now-resolved)
  // pick — same proof the "picking a second time" test above relies on, just
  // via a refresh instead of a second pick.
  await nav.panel.getByRole("button", { name: "Refresh native tree" }).click();
  await expect
    .poll(() => nav.panel.locator(".sn-node").count(), { timeout: 10_000 })
    .toBeGreaterThan(0);
});

test("picking an element the AX tree pruned resolves to its nearest kept ancestor", async ({
  nav,
}) => {
  const page = await nav.showNative("native-panel.html");
  const pickButton = await armPick(nav);

  // The inner span has no accessible role or name of its own — Chromium's
  // AX tree never kept a node for it (see the fixture's own comment on
  // Item 1) — so this pins the ancestor-walk fallback (runPick's
  // `resolveChain`), not just the common case an ordinary element click
  // already covers.
  await page.locator(".item-1-inner").click();
  await expect(pickButton).toHaveAttribute("aria-pressed", "false");

  const itemRow = nav.panel.getByRole("treeitem", {
    name: /^button "Item 1" focusable/,
  });
  await expect(itemRow).toHaveAttribute("aria-selected", "true");
});

test("switching producer while a native pick is armed resets the button and cancels the pick", async ({
  nav,
}) => {
  const page = await nav.showNative("native-panel.html");
  const pickButton = await armPick(nav);

  await nav.chooseTree("In-page tree");

  // The same button now shows the DOM producer's own, never-armed picker.
  await expect(pickButton).toHaveAttribute("aria-pressed", "false");
  // And the native pick really ended: a page click reaches the page.
  const clicks = await countPageClicks(page);
  await page.getByRole("heading", { name: "Native panel fixture" }).click();
  await expect.poll(clicks).toBe(1);
});

test("a pick that lands on something the tree doesn't have says so", async ({
  nav,
}) => {
  const page = await nav.showNative("native-panel.html");
  // Added after the tree was read, outside anything the tree kept.
  await page.evaluate(() => {
    const late = document.createElement("button");
    late.textContent = "Added after the read";
    document.body.prepend(late);
  });
  await armPick(nav);
  await page.getByRole("button", { name: "Added after the read" }).click();
  await expect(
    nav.panel.getByText("The picked element isn't in this tree"),
  ).toBeVisible();
  await expect(nav.panel.locator("[aria-selected='true']")).toHaveCount(0);
});
