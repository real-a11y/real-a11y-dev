/**
 * The dogfood panel's own UI — a deliberately small set.
 *
 * Every other file here drives the extension at the MESSAGE level, which is
 * where the regression risk actually lives: dispatch fidelity against real
 * widget markup. But a message-level test cannot see a panel-wiring bug — a
 * role whose predicate says "actionable" and which renders no button anyway, or
 * a button wired to the wrong action. Round 7 was exactly that shape: the
 * dispatch mechanism was already correct for `menuitemradio`, and only the
 * panel's own allowlist was behind.
 *
 * So these tests render the real panel against a real tree and read what it
 * offers. They are smoke tests, not a second copy of the suite: per-role
 * assertions belong in the pattern files.
 *
 * Two mechanics are load-bearing here, and getting either wrong produces a test
 * that passes for the wrong reason:
 *
 *  - **Everything is scoped to the dogfood `<details>`.** The side panel also
 *    renders the PRODUCTION DOM/A11Y tree view, which serializes nodes in the
 *    same `role "name"` grammar. An unscoped `toContain('tab "Nils Frahm"')`
 *    passes against the production tree whether the dogfood panel rendered
 *    anything or not.
 *  - **The fixture tab stays in the foreground.** The panel resolves its target
 *    with `chrome.tabs.query({ active: true, currentWindow: true })`, so
 *    Playwright's own click/fill — which bring their page to front — would
 *    retarget it. Hence `evaluate` and a real `.click()` on the element, which
 *    Preact's `onClick` receives exactly as it would a user's.
 */

import { expect, test, type NativeHarness } from "./harness";

type PanelPage = import("@playwright/test").Page;

/**
 * Open the dogfood `<details>` and load the native tree, waiting until the row
 * `expected` names is really rendered.
 *
 * The press is POLLED rather than fired once: the panel's mount effects (flag
 * read, capability pre-flight) are async, and a press that lands before the
 * flag arrives is a silent no-op, not an error. Polling on the button's own
 * label instead would be self-satisfying — "Load native tree" contains the very
 * words a loaded tree would — so the wait is on a node row the fixture
 * produces and the empty panel cannot.
 */
async function openDogfoodPanel(
  panel: PanelPage,
  expected: string,
): Promise<void> {
  await panel.reload();
  await expect
    .poll(
      () =>
        panel.evaluate((want) => {
          const section = [...document.querySelectorAll("details")].find((d) =>
            d
              .querySelector("summary")
              ?.textContent?.includes("chrome.debugger"),
          );
          if (!section) return false;
          section.open = true;
          if (section.innerText.includes(want)) return true;
          [...section.querySelectorAll("button")]
            .find((b) => b.textContent?.trim() === "Load native tree")
            ?.click();
          return false;
        }, expected),
      { timeout: 20_000 },
    )
    .toBe(true);
}

/** Text of the dogfood section only — never the production tree view's. */
function panelText(panel: PanelPage): Promise<string> {
  return panel.evaluate(
    () =>
      [...document.querySelectorAll("details")].find((d) =>
        d.querySelector("summary")?.textContent?.includes("chrome.debugger"),
      )!.innerText,
  );
}

/** Every button inside the dogfood section, as `{ title, text }`. */
function panelButtons(
  panel: PanelPage,
): Promise<Array<{ title: string; text: string }>> {
  return panel.evaluate(() =>
    [
      ...[...document.querySelectorAll("details")]
        .find((d) =>
          d.querySelector("summary")?.textContent?.includes("chrome.debugger"),
        )!
        .querySelectorAll("button"),
    ].map((b) => ({ title: b.title, text: (b.textContent ?? "").trim() })),
  );
}

/** Bring a fixture to the foreground and load it into the dogfood panel. */
async function show(
  nav: NativeHarness,
  fixture: string,
  expected: string,
): Promise<import("@playwright/test").Page> {
  const { page } = await nav.open(fixture);
  await page.bringToFront();
  await openDogfoodPanel(nav.panel, expected);
  return page;
}

