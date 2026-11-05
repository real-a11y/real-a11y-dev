/**
 * What changed, through the real build: each read of Chrome's tree is
 * compared with the one before it, and the tree marks what it found
 * (`tree-changes.ts`). The APG accordion is the case the feature was asked
 * for: a button that opens a panel, whose new rows should stand out, with
 * the button's own `collapsed` → `expanded`.
 */

import { CHANGE_FLASH_MS } from "../src/sidepanel/tree-changes.ts";

import { expect, test, type NativeHarness } from "./harness";

type PanelPage = import("@playwright/test").Page;

/** Read Chrome's tree again, as the panel's Refresh does, and wait for it
 *  (as `blank-frames.test.ts` does). */
async function refresh(nav: NativeHarness): Promise<void> {
  const before = (await nav.nativeReads()).length;
  await nav.panel.getByRole("button", { name: "Refresh native tree" }).click();
  await expect
    .poll(async () => (await nav.nativeReads())[before]?.done)
    .toBe(true);
}

/** A row of Chrome's tree, by its role and the start of its name. */
function row(panel: PanelPage, role: string, name: string) {
  return panel.getByRole("treeitem", { name: new RegExp(`^${role} "${name}`) });
}

/** The bar under the tree that sums up what the last read found. */
function changesBar(panel: PanelPage) {
  return panel.getByRole("group", { name: "Changes since the read before" });
}

test("opening an accordion panel through the tree marks what it revealed and what changed", async ({
  nav,
}) => {
  await nav.showNative("accordion.html");
  const trigger = row(nav.panel, "button", "Personal Information");
  await trigger.click();
  await nav.panel.getByRole("tree").press("Enter");

  // The panel the button opened is new: it says so, and opens.
  const region = row(nav.panel, "region", "Personal Information");
  await expect(region).toHaveClass(/sn-node--change-new/);
  await expect(region.locator(".sn-change-tag--new")).toHaveText("new");
  await expect(region).toHaveAttribute("aria-expanded", "true");
  await expect(
    nav.panel
      .getByRole("treeitem", { name: /Name and contact details/ })
      .first(),
  ).toHaveClass(/sn-node--change-new/);

  // The button changed, and its badge shows what to.
  await expect(trigger).toHaveClass(/sn-node--change-changed/);
  await expect(trigger.locator(".sn-change-tag--changed")).toHaveAttribute(
    "title",
    /expanded: collapsed → expanded/,
  );
  await expect(trigger.locator(".sn-change-part")).toHaveText("expanded");

  await expect(changesBar(nav.panel)).toContainText("1 changed");
  await expect(changesBar(nav.panel)).toContainText("new");

  // The flash is a moment; the edge stays until the next read.
  await expect(region).not.toHaveClass(/sn-node--change-flash/, {
    timeout: CHANGE_FLASH_MS + 5_000,
  });
  await expect(region).toHaveClass(/sn-node--change-new/);
});

test("Alt+N and Alt+Shift+N go from change to change", async ({ nav }) => {
  await nav.showNative("accordion.html");
  await row(nav.panel, "button", "Personal Information").click();
  const tree = nav.panel.getByRole("tree");
  await tree.press("Enter");
  await expect(changesBar(nav.panel)).toBeVisible();

  const selected = nav.panel.locator('[role="treeitem"][aria-selected="true"]');
  // From the button, the next change is the panel it opened, below it.
  await tree.press("Alt+n");
  await expect(selected).toHaveClass(/sn-node--change-new/);
  await expect(selected.locator(".sn-role")).toHaveText("region");
  // And it wraps round, back to the button.
  await tree.press("Alt+n");
  await expect(selected.locator(".sn-role")).toHaveText("button");
  await tree.press("Alt+Shift+N");
  await expect(selected.locator(".sn-role")).toHaveText("region");
});

test("a click on the page itself is marked too", async ({ nav }) => {
  const page = await nav.showNative("accordion.html");
  await page.locator("#personal-trigger").click();

  await expect(row(nav.panel, "region", "Personal Information")).toHaveClass(
    /sn-node--change-new/,
    { timeout: 20_000 },
  );
  await expect(row(nav.panel, "button", "Personal Information")).toHaveClass(
    /sn-node--change-changed/,
  );
});

test("closing a panel lists the rows it took away", async ({ nav }) => {
  await nav.showNative("accordion.html");
  await row(nav.panel, "button", "Billing Address").click();
  await nav.panel.getByRole("tree").press("Enter");

  const bar = changesBar(nav.panel);
  await expect(bar).toContainText("removed");
  await bar.getByText("Removed rows").click();
  await expect(bar.getByRole("listitem").first()).toHaveText(
    'region "Billing Address"',
  );
  await expect(row(nav.panel, "button", "Billing Address")).toHaveClass(
    /sn-node--change-changed/,
  );
});

