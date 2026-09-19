/**
 * Production side-panel coverage for the native producer's OWN UI —
 * `NativeTreeView.tsx` and `App.tsx`'s `handleNativeActivate` — which no
 * other e2e suite touches: everything else in `e2e/` drives either the
 * message channel directly or the dev-only `DogfoodPanel` widget
 * (`panel-ui.test.ts`), never the production tree the toolbar's NATIVE
 * toggle switches to.
 *
 * Every test here pins a real bug a review round (or, for the last two, a
 * user's own hands-on pass) caught that no test would have — proof each gap
 * was worth closing rather than assumed:
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