test("the panel renders the tree it was asked for", async ({ nav }) => {
  await show(nav, "tabs.html", 'tab "Nils Frahm"');

  // The whole row as the panel formats it — role, name and `formatFacets`'s
  // badge group in one assertion, so a change to any of the three is visible
  // here rather than only in `formatFacets`'s own unit tests.
  await expect
    .poll(() => panelText(nav.panel))
    .toContain('tab "Nils Frahm" [focusable selected]');
  await expect
    .poll(() => panelText(nav.panel))
    .toContain('tab "Agnes Obel" [focusable]');
});

/**
 * The affordance check round 7 would have failed: every menuitem-family row
 * offered as a button, and the containers around them rendered as plain rows.
 */
test("actionable roles get a button and inert ones do not", async ({ nav }) => {
  await show(nav, "menu-menubar.html", "menuitemradio");
  await expect.poll(() => panelText(nav.panel)).toContain("menuitemradio");

  const buttons = await panelButtons(nav.panel);
  for (const name of ["Serif", "Sans-serif", "Bold", "Italic", "Font"]) {
    expect(
      buttons.some((b) => b.text.includes(`"${name}"`)),
      `expected an actionable row for ${name}`,
    ).toBe(true);
  }

  // The menubar and menu containers are on the tree, but not as buttons.
  expect(await panelText(nav.panel)).toContain('menubar "Text Formatting"');
  expect(buttons.some((b) => b.text.includes("menubar"))).toBe(false);
  expect(buttons.some((b) => b.text.startsWith("menu "))).toBe(false);
});

/** A slider gets step buttons and NO wide click button — the split
 *  `isSteppableRole` exists to make, and the reason `ACTABLE` deliberately
 *  excludes `slider`. */
test("a slider row offers step buttons, not a click", async ({ nav }) => {
  await show(nav, "slider-multithumb.html", 'slider "Minimum price"');
  await expect
    .poll(() => panelText(nav.panel))
    .toContain('slider "Minimum price"');

  const buttons = await panelButtons(nav.panel);
  expect(
    buttons.filter((b) => b.title === 'Increment "Minimum price"'),
  ).toHaveLength(1);
  expect(
    buttons.filter((b) => b.title === 'Decrement "Minimum price"'),
  ).toHaveLength(1);
  expect(buttons.some((b) => b.text.includes('slider "Minimum price"'))).toBe(
    false,
  );
});

/** The whole path a dogfooder actually takes — panel button included — ending
 *  in the real widget moving. */
test("pressing the panel's + steps the real widget", async ({ nav }) => {
  const page = await show(
    nav,
    "slider-multithumb.html",
    'slider "Minimum price"',
  );
  await expect
    .poll(() => panelText(nav.panel))
    .toContain('slider "Minimum price"');

  await nav.panel.evaluate(() => {
    const plus = [...document.querySelectorAll("button")].find(
      (b) => b.title === 'Increment "Minimum price"',
    );
    if (!plus) throw new Error("no increment button for the minimum thumb");
    plus.click();
  });

  await expect(page.locator("#min-thumb")).toHaveAttribute(
    "aria-valuenow",
    "26",
  );
});

/** An `option` row gets the dedicated `select` action (round 15), not the
 *  generic click `ACTABLE` still withholds from the role. */
test("a native select's option rows are offered as actionable", async ({
  nav,
}) => {
  const page = await show(nav, "listbox-select.html", 'option "Books"');
  await expect.poll(() => panelText(nav.panel)).toContain('option "Books"');

  await nav.panel.evaluate(() => {
    const row = [...document.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes('option "Books"'),
    );
    if (!row) throw new Error("no actionable row for the Books option");
    row.click();
  });

  await expect(page.locator("#department")).toHaveValue("books");
  await expect(page.locator("#department-echo")).toHaveText("books");
});
