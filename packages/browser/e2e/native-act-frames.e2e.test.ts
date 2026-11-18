/**
 * Acting inside frames Chromium runs in another process, in real Chromium.
 *
 * Under site isolation a cross-site or sandboxed `<iframe>` runs in a renderer
 * process of its own, where backend node ids restart: an action has to reach the
 * frame's own session, or it lands on whichever element of the page happens to
 * hold the same number. Playwright's bundled headless shell keeps every frame in
 * the page's process unless told otherwise, hence `--site-per-process`.
 *
 * Every document here reports its clicks into its own heading, so a read of the
 * tree shows where an action landed. `127.0.0.1` and `localhost` are two sites.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e native-act-frames`
 */

import { createServer, type Server } from "node:http";
import { createServer as createNetServer, type AddressInfo } from "node:net";

import { BrowserSession } from "@real-a11y-dev/browser";
import type { ExtractionResult, SemanticNode } from "@real-a11y-dev/core";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SECRET = "hunter2-ACT-E2E";

/** Reports every click in the document into its heading. */
const reporter = (idle: string) => `<h2 id="out">${idle}</h2>
<script>
  document.addEventListener("click", (e) => {
    if (e.target.matches("button, a")) {
      document.getElementById("out").textContent = "clicked " + e.target.textContent;
    }
  });
</script>`;

const INNER = `<!doctype html><title>Inner</title>
${reporter("inner idle")}
<button>Inner button</button>`;

const WIDGET = (homePort: number) => `<!doctype html><title>Widget</title>
${reporter("widget idle")}
<button>Widget button</button>
<button disabled>Widget disabled</button>
<label>Echo <input oninput="document.getElementById('out').textContent = 'typed ' + this.value.length"></label>
<label>Password <input type="password"></label>
<a href="/next.html">Leave</a>
<iframe title="same process" src="/inner.html"></iframe>
<iframe title="back home" src="http://127.0.0.1:${homePort}/inner.html"></iframe>
<iframe title="sandboxed inside" sandbox="allow-scripts" src="/inner.html"></iframe>`;

const NEXT = `<!doctype html><title>Next</title>
${reporter("next idle")}
<button>Next button</button>`;

const QUIET = `<!doctype html><title>Quiet</title>
<label>Agree <input type="checkbox"></label>
<label>Quiet field <input></label>`;

const TOP = (otherPort: number) => `<!doctype html><title>Top</title>
<main>
  ${reporter("top idle")}
  <button>Top button</button>
  <button onclick="document.querySelector('[title=widget]').remove()">Remove the widget</button>
  <iframe title="widget" src="http://localhost:${otherPort}/widget.html"></iframe>
  <iframe title="own origin, sandboxed" sandbox="allow-scripts" src="/inner.html"></iframe>
  <iframe title="no scripts" sandbox src="/quiet.html"></iframe>
</main>`;

let home: Server;
let other: Server;
let url: string;
let browser: Browser;
let cdpEndpoint: string;

function serve(handler: (path: string) => string): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.setHeader("content-type", "text/html");
      res.end(handler(req.url ?? "/"));
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const portOf = (server: Server) => (server.address() as AddressInfo).port;

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createNetServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

beforeAll(async () => {
  let homePort = 0;
  other = await serve((path) => {
    if (path === "/inner.html") return INNER;
    if (path === "/next.html") return NEXT;
    return WIDGET(homePort);
  });
  home = await serve((path) => {
    if (path === "/inner.html") return INNER;
    if (path === "/quiet.html") return QUIET;
    return TOP(portOf(other));
  });
  homePort = portOf(home);
  url = `http://127.0.0.1:${homePort}/`;

  const port = await freePort();
  cdpEndpoint = `http://127.0.0.1:${port}`;
  browser = await chromium.launch({
    args: ["--site-per-process", `--remote-debugging-port=${port}`],
  });
});

afterAll(async () => {
  await browser.close();
  home.close();
  other.close();
});

async function onPage(run: (session: BrowserSession) => Promise<void>) {
  const session = new BrowserSession({ cdpEndpoint });
  try {
    await session.open(url);
    await run(session);
  } finally {
    await session.close();
  }
}

