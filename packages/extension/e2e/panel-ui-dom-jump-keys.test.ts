/**
 * The keyboard path to the DOM tree's `aria-controls` jump chips, through
 * the real build. The chips sit outside the Tab order, so `Alt`+`J` follows
 * the selected row's links one by one and `Alt`+`Shift`+`J` goes back to the
 * row the jump came from — the ui package's `nextJump`, as in the native
 * tree.
 */

import { expect, test, type NativeHarness } from "./harness";

/** Bring a fixture forward, reload the panel and show its DOM A11Y tree. */
async function showDom(
  nav: NativeHarness,
  fixture: string,
): Promise<import("@playwright/test").Page> {
  const { page } = await nav.open(fixture);
  await page.bringToFront();
  await nav.panel.reload();
  const toggle = nav.panel
    .getByRole("group", { name: "Tree producer" })
    .getByRole("button", { name: "DOM", exact: true });
  await expect(toggle).toBeVisible({ timeout: 20_000 });
  await toggle.click();
  await nav.panel
    .getByRole("group", { name: "Tree view mode" })
    .getByRole("button", { name: "A11Y", exact: true })
    .click();
  await expect
    .poll(() => nav.panel.locator(".sn-node").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
  return page;
}

/** Record every node the panel asks the page to highlight. */
async function recordHighlights(nav: NativeHarness): Promise<void> {
  await nav.panel.evaluate(() => {
    const w = window as typeof window & { __highlighted?: string[] };
    w.__highlighted = [];
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = ((message: unknown, ...rest: unknown[]) => {
      const m = message as { type?: string; payload?: { nodeId?: string } };
      if (m?.type === "HIGHLIGHT_NODE" && m.payload?.nodeId) {
        w.__highlighted!.push(m.payload.nodeId);
      }
      return (real as (...a: unknown[]) => unknown)(message, ...rest);
    }) as typeof chrome.runtime.sendMessage;
  });
}

const lastHighlighted = (nav: NativeHarness) =>
  nav.panel.evaluate(() =>
    (window as typeof window & { __highlighted?: string[] }).__highlighted?.at(
      -1,
    ),
  );

// Matched on the row's accessible name, which starts with its own role and
// name: its text also holds its jump chips' (`→ tabpanel "Nils Frahm"`).
const selectedRow = (nav: NativeHarness) =>
  nav.panel.locator('[role="treeitem"][aria-selected="true"]');
const TAB = /^tab "Nils Frahm"/;
const PANEL = /^tabpanel "Nils Frahm"/;

/** The tree's `aria-activedescendant` names the selected row — what tells a
 *  screen reader the selection moved. */
async function expectActiveIsSelected(nav: NativeHarness): Promise<void> {
  const rowId = await selectedRow(nav).getAttribute("id");
  expect(rowId).toBeTruthy();
  await expect(nav.panel.getByRole("tree")).toHaveAttribute(
    "aria-activedescendant",
    rowId!,
  );
}

test("Alt+J follows the selected row's aria-controls link, and Alt+Shift+J comes back", async ({
  nav,
}) => {
  await showDom(nav, "tabs.html");
  await recordHighlights(nav);
  const tab = nav.panel.getByRole("treeitem", { name: /^tab "Nils Frahm"/ });
  await tab.click();
  await expect(selectedRow(nav)).toHaveAccessibleName(TAB);

  const tree = nav.panel.getByRole("tree");
  await tree.press("Alt+KeyJ");
  await expect(selectedRow(nav)).toHaveAccessibleName(PANEL);
  await expectActiveIsSelected(nav);
  // A jump is a selection like any other: the page is asked to highlight
  // the target, as for a click or an arrow key.
  const panelId = await selectedRow(nav).getAttribute("data-node-id");
  await expect.poll(() => lastHighlighted(nav)).toBe(panelId);

  await tree.press("Alt+Shift+KeyJ");
  await expect(selectedRow(nav)).toHaveAccessibleName(TAB);
  await expectActiveIsSelected(nav);
});

test("Alt+J again moves on to the row's next link, and Alt+Shift+J returns to where it started", async ({
  nav,
}) => {
  await showDom(nav, "controls-multi.html");
  const tree = nav.panel.getByRole("tree");
  await nav.panel.getByRole("treeitem", { name: /^button "Apply"/ }).click();
  await tree.press("Alt+KeyJ");
  await expect(selectedRow(nav)).toHaveAccessibleName(/^region "Filters"/);
  await tree.press("Alt+KeyJ");
  await expect(selectedRow(nav)).toHaveAccessibleName(/^region "Results"/);
  await tree.press("Alt+Shift+KeyJ");
  await expect(selectedRow(nav)).toHaveAccessibleName(/^button "Apply"/);
});

test("a jump to a row the search hides clears the search", async ({ nav }) => {
  await showDom(nav, "controls-multi.html");
  const search = nav.panel.getByRole("searchbox", {
    name: "Search tree nodes",
  });
  await search.fill("Apply");
  const apply = nav.panel.getByRole("treeitem", { name: /^button "Apply"/ });
  await apply.click();
  await expect(
    nav.panel.getByRole("treeitem", { name: /^region "Filters"/ }),
  ).toHaveCount(0);

  await nav.panel.getByRole("tree").press("Alt+KeyJ");
  await expect(search).toHaveValue("");
  await expect(selectedRow(nav)).toHaveAccessibleName(/^region "Filters"/);
  await expectActiveIsSelected(nav);
});

test("Alt+J does nothing on a row with no link, and keeps the selection", async ({
  nav,
}) => {
  await showDom(nav, "tabs.html");
  const list = nav.panel.getByRole("treeitem", { name: /^tablist/ });
  await list.click();
  await nav.panel.getByRole("tree").press("Alt+KeyJ");
  await expect(selectedRow(nav)).toHaveAccessibleName(/^tablist/);
});

test("Alt+J leaves a scope its target sits outside", async ({ nav }) => {
  await showDom(nav, "tabs.html");
  const tree = nav.panel.getByRole("tree");
  // Scope to the tablist: the panel the tab controls is outside it.
  await nav.panel.getByRole("treeitem", { name: /^tablist/ }).click();
  await tree.press("Control+Enter");
  await expect(nav.panel.locator(".sn-scope-bar")).toBeVisible();

  await nav.panel.getByRole("treeitem", { name: /^tab "Nils Frahm"/ }).click();
  await tree.press("Alt+KeyJ");
  await expect(selectedRow(nav)).toHaveAccessibleName(PANEL);
  await expect(nav.panel.locator(".sn-scope-bar")).toHaveCount(0);
});
