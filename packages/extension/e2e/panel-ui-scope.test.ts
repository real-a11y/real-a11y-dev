/**
 * Subtree scope in the production side panel, for both producers' trees.
 *
 * Scoping (double-click a container row, or `Ctrl`/`Cmd`+`Enter`; `Escape`
 * or the breadcrumb's ✕ to leave) used to be DOM-only and mouse-only: a
 * native row's double-click toggled it open or closed, and neither tree had
 * a key for it. Along the way this suite also pins two DOM bugs the same
 * change fixed:
 *
 *  - Copy on a scoped DOM tree cut the start off every line of the tree
 *    section. `serializeTree` already starts a scoped subtree at column 0,
 *    and the export de-indented it by the scope's depth a second time.
 *  - A reveal outside the scope (a list's go-to-tree, a pick) selected a row
 *    the scoped tree never renders.
 */

import { expect, test, type NativeHarness } from "./harness";

type PanelPage = import("@playwright/test").Page;

/** Bring a fixture forward, reload the panel and show `producer`'s tree. */
async function show(
  nav: NativeHarness,
  fixture: string,
  producer: "DOM" | "NATIVE",
): Promise<PanelPage> {
  const { page } = await nav.open(fixture);
  await page.bringToFront();
  await nav.panel.reload();

  // Scoped to the toolbar's producer group: the view-mode group has its own
  // "DOM" button.
  const toggle = nav.panel
    .getByRole("group", { name: "Tree producer" })
    .getByRole("button", { name: producer, exact: true });
  await expect(toggle).toBeVisible({ timeout: 20_000 });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  if (producer === "DOM") {
    // The A11Y view, so rows read `role "name"` the way native's do.
    await nav.panel
      .getByRole("group", { name: "Tree view mode" })
      .getByRole("button", { name: "A11Y", exact: true })
      .click();
  }
  await expect
    .poll(() => nav.panel.locator(".sn-node").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
  return page;
}

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

async function copyEverything(nav: NativeHarness): Promise<string> {
  await stubClipboard(nav);
  await nav.panel.getByRole("button", { name: "Copy ▾" }).click();
  await nav.panel
    .locator(".sn-export-menu")
    .getByRole("button", { name: "Everything" })
    .click();
  let copied: string | undefined;
  await expect
    .poll(async () => {
      copied = await nav.panel.evaluate(
        () =>
          (window as typeof window & { __copiedText?: string }).__copiedText,
      );
      return copied !== undefined;
    })
    .toBe(true);
  return copied!;
}

/** The tree section of an exported report: the fenced block after its heading. */
function treeSection(markdown: string, heading: string): string[] {
  const start = markdown.indexOf(`## ${heading}`);
  expect(start).toBeGreaterThan(-1);
  const fence = markdown.indexOf("```", start);
  const end = markdown.indexOf("```", fence + 3);
  return markdown
    .slice(markdown.indexOf("\n", fence) + 1, end)
    .split("\n")
    .filter(Boolean);
}

const itemsRow = (panel: PanelPage) =>
  panel.getByRole("treeitem", { name: /region.*"Items"/ });
const scopeBar = (panel: PanelPage) => panel.locator(".sn-scope-bar");

for (const producer of ["DOM", "NATIVE"] as const) {
  test.describe(`${producer} tree`, () => {
    test("double-clicking a container row scopes to it; Escape leaves", async ({
      nav,
    }) => {
      await show(nav, "native-panel.html", producer);
      await itemsRow(nav.panel).dblclick({ position: { x: 5, y: 5 } });

      await expect(scopeBar(nav.panel)).toBeVisible();
      await expect(
        scopeBar(nav.panel).locator('[aria-current="location"]'),
      ).toHaveText(/"Items"/);
      // The page's own h1 sits outside the scope.
      await expect(
        nav.panel.getByRole("treeitem", { name: /Native panel fixture/ }),
      ).toHaveCount(0);
      await expect(itemsRow(nav.panel)).toHaveAttribute("aria-level", "1");

      await nav.panel.locator(".sn-tree").press("Escape");
      await expect(scopeBar(nav.panel)).toHaveCount(0);
      await expect(
        nav.panel.getByRole("treeitem", { name: /Native panel fixture/ }),
      ).toBeVisible();
    });

    test("Ctrl+Enter scopes to the selected row, and ✕ leaves", async ({
      nav,
    }) => {
      await show(nav, "native-panel.html", producer);
      await itemsRow(nav.panel).click({ position: { x: 5, y: 5 } });
      await nav.panel.locator(".sn-tree").press("Control+Enter");

      await expect(scopeBar(nav.panel)).toBeVisible();
      await expect(nav.panel.locator(".sn-action-feedback")).toContainText(
        "Scoped to",
      );

      await scopeBar(nav.panel)
        .getByRole("button", { name: "Exit scope" })
        .click();
      await expect(scopeBar(nav.panel)).toHaveCount(0);
      // Focus goes back to the tree, not to <body> with the removed button.
      await expect(nav.panel.locator(".sn-tree")).toBeFocused();
    });

    test("Copy exports the scoped subtree, root line intact", async ({
      nav,
    }) => {
      await show(nav, "native-panel.html", producer);
      await itemsRow(nav.panel).dblclick({ position: { x: 5, y: 5 } });
      await expect(scopeBar(nav.panel)).toBeVisible();

      const markdown = await copyEverything(nav);
      expect(markdown).toContain('- **Scope:** region "Items"');
      const heading =
        producer === "NATIVE"
          ? "Native accessibility tree"
          : "Accessibility tree";
      const lines = treeSection(markdown, heading);
      // The scope root at column 0 with its role still on it — the DOM export
      // used to slice `2 * depth` characters off every line.
      expect(lines[0]).toBe('region "Items"');
      expect(lines).toContain('  button "Item 16"');
      expect(markdown).not.toContain("Native panel fixture");
    });

    test("✕ with a role filter's list showing hands focus to the list", async ({
      nav,
    }) => {
      await show(nav, "native-panel.html", producer);
      await itemsRow(nav.panel).dblclick({ position: { x: 5, y: 5 } });
      await nav.panel
        .getByRole("button", { name: "Buttons", exact: true })
        .click();

      await scopeBar(nav.panel)
        .getByRole("button", { name: "Exit scope" })
        .click();
      await expect(scopeBar(nav.panel)).toHaveCount(0);
      await expect(nav.panel.getByRole("listbox")).toBeFocused();
    });

    test("go-to-tree from a list item outside the scope leaves it", async ({
      nav,
    }) => {
      await show(nav, "native-panel.html", producer);
      await itemsRow(nav.panel).dblclick({ position: { x: 5, y: 5 } });
      await expect(scopeBar(nav.panel)).toBeVisible();

      await nav.panel
        .getByRole("button", { name: "Headings", exact: true })
        .click();
      await nav.panel
        .getByRole("option", { name: /Native panel fixture/ })
        .dblclick();

      await expect(scopeBar(nav.panel)).toHaveCount(0);
      await expect(
        nav.panel.getByRole("treeitem", { name: /Native panel fixture/ }),
      ).toHaveAttribute("aria-selected", "true");
    });
  });
}

test("NATIVE: a pick outside the scope leaves it and selects the picked row", async ({
  nav,
}) => {
  const page = await show(nav, "native-panel.html", "NATIVE");
  await itemsRow(nav.panel).dblclick({ position: { x: 5, y: 5 } });
  await expect(scopeBar(nav.panel)).toBeVisible();

  const pickButton = nav.panel.getByRole("button", {
    name: "Pick element in page",
  });
  await pickButton.click();
  await expect(pickButton).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("heading", { name: "Native panel fixture" }).click();

  await expect(scopeBar(nav.panel)).toHaveCount(0);
  await expect(
    nav.panel.getByRole("treeitem", { name: /Native panel fixture/ }),
  ).toHaveAttribute("aria-selected", "true");
});

test("NATIVE: Escape with a pick armed cancels the pick and keeps the scope", async ({
  nav,
}) => {
  await show(nav, "native-panel.html", "NATIVE");
  await itemsRow(nav.panel).dblclick({ position: { x: 5, y: 5 } });
  await expect(scopeBar(nav.panel)).toBeVisible();

  const pickButton = nav.panel.getByRole("button", {
    name: "Pick element in page",
  });
  await pickButton.click();
  await expect(pickButton).toHaveAttribute("aria-pressed", "true");

  await nav.panel.locator(".sn-tree").press("Escape");
  await expect(pickButton).toHaveAttribute("aria-pressed", "false");
  await expect(scopeBar(nav.panel)).toBeVisible();
});

test("DOM: Escape in the tree leaves the scope even with a pick armed", async ({
  nav,
}) => {
  // A DOM pick is cancelled by Escape on the page, never by the panel's, so
  // holding the panel's Escape back for it would leave the key doing nothing.
  await show(nav, "native-panel.html", "DOM");
  await itemsRow(nav.panel).dblclick({ position: { x: 5, y: 5 } });
  await expect(scopeBar(nav.panel)).toBeVisible();

  const pickButton = nav.panel.getByRole("button", {
    name: "Pick element in page",
  });
  await pickButton.click();
  await expect(pickButton).toHaveAttribute("aria-pressed", "true");

  await nav.panel.locator(".sn-tree").press("Escape");
  await expect(scopeBar(nav.panel)).toHaveCount(0);
});