const nodesOf = (tree: ExtractionResult) => [...tree.nodes.values()];

/** The `Iframe` row titled `title`. */
function rowOf(tree: ExtractionResult, title: string): SemanticNode {
  const row = nodesOf(tree).find(
    (n) => n.a11y.role === "Iframe" && n.a11y.name === title,
  );
  if (!row) throw new Error(`no Iframe row "${title}"`);
  return row;
}

/** Every node below `root`. */
function below(tree: ExtractionResult, root: SemanticNode): SemanticNode[] {
  return root.childIds.flatMap((id) => {
    const node = tree.nodes.get(id);
    return node ? [node, ...below(tree, node)] : [];
  });
}

/** The nodes of the document under `row`, or of the page with no `row`, without
 *  those of the frames nested in it. */
function ownNodes(tree: ExtractionResult, row?: SemanticNode): SemanticNode[] {
  const nodes = row ? below(tree, row) : nodesOf(tree);
  const nested = new Set(
    nodes
      .filter((n) => n.a11y.role === "Iframe")
      .flatMap((n) => below(tree, n).map((c) => c.id)),
  );
  return nodes.filter((n) => !nested.has(n.id));
}

/** The node named `name` in the document under `row`. */
function inFrame(
  tree: ExtractionResult,
  row: SemanticNode,
  name: string,
): SemanticNode {
  const node = ownNodes(tree, row).find((n) => n.a11y.name === name);
  if (!node) throw new Error(`no "${name}" under "${row.a11y.name}"`);
  return node;
}

/** What the heading of the document under `row`, or of the page, reports. */
function report(tree: ExtractionResult, row?: SemanticNode): string {
  const heading = ownNodes(tree, row).find((n) => n.a11y.role === "heading");
  return heading?.a11y.name ?? "";
}

