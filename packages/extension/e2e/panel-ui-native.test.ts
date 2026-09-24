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

test("a failed Enable attempt surfaces its error inline and never flips the setting", async ({
  nav,
}) => {
  const { page } = await nav.open("native-panel.html");
  await page.bringToFront();

  // Every other test in this file relies on the worker-scoped dogfood
  // fixture's own native-mode-already-on storage write — this test needs it
  // OFF so the entry point is the consent banner, not the toggle. Written
  // before the reload below so App.tsx's mount-time NATIVE_FLAG_GET effect
  // reads the fresh value.
  await nav.panel.evaluate(() =>
    chrome.storage.local.set({ "settings.nativeModeEnabled": false }),
  );
  await nav.panel.reload();

  const enableEntry = nav.panel.getByRole("button", {
    name: "Enable native mode…",
  });
  await expect(enableEntry).toBeVisible({ timeout: 20_000 });

  // Simulate NATIVE_FLAG_SET never reaching the service worker — the exact
  // case `setNativeMode`'s own catch branch exists for (a torn-down
  // extension context, a not-yet-woken MV3 worker). Only that one message
  // type is intercepted; everything else (including the DOM producer's own
  // connection) goes through untouched.
  await nav.panel.evaluate(() => {
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = ((message: unknown, ...rest: unknown[]) => {
      if (
        typeof message === "object" &&
        message !== null &&
        (message as { type?: unknown }).type === "NATIVE_FLAG_SET"
      ) {
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
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Enable" }).click();

  // Without the fix, `onEnable`'s `.then(() => setProducer("native"))` fires
  // unconditionally — the promise resolves either way, since the catch
  // branch returns rather than rejects — so the panel would silently switch
  // to a "native" view for a setting that was never actually persisted,
  // with the banner gone and no error anywhere.
  await expect(banner).toBeVisible();
  await expect(banner.getByRole("alert")).toContainText(
    "Couldn't enable native mode",
  );
  await expect(enableEntry).toBeVisible();
  await expect(
    nav.panel.getByRole("button", { name: "NATIVE", exact: true }),
  ).toHaveCount(0);

  // Restore the shared worker fixture's own assumed state for every test
  // that follows.
  await nav.panel.evaluate(() =>
    chrome.storage.local.set({ "settings.nativeModeEnabled": true }),
  );
});

// ---- Native as default (execution plan PR 5) ----
//
// The `dogfood` fixture (harness.ts) already flips `settings.nativeModeEnabled`
// on before any test runs, simulating a user who opted in during an earlier
// session — exactly the precondition PR 5's default targets. Both tests below
// therefore never click the "NATIVE" toggle at all; that omission is the
// assertion.

test("native mode defaults to the native producer on first connect, with no click", async ({
  nav,
}) => {
  const { page } = await nav.open("native-panel.html");
  await page.bringToFront();
  await nav.panel.reload();

  // Same wait `showNative` uses, but note what's absent: no
  // `.getByRole("button", { name: "NATIVE" }).click()` anywhere in this test.
  await expect
    .poll(() => nav.panel.locator(".sn-node").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);

  await expect(
    nav.panel.getByRole("button", { name: "NATIVE", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  // The rows are native-panel.html's own ids, not the production DOM tree's
  // fixture markup — proof this is genuinely the native producer's tree, not
  // a DOM-producer tree that merely rendered before the assertion ran.
  await nav.panel.getByRole("button", { name: "Expand all" }).click();
  // A row's accessible name is `button "Item 1" focusable Click ⏎`; anchored
  // at the start so the match doesn't also hit "Item 10".."Item 16".
  await expect(
    nav.panel.getByRole("treeitem", { name: /^button "Item 1" focusable/ }),
  ).toBeVisible();
});

test("switching tabs after the default does not silently re-attach", async ({
  nav,
}) => {
  const first = await nav.open("native-panel.html");
  await first.page.bringToFront();
  await nav.panel.reload();
  await expect
    .poll(() => nav.panel.locator(".sn-node").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);

  // A second tab, brought to the front — the same tab-switch shape
  // `hasAutoLoadedNative`'s own comment in App.tsx describes, now exercised
  // through the default path rather than a manual toggle.
  const second = await nav.open("tree-view.html");
  await second.page.bringToFront();

  // The switch clears the stale tree (native ids are scoped to the document
  // they were read from) but must NOT re-attach on its own — a fresh
  // `chrome.debugger` attach with no user gesture on this tab is exactly what
  // the anti-silent-reattach fix exists to prevent. Polling for the count to
  // drop to zero and stay there (rather than a single snapshot read) is what
  // catches a re-attach that would otherwise race this assertion and win.
  await expect
    .poll(() => nav.panel.locator(".sn-node").count(), { timeout: 5_000 })
    .toBe(0);
  await nav.panel.waitForTimeout(500);
  expect(await nav.panel.locator(".sn-node").count()).toBe(0);

  // The toggle itself stays on NATIVE — only the tree emptied, not the
  // producer choice — and an explicit refresh still works normally.
  await expect(
    nav.panel.getByRole("button", { name: "NATIVE", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await nav.panel.getByRole("button", { name: "Refresh native tree" }).click();
  await expect
    .poll(() => nav.panel.locator(".sn-node").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
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

test("Copy → Everything copies a native tree + heading report, correctly labeled", async ({
  nav,
}) => {
  await showNative(nav, "native-panel.html");
  await stubClipboard(nav);

  await nav.panel.getByRole("button", { name: "Copy ▾" }).click();
  await nav.panel
    .locator(".sn-export-menu")
    .getByRole("button", { name: "Everything" })
    .click();

  const copied = await readClipboardStub(nav);
  expect(copied).toBeDefined();
  const markdown = copied!;

  // Labeled distinctly from the DOM producer's own "DOM tree"/"Accessibility
  // tree" header — this is the one place a user actually sees which
  // producer a report came from (the internal `source.producer` stamp isn't
  // rendered anywhere today; see CLAUDE.md's "Two producers build the tree").
  expect(markdown).toContain("## Native accessibility tree");
  expect(markdown).toContain("## Heading outline");
  expect(markdown).not.toContain("## Tab sequence");

  // Real content from the native tree, not an empty/placeholder report —
  // native-panel.html's own headings and a leaf button, proving this came
  // from `nativeNodes`, not the (empty, never-connected) DOM producer state.
  expect(markdown).toContain("h1 Native panel fixture");
  expect(markdown).toContain("h2 Sensitive field");
  expect(markdown).toMatch(/button "Item 1"/);

  // A named `generic` group ("Sensitive field group") — Chromium keeps a
  // generic node only when it has a name (unnamed ones are noise), so
  // unlike a DOM tree, every generic that reaches a native tree is one the
  // panel actually shows. `serializeTree`'s default `includeGeneric: false`
  // doesn't know that and would silently drop it; this is what pins
  // `App.tsx`'s native export call to pass `{ includeGeneric: true }`.
  expect(markdown).toMatch(/generic "Sensitive field group"/);
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

test("picking an element on the page selects and reveals it in the native tree", async ({
  nav,
}) => {
  const page = await showNative(nav, "native-panel.html");

  const pickButton = nav.panel.getByRole("button", {
    name: "Pick element in page",
  });
  await expect(pickButton).toHaveAttribute("aria-pressed", "false");
  await pickButton.click();
  await expect(pickButton).toHaveAttribute("aria-pressed", "true");

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

test("picking a second time re-fires the reveal even for the same node", async ({
  nav,
}) => {
  const page = await showNative(nav, "native-panel.html");
  const pickButton = nav.panel.getByRole("button", {
    name: "Pick element in page",
  });
  const headingRow = nav.panel.getByRole("treeitem", {
    name: "Native panel fixture",
  });

  await pickButton.click();
  await page.getByRole("heading", { name: "Native panel fixture" }).click();
  await expect(headingRow).toHaveAttribute("aria-selected", "true");

  // Select something else first, so the second pick has somewhere to move
  // the selection back FROM — proof this is a fresh reveal, not a
  // no-op-because-unchanged effect (see NativeTreeView's own `reveal.nonce`
  // comment for why a plain `nodeId`-keyed effect would miss this).
  await nav.panel
    .getByRole("treeitem", { name: "Sensitive field group" })
    .click();
  await expect(headingRow).toHaveAttribute("aria-selected", "false");

  await pickButton.click();
  await page.getByRole("heading", { name: "Native panel fixture" }).click();
  await expect(headingRow).toHaveAttribute("aria-selected", "true");
});

test("clicking Pick again while armed cancels it without selecting anything", async ({
  nav,
}) => {
  await showNative(nav, "native-panel.html");
  const pickButton = nav.panel.getByRole("button", {
    name: "Pick element in page",
  });

  await pickButton.click();
  await expect(pickButton).toHaveAttribute("aria-pressed", "true");
  await pickButton.click();
  await expect(pickButton).toHaveAttribute("aria-pressed", "false");

  // No row is selected — the cancel never produced a NATIVE_PICK_RESULT with
  // a node id.
  await expect(nav.panel.locator("[aria-selected='true']")).toHaveCount(0);
});

test("Escape cancels an armed native pick while the panel has focus", async ({
  nav,
}) => {
  await showNative(nav, "native-panel.html");
  const pickButton = nav.panel.getByRole("button", {
    name: "Pick element in page",
  });

  await pickButton.click();
  await expect(pickButton).toHaveAttribute("aria-pressed", "true");

  await nav.panel.keyboard.press("Escape");
  await expect(pickButton).toHaveAttribute("aria-pressed", "false");
  await expect(nav.panel.locator("[aria-selected='true']")).toHaveCount(0);
});

test("picking an element the AX tree pruned resolves to its nearest kept ancestor", async ({
  nav,
}) => {
  const page = await showNative(nav, "native-panel.html");
  const pickButton = nav.panel.getByRole("button", {
    name: "Pick element in page",
  });

  await pickButton.click();
  await expect(pickButton).toHaveAttribute("aria-pressed", "true");

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
  await showNative(nav, "native-panel.html");
  const pickButton = nav.panel.getByRole("button", {
    name: "Pick element in page",
  });

  await pickButton.click();
  await expect(pickButton).toHaveAttribute("aria-pressed", "true");

  await nav.panel.getByRole("button", { name: "DOM", exact: true }).click();

  // The SAME button now reflects the DOM producer's own (never-armed)
  // picker state — without the fix, `pickModeOn` stayed true across the
  // switch and this button rendered "on" for a picker nothing had actually
  // started.
  await expect(pickButton).toHaveAttribute("aria-pressed", "false");
});
