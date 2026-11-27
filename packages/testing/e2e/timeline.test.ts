// `recordTimeline` in a real browser, which runs microtasks between the
// events of a native focus move — with focus on <body> between them — where
// jsdom, driven by script, runs none.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

const dist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../dist",
);

interface TimelinePage {
  recordTimeline(root: Element): { stop(): { text: string } };
  timeline: { stop(): { text: string } };
}

/** Open `body` with the built package imported, over http: Chromium blocks a
 *  module import from `file://`. */
async function open(page: Page, body: string): Promise<void> {
  await page.route("http://timeline.test/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.startsWith("/dist/")) {
      const file = path.join(dist, path.basename(pathname));
      return route.fulfill({
        contentType: "text/javascript",
        body: await readFile(file),
      });
    }
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><body>${body}<script type="module">
        import { recordTimeline } from "/dist/index.js";
        window.recordTimeline = recordTimeline;
      </script></body>`,
    });
  });
  await page.goto("http://timeline.test/");
  await page.waitForFunction(() => "recordTimeline" in window);
}

const FORM = `<main>
  <button id="a">A</button>
  <button id="b">B</button>
  <p role="status" id="s"></p>
</main>`;

test.describe("recordTimeline in a browser", () => {
  test("prints no (none) between the events of a native Tab move", async ({
    page,
  }) => {
    await open(page, FORM);
    await page.evaluate(() => {
      const w = window as unknown as TimelinePage;
      const a = document.getElementById("a")!;
      a.addEventListener("blur", () => {
        document.getElementById("s")!.textContent = "Checked A.";
      });
      a.focus();
      w.timeline = w.recordTimeline(document.querySelector("main")!);
    });
    await page.keyboard.press("Tab");
    const text = await page.evaluate(
      () => (window as unknown as TimelinePage).timeline.stop().text,
    );
    expect(text).toBe(
      [
        `focus     button "A"`,
        `announce  status "Checked A."`,
        `focus     button "B"`,
      ].join("\n"),
    );
  });

  test("puts a focus listener's message after the focus line on a click", async ({
    page,
  }) => {
    await open(page, FORM);
    await page.evaluate(() => {
      const w = window as unknown as TimelinePage;
      document.getElementById("b")!.addEventListener("focus", () => {
        document.getElementById("s")!.textContent = "On B.";
      });
      document.getElementById("a")!.focus();
      w.timeline = w.recordTimeline(document.querySelector("main")!);
    });
    await page.click("#b");
    const text = await page.evaluate(
      () => (window as unknown as TimelinePage).timeline.stop().text,
    );
    expect(text).toBe(
      [
        `focus     button "A"`,
        `focus     button "B"`,
        `announce  status "On B."`,
      ].join("\n"),
    );
  });
});
