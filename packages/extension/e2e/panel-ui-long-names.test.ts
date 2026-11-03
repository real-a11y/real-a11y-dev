/**
 * Long names in a side panel's width, in Chrome's tree and the TAB view's
 * list.
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

/** Too narrow for the toggle's row to fit its role, the start of its name
 *  and both its key states. */
const NARROW_WIDTH = 200;

/** The fixture's heading: on screen as the tree opens, with no row to
 *  expand first. */
const LONG_NAME =
  "Wikipedia, la enciclopedia libre que cualquiera puede editar en español";

/** The fixture's disabled toggle: its key states are what must stay in
 *  view. */
const TOGGLE_NAME =
  "Mostrar los nombres completos de los artículos de la enciclopedia";

/** The fixture's long link: a tab stop, so the TAB view lists it. */
const LINK_NAME =
  "Página principal de la enciclopedia libre y políglota de la Fundación Wikimedia";

/** Bring the fixture forward, reload the panel and show Chrome's tree. */
async function show(nav: NativeHarness): Promise<void> {
  await nav.showNative("long-names.html");
}

/**
 * Whether the tree scrolls sideways, which rows are wider than the panel,
 * how the long name's row shows it, and which of the toggle's state badges
 * show: painted once scrolled to, rather than clipped by the label they
 * used to sit in. Also whether the toolbar shows every control whole, and
 * its search box at a usable width, rather than pushing one off the panel's
 * edge.
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
      const toggleRow = nameSpan(toggleName)?.closest(".sn-node");
      const statesInView = [
        ...(toggleRow?.querySelectorAll<HTMLElement>(".sn-state-badge") ?? []),
      ]
        .filter((badge) => {
          // Scroll the tree to it, and only the tree: `scrollIntoView` would
          // also scroll a clipping box, which no user can.
          const view = container.getBoundingClientRect();
          const at = badge.getBoundingClientRect();
          const right = view.left + container.clientWidth;
          const bottom = view.top + container.clientHeight;
          if (at.right > right) container.scrollLeft += at.right - right;
          else if (at.left < view.left)
            container.scrollLeft -= view.left - at.left;
          if (at.bottom > bottom) container.scrollTop += at.bottom - bottom;
          else if (at.top < view.top) container.scrollTop -= view.top - at.top;
          const r = badge.getBoundingClientRect();
          const hit = document.elementFromPoint(
            r.left + r.width / 2,
            r.top + r.height / 2,
          );
          return r.width > 0 && hit !== null && badge.contains(hit);
        })
        .map((badge) => badge.textContent)
        .sort();
      container.scrollLeft = 0;
      container.scrollTop = 0;
      const wideRows = [...document.querySelectorAll<HTMLElement>(".sn-node")]
        .filter((row) => row.offsetWidth > container.clientWidth)
        .map(
          (row) =>
            row.querySelector(".sn-name")?.textContent?.trim() ??
            row.querySelector(".sn-role")?.textContent,
        );
      return {
        scrollsSideways: container.scrollWidth > container.clientWidth,
        wideRows,
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

test("a long name ends in an ellipsis, and Show full names widens the tree instead", async ({
  nav,
}) => {
  const before = nav.panel.viewportSize();
  await nav.panel.setViewportSize({ width: PANEL_WIDTH, height: 720 });
  try {
    await show(nav);
    await expect
      .poll(() => layout(nav))
      .toEqual({
        scrollsSideways: false,
        wideRows: [],
        nameClipped: true,
        tooltip: LONG_NAME,
        // A key state never gives way to the name.
        statesInView: ["disabled", "pressed"],
        // Nor does a toolbar control to the panel's edge: they wrap.
        toolbarFits: true,
      });
    // A screen reader hears them right after the name, though they show
    // after the label: the badges are hidden from it.
    await expect(
      nav.panel.getByRole("treeitem", {
        name: new RegExp(
          `^button "${TOGGLE_NAME}" (disabled, pressed|pressed, disabled) `,
        ),
      }),
    ).toHaveCount(1);

    await setFullNames(nav, true);
    await expect
      .poll(() => layout(nav))
      .toMatchObject({ scrollsSideways: true, nameClipped: false });

    // Kept in storage: a panel opened afresh starts with full names.
    await show(nav);
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

test("a row too narrow for its key states widens, alone, rather than clip them", async ({
  nav,
}) => {
  const before = nav.panel.viewportSize();
  await nav.panel.setViewportSize({ width: NARROW_WIDTH, height: 720 });
  try {
    await show(nav);
    await expect
      .poll(() => layout(nav))
      .toMatchObject({
        scrollsSideways: true,
        // The toggle's row, by just enough for its states; no other.
        wideRows: [TOGGLE_NAME],
        nameClipped: true,
        statesInView: ["disabled", "pressed"],
      });
  } finally {
    if (before) await nav.panel.setViewportSize(before);
  }
});

test("the TAB view ends a long name in an ellipsis too, and Show full names widens its list", async ({
  nav,
}) => {
  const before = nav.panel.viewportSize();
  await nav.panel.setViewportSize({ width: PANEL_WIDTH, height: 720 });
  /** How the list shows the long link's stop. */
  const stop = () =>
    nav.panel.evaluate((name) => {
      const list = document.querySelector<HTMLElement>(
        '[aria-label="Tab sequence"]',
      )!;
      const span = [...list.querySelectorAll<HTMLElement>(".sn-tab-name")].find(
        (el) => el.textContent === name,
      );
      return {
        scrollsSideways: list.scrollWidth > list.clientWidth,
        nameClipped: span ? span.scrollWidth > span.clientWidth : null,
        tooltip: span?.title ?? null,
      };
    }, LINK_NAME);
  try {
    await nav.showTabOrder("long-names.html");
    await expect.poll(stop).toEqual({
      scrollsSideways: false,
      nameClipped: true,
      tooltip: LINK_NAME,
    });

    await setFullNames(nav, true);
    await expect
      .poll(stop)
      .toMatchObject({ scrollsSideways: true, nameClipped: false });
  } finally {
    await nav.panel.evaluate(() =>
      chrome.storage.local.remove("settings.showFullNames"),
    );
    if (before) await nav.panel.setViewportSize(before);
  }
});
