/**
 * Focus sync in Chrome's tree: focus moving on the page selects the focused
 * element's row, expanded to and scrolled into view, as the in-page tree's
 * Focus sync does, and with no debugger attached. The native read numbers
 * the page's elements twice, over CDP and in the content script's walk of
 * the live page (`src/native/page-keys.ts`), and focus is reported by
 * number. If the two walks numbered the page differently, nothing would
 * follow, so the fixture holds everything they could disagree on.
 */

import { expect, test, type NativeHarness } from "./harness";

const FIXTURE = "native-focus-sync.html";

/** The native tree's row for a node of `role` named `name`. */
function row(nav: NativeHarness, role: string, name: string) {
  return nav.nativeTree().getByRole("treeitem", {
    name: new RegExp(`^${role} "${name}"`),
  });
}

/** The native tree's selected row. */
function selected(nav: NativeHarness) {
  return nav.nativeTree().locator('[role="treeitem"][aria-selected="true"]');
}

test("a native read numbers the page's rows, and not those of a frame no content script runs in", async ({
  nav,
}) => {
  const { tabId } = await nav.open(FIXTURE);
  // Only when asked, as the panel does while Focus sync is on.
  expect((await nav.read(tabId)).pageKeysReadId).toBeUndefined();
  const result = await nav.read(tabId, { pageKeys: true });
  expect(result.ok).toBe(true);
  expect(result.pageKeysReadId).toEqual(expect.any(String));
  const pageKey = (name: string) =>
    result.nodes!.find((n) => n.role === "button" && n.name === name)?.pageKey;
  for (const name of [
    "Alpha",
    "Beta",
    "Gamma",
    "Open button",
    "Closed button",
  ]) {
    expect(pageKey(name), name).toEqual(expect.any(Number));
  }
  // A `srcdoc` frame's document is walked by no content script, so nothing
  // numbers it, though its rows are in the tree.
  expect(
    result.nodes!.some(
      (n) => n.role === "button" && n.name === "Inside the frame",
    ),
  ).toBe(true);
  expect(pageKey("Inside the frame")).toBeUndefined();
  expect(
    result.nodes!.find((n) => n.role === "Iframe")?.embedsPageFrame,
  ).toBeUndefined();
});

test("focus moving on the page selects its row, with nothing read or done on the page", async ({
  nav,
}) => {
  const page = await nav.showNative(FIXTURE);
  const reads = (await nav.nativeReads()).length;

  await page.locator("#beta").focus();
  await expect(row(nav, "button", "Beta")).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // Under a group the tree first shows collapsed: it opens to the row.
  await expect(row(nav, "button", "Gamma")).toHaveCount(0);
  await page.locator("#gamma").focus();
  await expect(row(nav, "button", "Gamma")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(selected(nav)).toHaveCount(1);

  // A link, by keyboard.
  await page.locator("#first-link").focus();
  await page.keyboard.press("Tab");
  await expect(row(nav, "link", "Second link")).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // Selecting the row doesn't follow it back onto the page, as every other
  // selection does: that would attach the debugger on every Tab press.
  // Waited past the follow's debounce, so a follow would have been sent.
  await page.waitForTimeout(500);
  expect(await nav.nativeActs()).toEqual([]);
  expect(await nav.nativeReads()).toHaveLength(reads);
  await expect(page.locator("#second-link")).toBeFocused();
});

test("focus inside an open or a closed shadow root selects the element's own row, moving inside the root too", async ({
  nav,
}) => {
  const page = await nav.showNative(FIXTURE);
  const focusClosed = (id: string) =>
    page.evaluate(
      (id) =>
        (
          window as typeof window & { focusClosed(id: string): void }
        ).focusClosed(id),
      id,
    );
  // Into each root from outside it, then on to its other button: a move the
  // document never hears.
  await page.locator("#open-button").focus();
  await expect(row(nav, "button", "Open button")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.locator("#open-second").focus();
  await expect(row(nav, "button", "Open second")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await focusClosed("closed-button");
  await expect(row(nav, "button", "Closed button")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await focusClosed("closed-second");
  await expect(row(nav, "button", "Closed second")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.waitForTimeout(500);
  expect(await nav.nativeActs()).toEqual([]);
});

test("after the page changes, focus still finds its row, or the nearest one above an element added since", async ({
  nav,
}) => {
  const page = await nav.showNative(FIXTURE);
  const reads = (await nav.nativeReads()).length;
  await page.evaluate(() => {
    // Ahead of everything: every later element's place moves.
    (window as typeof window & { insertAhead(): void }).insertAhead();
    const late = document.createElement("button");
    late.id = "late";
    late.textContent = "Late";
    document.querySelector("#deep div")!.append(late);
  });

  await page.locator("#beta").focus();
  await expect(row(nav, "button", "Beta")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  // Not in the tree read before it was added: its nearest row is the
  // group's.
  await page.locator("#late").focus();
  await expect(row(nav, "group", "Inner group")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  // "Follow page changes" is off: nothing was read again.
  expect(await nav.nativeReads()).toHaveLength(reads);
});

test("Focus sync shows over Chrome's tree, and turning it off stops the following", async ({
  nav,
}) => {
  const page = await nav.showNative(FIXTURE);
  const toggle = nav.panel.getByRole("button", {
    name: "Focus sync",
    exact: true,
  });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  await page.locator("#alpha").focus();
  await expect(row(nav, "button", "Alpha")).toHaveAttribute(
    "aria-selected",
    "true",
  );

  const off = nav.panel.getByRole("button", { name: "Focus OFF" });
  await toggle.click();
  await expect(off).toHaveAttribute("aria-pressed", "false");
  await page.locator("#beta").focus();
  await page.waitForTimeout(300);
  await expect(row(nav, "button", "Alpha")).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await off.click();
  await page.locator("#first-link").focus();
  await expect(row(nav, "link", "First link")).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("turning Focus sync on over a tree read while it was off reads the page again, and follows", async ({
  nav,
}) => {
  // Whether the content script's tracker stays off through page updates is
  // `background.test.ts`'s to check: this harness's panel is a tab, whose
  // messages the service worker takes for a content script's, so its toggle
  // never reaches the tracker here.
  const page = await nav.showNative(FIXTURE);
  const off = nav.panel.getByRole("button", { name: "Focus OFF" });
  await nav.panel
    .getByRole("button", { name: "Focus sync", exact: true })
    .click();
  await expect(off).toHaveAttribute("aria-pressed", "false");

  // Read with Focus sync off, the tree has nothing to follow focus by, so
  // turning it on reads the page again.
  const before = (await nav.nativeReads()).length;
  await nav.panel.getByRole("button", { name: "Refresh native tree" }).click();
  await expect
    .poll(async () => (await nav.nativeReads())[before]?.done)
    .toBe(true);
  expect((await nav.nativeReads())[before]?.pageKeys).toBeUndefined();
  const reads = before + 1;
  await off.click();
  await expect
    .poll(async () => (await nav.nativeReads()).length)
    .toBe(reads + 1);
  expect((await nav.nativeReads())[reads]).toMatchObject({
    pageKeys: true,
    auto: true,
  });
  // Until that read's tree arrives, focus reports name nothing in it.
  await expect
    .poll(async () => (await nav.nativeReads())[reads]?.done)
    .toBe(true);
  await page.locator("#gamma").focus();
  await expect(row(nav, "button", "Gamma")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(await nav.nativeReads()).toHaveLength(reads + 1);
});
