/**
 * Long names in a side panel's width, in both producers' trees.
 *
 * A name longer than the panel is wide used to size the whole tree to it, so
 * the panel scrolled sideways and every other row's end sat off screen. Now
 * a long name ends in an ellipsis, carrying its whole text as a tooltip, and
 * the tree fits the panel; "Show full names" in Settings brings the old
 * layout back for whoever wants it, kept in storage like the other settings.
 *
 * Layout is the point, so this runs in a real Chromium at a side panel's
 * width: jsdom, where the unit tests run, lays nothing out.
 */

import { expect, test, type NativeHarness } from "./harness";

/** About what Chrome opens a side panel at. */
const PANEL_WIDTH = 360;

/** The fixture's heading: on screen in both trees as they open, with no
 *  row to expand first. */
const LONG_NAME =
  "Wikipedia, la enciclopedia libre que cualquiera puede editar en español";

/** The fixture's disabled toggle: its states are what must stay in view. */
const TOGGLE_NAME =
  "Mostrar los nombres completos de los artículos de la enciclopedia";

/** Bring the fixture forward, reload the panel and show `producer`'s tree. */
async function show(
  nav: NativeHarness,
  producer: "DOM" | "NATIVE",
): Promise<void> {
  const { page } = await nav.open("long-names.html");
  await page.bringToFront();
  await nav.panel.reload();
  await nav.chooseTree(producer === "DOM" ? "In-page tree" : "Chrome's tree");
  if (producer === "DOM") {
    // The A11Y view, its default, so a row shows its name as native's does.
    await expect(
      nav.viewToggle().getByRole("button", { name: "A11Y", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  }
  await expect
    .poll(() => nav.panel.locator(".sn-node").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
}

/**
 * Whether the tree scrolls sideways, how the long name's row shows it, and
 * which of the toggle's state badges are in view: inside its label's box,
 * which clips what doesn't fit, rather than on the line it hides. Also
 * whether the toolbar shows every control whole, and its search box at a
 * usable width, rather than pushing one off the panel's edge.
 */
function layout(nav: NativeHarness) {
  return nav.panel.evaluate(
    ([name, toggleName]) => {
      const within = (inner: DOMRect, outer: DOMRect) =>
        inner.width > 0 &&
        inner.left >= outer.left - 0.5 &&
        inner.right <= outer.right + 0.5;
      const viewport = new DOMRect(0, 0, innerWidth, innerHeight);
      const toolbarFits = [
        ...document.querySelectorAll<HTMLElement>(
          '[role="toolbar"].sn-toolbar button',
        ),
      ].every((control) => {
        const group = control.closest(".sn-toggle-group");
        const box = control.getBoundingClientRect();
        return (
          within(box, viewport) &&
          (!group || within(box, group.getBoundingClientRect()))
        );
      });
      const search = document.querySelector(".sn-toolbar .sn-search");
      const searchUsable =
        !search || search.getBoundingClientRect().width >= 60;
      const container = document.querySelector(".sn-tree-container")!;
      const nameSpan = (text: string) =>
        [...document.querySelectorAll<HTMLElement>(".sn-name")].find(
          (el) => el.textContent?.trim() === text,
        );
      const span = nameSpan(name);
      const label = nameSpan(toggleName)?.closest(".sn-label");
      const box = label?.getBoundingClientRect();
      const statesInView = [
        ...(label?.querySelectorAll<HTMLElement>(".sn-state-badge") ?? []),
      ]
        .filter((badge) => {
          const r = badge.getBoundingClientRect();
          return (
            r.width > 0 &&
            r.right <= box!.right + 0.5 &&
            r.bottom <= box!.bottom + 0.5
          );
        })
        .map((badge) => badge.textContent)
        .sort();
      return {
        scrollsSideways: container.scrollWidth > container.clientWidth,
        nameClipped: span ? span.scrollWidth > span.clientWidth : null,
        tooltip: span?.title ?? null,
        statesInView,
        toolbarFits: toolbarFits && searchUsable,
      };
    },
    [LONG_NAME, TOGGLE_NAME] as const,
  );
}

/** Turn "Show full names" on or off, as the user does, from Settings ▾. */
async function setFullNames(nav: NativeHarness, on: boolean): Promise<void> {
  const settings = nav.panel.getByRole("button", { name: "Settings ▾" });
  await settings.click();
  const box = nav.panel.getByRole("checkbox", { name: "Show full names" });
  await box.setChecked(on);
  await settings.click();
  await expect(box).toHaveCount(0);
}

for (const producer of ["NATIVE", "DOM"] as const) {
  test(`${producer}: a long name ends in an ellipsis, and Show full names widens the tree instead`, async ({
    nav,
  }) => {
    const before = nav.panel.viewportSize();
    await nav.panel.setViewportSize({ width: PANEL_WIDTH, height: 720 });
    try {
      await show(nav, producer);
      await expect
        .poll(() => layout(nav))
        .toEqual({
          scrollsSideways: false,
          nameClipped: true,
          tooltip: LONG_NAME,
          // A key state never gives way to the name.
          statesInView: ["disabled", "pressed"],
          // Nor does a toolbar control to the panel's edge: they wrap.
          toolbarFits: true,
        });

      await setFullNames(nav, true);
      await expect
        .poll(() => layout(nav))
        .toMatchObject({ scrollsSideways: true, nameClipped: false });

      // Kept in storage: a panel opened afresh starts with full names.
      await show(nav, producer);
      await expect
        .poll(() => layout(nav))
        .toMatchObject({ scrollsSideways: true, nameClipped: false });

      await setFullNames(nav, false);
      await expect
        .poll(() => layout(nav))
        .toMatchObject({ scrollsSideways: false, nameClipped: true });
    } finally {
      // The worker's panel is shared: leave it as the next test expects.
      await nav.panel.evaluate(() =>
        chrome.storage.local.remove("settings.showFullNames"),
      );
      if (before) await nav.panel.setViewportSize(before);
    }
  });
}
