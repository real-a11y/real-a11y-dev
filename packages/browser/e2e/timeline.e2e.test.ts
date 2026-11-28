/**
 * End-to-end: the timeline recorder injected into a real Chromium (ADR-0002).
 *
 * Pins what only a real browser can show: each run leaves the page through
 * the CDP binding as it settles, so a navigation keeps what came before; the
 * injection works where a strict CSP with Trusted Types blocks scripts; and a
 * real click's focus moves and announcements come out in the page's order.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e`
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { BrowserSession } from "@real-a11y-dev/browser";
import { serializeTimeline } from "@real-a11y-dev/serialize";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

function dataUrl(html: string): string {
  return "data:text/html," + encodeURIComponent(html);
}

// The delete-draft flow: the click moves focus off the deleted draft's
// button, which goes away, says so, then lands focus on the next control.
const DRAFTS = `<!doctype html><html><head><meta charset="utf-8"><title>drafts</title></head><body>
<main>
  <ul id="list"><li id="draft">Draft 1 <button id="del">Delete draft</button></li></ul>
  <button id="new">New draft</button>
  <p role="status" id="status"></p>
</main>
<script>
  document.getElementById("del").addEventListener("click", async () => {
    const status = document.getElementById("status");
    status.textContent = "Deleting…";
    await new Promise((r) => setTimeout(r, 20));
    document.getElementById("draft").remove();
    await new Promise((r) => setTimeout(r, 20));
    document.getElementById("new").focus();
    status.textContent = "Draft deleted.";
  });
</script>
</body></html>`;

// Chrome refuses a top-level navigation to a `data:` URL, so the two pages
// a link joins are served.
const PAGES: Record<string, string> = {
  "/link": `<!doctype html><title>link</title><main>
    <a id="go" href="/next">Go</a><p role="status" id="s"></p>
    <script>document.getElementById("go").addEventListener("focus", () => {
      document.getElementById("s").textContent = "Leaving soon.";
    });</script></main>`,
  "/next": `<!doctype html><title>next</title><p role="status">Arrived.</p>`,
};

describe("BrowserSession.startTimeline", () => {
  const session = new BrowserSession();
  let server: Server;
  let origin = "";

  beforeAll(async () => {
    server = createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(PAGES[req.url ?? ""] ?? "");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await session.close();
    await new Promise((resolve) => server.close(resolve));
  });

  it("records a real click's focus moves and announcements in order", async () => {
    await session.open(dataUrl(DRAFTS));
    const timeline = await session.startTimeline({ root: "main" });
    const page = (session as unknown as { page: import("playwright").Page })
      .page;
    await page.click("#del");
    await page.waitForFunction(
      () => document.getElementById("status")!.textContent === "Draft deleted.",
    );
    const result = await timeline.stop();
    expect(result.end).toBe("stopped");
    expect(serializeTimeline(result.events)).toBe(
      [
        'focus     button "Delete draft"',
        'announce  status "Deleting…"',
        "focus     (none)",
        'focus     button "New draft"',
        'announce  status "Draft deleted."',
      ].join("\n"),
    );
  });

  it("keeps what came before a navigation, and says the document changed", async () => {
    await session.open(`${origin}/link`);
    const streamed: number[] = [];
    const timeline = await session.startTimeline({
      onEvents: (events) => streamed.push(events.length),
    });
    const page = (session as unknown as { page: import("playwright").Page })
      .page;
    await page.focus("#go");
    await page.waitForFunction(
      () => document.getElementById("s")?.textContent === "Leaving soon.",
    );
    await Promise.all([page.waitForURL(/\/next$/), page.click("#go")]);
    await page.waitForFunction(() => document.title === "next");
    const result = await timeline.stop();
    expect(result.end).toBe("navigated");
    expect(result.url).toBe(`${origin}/next`);
    expect(serializeTimeline(result.events)).toBe(
      ['focus     link "Go"', 'announce  status "Leaving soon."'].join("\n"),
    );
    expect(streamed.reduce((a, b) => a + b, 0)).toBe(result.events.length);
  });

  it("sees a cross-site navigation end it before stop()", async () => {
    // 127.0.0.1 and localhost are different sites, so the new document can
    // come from another renderer process: `ended()` must say so all the same.
    await session.open(`${origin}/link`);
    const timeline = await session.startTimeline();
    const page = (session as unknown as { page: import("playwright").Page })
      .page;
    await page.focus("#go");
    const other = origin.replace("127.0.0.1", "localhost");
    await page.goto(`${other}/next`);
    await expect.poll(() => timeline.ended()).toBe("navigated");
    const result = await timeline.stop();
    expect(result.end).toBe("navigated");
    expect(result.url).toBe(`${other}/next`);
    expect(serializeTimeline(result.events)).toMatch(/^focus {5}link "Go"/);
    // Nothing of the recording is left on the new page.
    expect(
      await page.evaluate(() =>
        Object.keys(globalThis).some((k) =>
          k.startsWith("__realA11yTimeline_"),
        ),
      ),
    ).toBe(false);
  });

  it("injects under a strict CSP with Trusted Types", async () => {
    await session.open(
      dataUrl(`<!doctype html><html><head>
        <meta http-equiv="Content-Security-Policy" content="script-src 'none'; require-trusted-types-for 'script'">
        <title>csp</title></head><body><main><button id="b">Save</button></main></body></html>`),
    );
    const timeline = await session.startTimeline();
    const page = (session as unknown as { page: import("playwright").Page })
      .page;
    await page.focus("#b");
    const result = await timeline.stop();
    expect(serializeTimeline(result.events)).toBe('focus     button "Save"');
  });

  it("names a focused node in strict mode as a strict tree does", async () => {
    await session.open(
      dataUrl(
        `<title>editor</title><main><div contenteditable="true" id="ed">my secret draft</div><button id="a" aria-labelledby="ed">x</button></main>`,
      ),
    );
    const page = (session as unknown as { page: import("playwright").Page })
      .page;
    const record = async (redactInput: boolean) => {
      await page.evaluate(() => (document.activeElement as HTMLElement).blur());
      const timeline = await session.startTimeline({ redactInput });
      await page.focus("#a");
      return serializeTimeline((await timeline.stop()).events);
    };
    // The control: without strict mode the typed text names the button.
    expect(await record(false)).toBe('focus     button "my secret draft"');
    expect(await record(true)).toBe('focus     button "[redacted]"');
  });

  it("refuses a second recording on one document, and a root that matches nothing", async () => {
    await session.open(dataUrl(`<title>one</title><main></main>`));
    await expect(session.startTimeline({ root: "#nope" })).rejects.toThrow(
      /matched no element/,
    );
    const first = await session.startTimeline();
    await expect(session.startTimeline()).rejects.toThrow(/already recording/);
    expect((await first.stop()).end).toBe("stopped");
    // Stopped, the document can record again.
    const again = await session.startTimeline();
    expect((await again.stop()).end).toBe("stopped");
  });
});