describe("session.act() in a frame in another process", () => {
  it("clicks inside the frame, and nothing on the page", async () => {
    await onPage(async (session) => {
      const tree = await session.nativeTree();
      const button = inFrame(tree, rowOf(tree, "widget"), "Widget button");
      expect(button.id).toContain("@");

      const res = await session.act({ nodeId: button.id, action: "click" });

      expect(res).toEqual({ success: true });
      const after = await session.nativeTree();
      expect(report(after, rowOf(after, "widget"))).toBe(
        "clicked Widget button",
      );
      expect(report(after)).toBe("top idle");
    });
  });

  it("types into the frame's field, and returns none of it", async () => {
    await onPage(async (session) => {
      const tree = await session.nativeTree();
      const row = rowOf(tree, "widget");

      const echo = await session.act({
        nodeId: inFrame(tree, row, "Echo").id,
        action: "type",
        payload: { value: "hello" },
      });
      const secret = await session.act({
        nodeId: inFrame(tree, row, "Password").id,
        action: "type",
        payload: { value: SECRET },
      });

      expect(echo).toEqual({ success: true });
      expect(secret).toEqual({ success: true });
      const after = await session.nativeTree();
      const afterRow = rowOf(after, "widget");
      expect(report(after, afterRow)).toBe("typed 5");
      expect(inFrame(after, afterRow, "Echo").a11y.value).toBe("hello");
      expect(inFrame(after, afterRow, "Password").a11y.value).toBe(
        "[redacted]",
      );
      expect(JSON.stringify(secret)).not.toContain(SECRET);
    });
  });

  it("moves focus into the frame", async () => {
    await onPage(async (session) => {
      const tree = await session.nativeTree();
      const field = inFrame(tree, rowOf(tree, "widget"), "Echo");

      const res = await session.act({ nodeId: field.id, action: "focus" });

      expect(res).toMatchObject({ success: true, requiresInput: true });
      const after = await session.nativeTree();
      expect(after.focusedId).toBe(field.id);
    });
  });

  it.each([
    ["a frame in that frame's own process", "same process"],
    ["a frame back on the page's site", "back home"],
    ["a sandboxed frame inside it", "sandboxed inside"],
  ])("reaches %s", async (_label, title) => {
    await onPage(async (session) => {
      const tree = await session.nativeTree();
      const button = inFrame(tree, rowOf(tree, title), "Inner button");

      const res = await session.act({ nodeId: button.id, action: "click" });

      expect(res).toEqual({ success: true });
      const after = await session.nativeTree();
      expect(report(after, rowOf(after, title))).toBe("clicked Inner button");
      expect(report(after, rowOf(after, "widget"))).toBe("widget idle");
      expect(report(after)).toBe("top idle");
    });
  });

  it("works in a sandboxed frame that may not run scripts", async () => {
    await onPage(async (session) => {
      const tree = await session.nativeTree();
      const row = rowOf(tree, "no scripts");

      const box = await session.act({
        nodeId: inFrame(tree, row, "Agree").id,
        action: "click",
      });
      const field = await session.act({
        nodeId: inFrame(tree, row, "Quiet field").id,
        action: "type",
        payload: { value: "still typed" },
      });

      expect(box).toEqual({ success: true });
      expect(field).toEqual({ success: true });
      const after = await session.nativeTree();
      const afterRow = rowOf(after, "no scripts");
      expect(inFrame(after, afterRow, "Agree").a11y.states.checked).toBe(true);
      expect(inFrame(after, afterRow, "Quiet field").a11y.value).toBe(
        "still typed",
      );
    });
  });

  it("refuses a node once its frame shows another document", async () => {
    await onPage(async (session) => {
      const tree = await session.nativeTree();
      const row = rowOf(tree, "widget");
      const stale = inFrame(tree, row, "Widget button");

      const leave = await session.act({
        nodeId: inFrame(tree, row, "Leave").id,
        action: "click",
      });
      expect(leave).toEqual({ success: true });
      await expect
        .poll(async () => {
          const now = await session.nativeTree();
          return report(now, rowOf(now, "widget"));
        })
        .toBe("next idle");

      const res = await session.act({ nodeId: stale.id, action: "click" });

      expect(res.success).toBe(false);
      expect(res.error).toMatch(/could not resolve node/);
      const after = await session.nativeTree();
      const afterRow = rowOf(after, "widget");
      expect(report(after, afterRow)).toBe("next idle");

      // The new document is reachable through the ids a fresh read gives.
      const next = await session.act({
        nodeId: inFrame(after, afterRow, "Next button").id,
        action: "click",
      });
      expect(next).toEqual({ success: true });
      const last = await session.nativeTree();
      expect(report(last, rowOf(last, "widget"))).toBe("clicked Next button");
    });
  });

  it("refuses a node once its frame is gone", async () => {
    await onPage(async (session) => {
      const tree = await session.nativeTree();
      const stale = inFrame(tree, rowOf(tree, "widget"), "Widget button");
      const remove = nodesOf(tree).find(
        (n) => n.a11y.name === "Remove the widget",
      )!;

      expect(await session.act({ nodeId: remove.id, action: "click" })).toEqual(
        { success: true },
      );
      await expect
        .poll(async () =>
          nodesOf(await session.nativeTree()).some(
            (n) => n.a11y.name === "widget",
          ),
        )
        .toBe(false);

      const res = await session.act({ nodeId: stale.id, action: "click" });

      expect(res.success).toBe(false);
      expect(res.error).toMatch(/could not resolve node/);
    });
  });

  it("stays out of a frame a pinned session doesn't read", async () => {
    await onPage(async (session) => {
      const tree = await session.nativeTree();
      const button = inFrame(tree, rowOf(tree, "widget"), "Widget button");
      const own = inFrame(
        tree,
        rowOf(tree, "own origin, sandboxed"),
        "Inner button",
      );

      // Pins this document where it stands, so its ids stay current.
      session.assertAllowedOrigin(url, [new URL(url).origin]);

      const refused = await session.act({ nodeId: button.id, action: "click" });
      expect(refused.success).toBe(false);
      expect(refused.error).toMatch(/not allowed to read/);

      const allowed = await session.act({ nodeId: own.id, action: "click" });
      expect(allowed).toEqual({ success: true });
      const after = await session.nativeTree();
      expect(report(after, rowOf(after, "own origin, sandboxed"))).toBe(
        "clicked Inner button",
      );
    });
  });
});
