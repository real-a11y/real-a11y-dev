/**
 * The in-page tree's toolbar at a side panel's width. A side panel is usually
 * 320–400px wide, and with the in-page tree's controls on one row with the
 * shared toolbar's, everything past the search box took about 510px: the
 * search box shrank to its padding, the DOM / A11Y / TAB views, whose
 * `overflow: hidden` leaves them no minimum width, to nothing, and Copy ▾ ran
 * off the edge, so a click on A11Y landed on the search box. Layout is what
 * jsdom doesn't do, so only a real browser can pin it.
 */

import { expect, test, type NativeHarness } from "./harness";

/**
 * The controls of the two toolbars over the in-page tree, the one both trees
 * share and the in-page tree's own, and what keeps any of them from a click:
 * running past the panel's edge, or another element at its middle, where a
 * click lands. Read in one pass in the page: with the fixture page in front,
 * the panel draws about one frame a second, so each of Playwright's own
 * checks that waits on frames (`toBeInViewport`, a trial click) can take two
 * seconds, and two dozen of them outlast the test.
 */
function reachability(nav: NativeHarness) {
  return nav.panel.evaluate(() => {
    const controls = [
      ...document.querySelectorAll<HTMLElement>('[role="toolbar"]'),
    ]
      .filter((bar) =>
        /^(In-page )?tree controls$/i.test(bar.getAttribute("aria-label")!),
      )
      .flatMap((bar) => [
        ...bar.querySelectorAll<HTMLElement>("button, input"),
      ]);
    const problems: string[] = [];
    for (const control of controls) {
      const name =
        control.getAttribute("aria-label") ?? control.textContent!.trim();
      const box = control.getBoundingClientRect();
      if (
        box.left < 0 ||
        box.top < 0 ||
        box.right > innerWidth ||
        box.bottom > innerHeight
      ) {
        problems.push(`${name} runs past the panel's edge`);
        continue;
      }
      const hit = document.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2,
      );
      if (!hit || !control.contains(hit)) {
        problems.push(`${name} is under ${hit?.outerHTML.slice(0, 60)}`);
      }
    }
    const search = document.querySelector(
      'input[aria-label="Search tree nodes"]',
    );
    return {
      count: controls.length,
      problems,
      searchWidth: search?.getBoundingClientRect().width ?? 0,
    };
  });
}

async function expectAllReachable(nav: NativeHarness): Promise<void> {
  const { count, problems, searchWidth } = await reachability(nav);
  // The shared toolbar's picker, curtain, Focus sync and Copy ▾, and the
  // in-page tree's search box, its three views, refresh, expand and collapse.
  expect(count).toBe(11);
  expect(problems).toEqual([]);
  // Room to type in: the narrow panel left it its 18px of padding.
  expect(searchWidth).toBeGreaterThanOrEqual(48);
}

for (const width of [320, 360, 400]) {
  test(`at ${width}px the in-page tree's toolbar keeps every control on screen, and DOM, A11Y and TAB take a click`, async ({
    nav,
  }) => {
    const { page } = await nav.open("tabs.html");
    await page.bringToFront();
    await nav.panel.reload();
    await nav.chooseTree("In-page tree");
    await expect
      .poll(() => nav.panel.locator(".sn-node").count(), { timeout: 20_000 })
      .toBeGreaterThan(0);

    // The panel page is shared by every test in the worker.
    const size = nav.panel.viewportSize();
    await nav.panel.setViewportSize({ width, height: size?.height ?? 720 });
    try {
      await expectAllReachable(nav);

      // A11Y shows first, so each click changes the view.
      for (const view of ["TAB", "DOM", "A11Y"]) {
        const button = nav
          .viewToggle()
          .getByRole("button", { name: view, exact: true });
        await button.click();
        await expect(button).toHaveAttribute("aria-pressed", "true");
      }

      // A search's match count takes room too: it goes on the row where
      // there is some, and under it where there isn't, never in a control's
      // way.
      await nav.panel
        .getByRole("searchbox", { name: "Search tree nodes" })
        .fill("Nils");
      await expect(nav.panel.locator(".sn-search-count")).toHaveText(
        /^[1-9]\d* match/,
      );
      await expectAllReachable(nav);
    } finally {
      if (size) await nav.panel.setViewportSize(size);
    }
  });
}