test("a read that finds nothing new marks nothing, and ✕ clears the marks", async ({
  nav,
}) => {
  await nav.showNative("accordion.html");
  await refresh(nav);
  await expect(changesBar(nav.panel)).toHaveCount(0);
  await expect(
    nav.panel.locator(".sn-node--change-new, .sn-node--change-changed"),
  ).toHaveCount(0);

  await row(nav.panel, "button", "Personal Information").click();
  await nav.panel.getByRole("tree").press("Enter");
  await expect(changesBar(nav.panel)).toBeVisible();
  await changesBar(nav.panel)
    .getByRole("button", { name: "Clear change marks" })
    .click();
  await expect(changesBar(nav.panel)).toHaveCount(0);
  await expect(nav.panel.locator(".sn-node--change-new")).toHaveCount(0);
});

test("a modal dialog is marked new without the page behind it, and closing it marks only what it changed", async ({
  nav,
}) => {
  await nav.showNative("dialog-modal.html");
  await row(nav.panel, "button", "Add delivery address").click();
  await nav.panel.getByRole("tree").press("Enter");

  // The page behind a modal leaves Chrome's tree, as it does a screen
  // reader's, and the tree's root moves to the dialog. Neither is the page
  // removing anything.
  const dialog = row(nav.panel, "dialog", "Add delivery address");
  await expect(dialog).toHaveClass(/sn-node--change-new/);
  await expect(changesBar(nav.panel)).toContainText("new");
  await expect(changesBar(nav.panel)).not.toContainText("removed");

  // Saving closes it: the page comes back, compared with the page from
  // before the dialog, not marked new as a whole.
  await row(nav.panel, "button", "Save").click();
  await nav.panel.getByRole("tree").press("Enter");
  const background = row(nav.panel, "button", "Background action");
  await expect(background).toBeVisible({ timeout: 10_000 });
  await expect(background).not.toHaveClass(/sn-node--change-new/);
  await expect(
    row(nav.panel, "button", "Add delivery address"),
  ).not.toHaveClass(/sn-node--change-new/);
  // At most the echo's own new text: Save wrote it.
  expect(
    await nav.panel.locator(".sn-node--change-new").count(),
  ).toBeLessThanOrEqual(1);
});

test("a dialog a library opens by hiding the page is marked as a modal one is, though Chrome doesn't mark it modal", async ({
  nav,
}) => {
  await nav.showNative("dialog-hidden-page.html");
  await row(nav.panel, "button", "Edit profile").click();
  await nav.panel.getByRole("tree").press("Enter");

  const dialog = row(nav.panel, "dialog", "Edit profile");
  await expect(dialog).toHaveClass(/sn-node--change-new/);
  await expect(changesBar(nav.panel)).toContainText("new");
  await expect(changesBar(nav.panel)).not.toContainText("removed");

  // Saving brings the page back, compared with the page from before.
  await row(nav.panel, "button", "Save changes").click();
  await nav.panel.getByRole("tree").press("Enter");
  const trigger = row(nav.panel, "button", "Edit profile");
  await expect(trigger).toBeVisible({ timeout: 10_000 });
  await expect(trigger).not.toHaveClass(/sn-node--change-new/);
  // At most the saved name's own new text.
  expect(
    await nav.panel.locator(".sn-node--change-new").count(),
  ).toBeLessThanOrEqual(1);
});

test("the panel's own accessibility tree in Chrome, what a screen reader reads, carries the marks and what the read found", async ({
  nav,
}) => {
  await nav.showNative("accordion.html");
  await row(nav.panel, "button", "Personal Information").click();
  await nav.panel.getByRole("tree").press("Enter");
  await expect(changesBar(nav.panel)).toBeVisible();

  const cdp = await nav.panel.context().newCDPSession(nav.panel);
  type AXNode = {
    nodeId: string;
    parentId?: string;
    ignored: boolean;
    role?: { value: string };
    name?: { value: string };
    properties?: { name: string; value: { value: unknown } }[];
  };
  const read = async () =>
    ((await cdp.send("Accessibility.getFullAXTree")) as { nodes: AXNode[] })
      .nodes;
  const rows = (nodes: AXNode[]) =>
    nodes
      .filter((node) => !node.ignored && node.role?.value === "treeitem")
      .map((node) => node.name?.value ?? "");

  // Each marked row says what happened to it after its role and name.
  await expect
    .poll(async () => rows(await read()))
    .toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^region "Personal Information".*, new$/),
        expect.stringMatching(
          /^button "Personal Information".*, changed: now expanded/,
        ),
      ]),
    );
  // And a polite live region holds what the read found.
  const nodes = await read();
  const polite = new Set(
    nodes
      .filter((node) =>
        node.properties?.some(
          (p) => p.name === "live" && p.value.value === "polite",
        ),
      )
      .map((node) => node.nodeId),
  );
  const said = nodes.find(
    (node) =>
      node.role?.value === "StaticText" &&
      node.name?.value === "2 new, 1 changed in the tree",
  );
  expect(said?.parentId !== undefined && polite.has(said.parentId)).toBe(true);
});
