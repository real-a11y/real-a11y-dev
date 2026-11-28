/**
 * The TIMELINE view (`TimelineView.tsx`, ADR-0002): the top frame's content
 * script runs core's recorder, and the panel shows each line as the page
 * makes it. `timeline.html` deletes the focused draft, which drops focus to
 * nothing: the case the view exists for, since nothing on screen shows it.
 */

import { serializeTimeline } from "@real-a11y-dev/serialize";

import { expect, test } from "./harness";

type PanelPage = import("@playwright/test").Page;

const DROP = [
  'focus     button "Delete draft"',
  "focus     (none)",
  'announce  status "Draft deleted."',
];

const lines = (panel: PanelPage) =>
  panel.getByRole("list", { name: "Timeline" }).locator(".sn-timeline-line");

test("records a focus drop as the page makes it, and stops", async ({
  nav,
}) => {
  const page = await nav.showNative("timeline.html");
  const reads = (await nav.nativeReads()).length;
  await nav.panel
    .getByRole("group", { name: "Native tree view" })
    .getByRole("button", { name: "TIMELINE", exact: true })
    .click();
  const status = nav.panel.locator(".sn-timeline-status");
  await expect(status).toHaveText("Press Record, then use the page.");

  await nav.panel.getByRole("button", { name: "● Record" }).click();
  await expect(status).toHaveText("Recording…");
  // The page's own recorder, not Chrome's tree: recording reads nothing
  // natively. (A click on the page then does, as ever: Chrome's tree
  // follows what the page does after the user acts on it.)
  await nav.panel.waitForTimeout(500);
  expect(await nav.nativeReads()).toHaveLength(reads);

  // The user deletes the draft on the page.
  await page.bringToFront();
  await page.getByRole("button", { name: "Delete draft" }).click();

  await expect(lines(nav.panel)).toHaveText(DROP);
  // The lines are serializeTimeline's, which Copy writes, for the same
  // events: the line format is the one every surface prints.
  expect(DROP.join("\n")).toBe(
    serializeTimeline([
      {
        kind: "focus",
        stop: {
          role: "button",
          name: "Delete draft",
          description: "",
          states: {},
          properties: {},
          isExposedToAT: true,
        },
        hidden: false,
      },
      { kind: "focus", stop: null, hidden: false },
      {
        kind: "announce",
        role: "status",
        text: "Draft deleted.",
        live: "polite",
      },
    ]),
  );

  await nav.panel.getByRole("button", { name: "■ Stop" }).click();
  await expect(status).toHaveText("Stopped — 3 lines.");

  // Stopped means stopped: the page's next focus move is nobody's line.
  await page.getByRole("button", { name: "New draft" }).focus();
  await nav.panel.waitForTimeout(500);
  await expect(lines(nav.panel)).toHaveText(DROP);
});

test("ends at a navigation, keeping what came before it", async ({ nav }) => {
  const page = await nav.showNative("timeline.html");
  await nav.panel
    .getByRole("group", { name: "Native tree view" })
    .getByRole("button", { name: "TIMELINE", exact: true })
    .click();
  await nav.panel.getByRole("button", { name: "● Record" }).click();
  await expect(nav.panel.locator(".sn-timeline-status")).toHaveText(
    "Recording…",
  );

  await page.bringToFront();
  await page.getByRole("button", { name: "New draft" }).focus();
  await expect(lines(nav.panel)).toHaveText(['focus     button "New draft"']);

  await page.goto(page.url().replace("timeline.html", "tab-order.html"));
  await expect(nav.panel.locator(".sn-timeline-status")).toHaveText(
    "Recording ended: the page navigated. 1 line.",
    { timeout: 20_000 },
  );
  await expect(lines(nav.panel)).toHaveText(['focus     button "New draft"']);
  // Its node was on the page that is gone: nothing to show.
  await expect(nav.panel.locator("button.sn-timeline-line")).toHaveCount(0);
});
