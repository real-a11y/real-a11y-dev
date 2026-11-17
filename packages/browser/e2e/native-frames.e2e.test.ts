/**
 * A page of `<iframe>`s, read by the native producer in real Chromium.
 *
 * `Accessibility.getFullAXTree` with no `frameId` returns the top frame's
 * document only: every `Iframe` row came back empty, so an embedded form,
 * payment frame or widget was never printed, audited or snapshotted. The
 * producer now reads each frame of the page's own renderer process with
 * `{ frameId }` and grafts it under its row.
 *
 * Which frames share that process depends on the browser. Playwright's
 * bundled headless shell runs every frame in it, even a cross-site one. A
 * site-isolated Chrome (the one `real-a11y install` fetches, or any Chrome
 * reached over `--cdp`) runs a cross-site or sandboxed frame in a process of
 * its own, which this producer does not read yet: those rows stay empty. The
 * second block launches with `--site-per-process` to pin both halves.
 *
 * Two local origins on `127.0.0.1` are the same site; `localhost` is another.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e native-frames`
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { collectFindings } from "@real-a11y-dev/audit";
import { BrowserSession, nativeTree } from "@real-a11y-dev/browser";
import type { ExtractionResult, SemanticNode } from "@real-a11y-dev/core";
import { serializeTree } from "@real-a11y-dev/serialize";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CARD = "4111111111111111";
const PASSWORD = "hunter2-FRAME-E2E";

const CHILD = `<!doctype html><title>Child</title>
<h1>Widget</h1>
<main><button>Child button</button><p>Child paragraph</p></main>`;

const PAY = `<!doctype html><title>Pay</title>
<label>Card number <input autocomplete="cc-number" value="${CARD}"></label>
<label>Password <input type="password" value="${PASSWORD}"></label>
<label>Name on card <input value="Ada Lovelace"></label>`;

/** A chain of frames, each holding the next: `/deep/1` … `/deep/7`. */
const deep = (level: number) =>
  `<!doctype html><title>Deep ${level}</title><p>Level ${level}</p>` +
  (level < 7
    ? `<iframe title="deep ${level + 1}" src="/deep/${level + 1}"></iframe>`
    : "");

let other: Server;
let home: Server;
let otherPort: number;
let url: string;

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

beforeAll(async () => {
  other = await serve((path) => {
    if (path === "/pay.html") return PAY;
    if (path === "/nested.html") {
      return `<!doctype html><title>Nested</title><p>Level 1</p>
<iframe title="inner" src="http://127.0.0.1:${otherPort}/child.html"></iframe>`;
    }
    return CHILD;
  });
  otherPort = portOf(other);
  home = await serve((path) => {
    if (path === "/child.html") return CHILD;
    const level = /^\/deep\/(\d+)$/.exec(path);
    if (level) return deep(Number(level[1]));
    const srcdoc = `<button>Srcdoc button</button><button></button>`;
    return `<!doctype html><title>Top</title>
<main>
  <h1>Top</h1>
  <iframe title="srcdoc" srcdoc="${srcdoc}"></iframe>
  <iframe title="same-origin" id="same" src="/child.html"></iframe>
  <iframe title="cross-origin" src="http://127.0.0.1:${otherPort}/child.html"></iframe>
  <iframe title="cross-site" src="http://localhost:${otherPort}/child.html"></iframe>
  <iframe title="pay" src="http://127.0.0.1:${otherPort}/pay.html"></iframe>
  <iframe title="nested" src="http://127.0.0.1:${otherPort}/nested.html"></iframe>
  <iframe title="sandboxed" sandbox src="/child.html"></iframe>
  <iframe title="blank"></iframe>
  <iframe title="hidden" style="display:none" src="/child.html"></iframe>
  <div aria-hidden="true"><iframe title="aria-hidden" src="/child.html"></iframe></div>
  <iframe title="deep 1" src="/deep/1"></iframe>
  <p>After frames</p>
</main>`;
  });
  url = `http://127.0.0.1:${portOf(home)}/`;
});

afterAll(async () => {
  await new Promise((resolve) => home.close(resolve));
  await new Promise((resolve) => other.close(resolve));
});

const nodesOf = (tree: ExtractionResult) => [...tree.nodes.values()];

/** The row of the `<iframe>` titled `title`. */
function rowOf(tree: ExtractionResult, title: string): SemanticNode {
  const row = nodesOf(tree).find(
    (n) => n.a11y.role === "Iframe" && n.a11y.name === title,
  );
  if (!row) throw new Error(`no Iframe "${title}" row`);
  return row;
}

/** Every node under `row`, as `role "name"`. */
function inside(tree: ExtractionResult, row: SemanticNode): string[] {
  const out: string[] = [];
  const visit = (id: string) => {
    const node = tree.nodes.get(id)!;
    out.push(
      node.a11y.name ? `${node.a11y.role} "${node.a11y.name}"` : node.a11y.role,
    );
    node.childIds.forEach(visit);
  };
  row.childIds.forEach(visit);
  return out;
}

const CHILD_CONTENT = [
  'heading "Widget"',
  "main",
  'button "Child button"',
  'paragraph "Child paragraph"',
];

async function load(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "load" });
  return page;
}

describe("native tree — frames in the page's own process", () => {
  let browser: Browser;
  let page: Page;
  let tree: ExtractionResult;

  beforeAll(async () => {
    browser = await chromium.launch();
    page = await load(browser);
    tree = await nativeTree(page);
  });

  afterAll(async () => {
    await browser.close();
  });

  it("puts each frame's content under its Iframe row, one level deeper", () => {
    expect(inside(tree, rowOf(tree, "srcdoc"))).toEqual([
      'button "Srcdoc button"',
      "button",
    ]);
    for (const title of [
      "same-origin",
      "cross-origin",
      "cross-site",
      "sandboxed",
    ]) {
      expect(inside(tree, rowOf(tree, title)), title).toEqual(CHILD_CONTENT);
    }
    expect(inside(tree, rowOf(tree, "nested"))).toEqual([
      'paragraph "Level 1"',
      'Iframe "inner"',
      ...CHILD_CONTENT,
    ]);
    expect(rowOf(tree, "blank").childIds).toEqual([]);
    const row = rowOf(tree, "srcdoc");
    for (const id of row.childIds) {
      expect(tree.nodes.get(id)!.depth).toBe(row.depth + 1);
    }
  });

  it("keeps one root and the native stamp", () => {
    expect(nodesOf(tree).filter((n) => n.parentId === null)).toHaveLength(1);
    expect(tree.source.producer).toBe("native");
  });

  it("leaves out a frame whose row the tree drops (display:none, aria-hidden)", () => {
    const printed = serializeTree(tree);
    expect(printed).not.toContain('Iframe "hidden"');
    expect(printed).not.toContain('Iframe "aria-hidden"');
    expect(
      nodesOf(tree).filter((n) => n.a11y.name === "Child button"),
    ).toHaveLength(5); // same-origin, cross-origin, cross-site, sandboxed, nested's inner
  });

  it("follows nested frames five deep, then leaves the next row empty", () => {
    const printed = serializeTree(tree);
    for (let level = 1; level <= 5; level++) {
      expect(printed).toContain(`paragraph "Level ${level}"`);
    }
    expect(printed).not.toContain('paragraph "Level 6"');
    expect(rowOf(tree, "deep 6").childIds).toEqual([]);
  });

  it("locates a frame's node from its <iframe>, across ' >>> '", () => {
    const srcdoc = rowOf(tree, "srcdoc");
    const button = tree.nodes.get(srcdoc.childIds[1])!;
    expect(button.dom?.locator).toBe(
      `${srcdoc.dom?.locator} >>> body > button:nth-of-type(2)`,
    );
    const same = rowOf(tree, "same-origin");
    expect(same.dom?.locator).toBe("#same");
    const childButton = nodesOf(tree).find(
      (n) => n.a11y.name === "Child button",
    )!;
    expect(childButton.dom?.locator).toBe("#same >>> body > main > button");
  });

  it("redacts a card number and a password inside a frame, and shows a plain value", () => {
    const fields = inside(tree, rowOf(tree, "pay"));
    expect(fields).toEqual([
      'textbox "Card number"',
      'textbox "Password"',
      'textbox "Name on card"',
    ]);
    const printed = serializeTree(tree, { values: true });
    expect(printed).toContain('textbox "Card number" = "[redacted]"');
    expect(printed).toContain('textbox "Password" = "[redacted]"');
    expect(printed).toContain('textbox "Name on card" = "Ada Lovelace"');
    const all = JSON.stringify(nodesOf(tree));
    expect(all).not.toContain(CARD);
    expect(all).not.toContain(PASSWORD);
  });

  it("withholds every value inside a frame in strict mode (redactInput)", async () => {
    const strict = await nativeTree(page, { redactInput: true });
    expect(nodesOf(strict).filter((n) => n.a11y.value !== undefined)).toEqual(
      [],
    );
    expect(JSON.stringify(nodesOf(strict))).not.toContain("Ada Lovelace");
  });

  it("audits a frame's controls, but not its document as a second page", () => {
    const findings = collectFindings(tree);
    expect(findings.map((f) => [f.rule, f.locator])).toEqual([
      [
        "no-unlabeled-interactive",
        `${rowOf(tree, "srcdoc").dom?.locator} >>> body > button:nth-of-type(2)`,
      ],
    ]);
  });

  it("points focus inside a frame at the focused node, not its row", async () => {
    const frame = page.frames().find((f) => f.url().endsWith("/pay.html"))!;
    await frame.getByLabel("Name on card").focus();
    const focused = await nativeTree(page);
    expect(focused.focusedId).toBeDefined();
    const node = focused.nodes.get(focused.focusedId!)!;
    expect(node.a11y.name).toBe("Name on card");
  });
});

describe("nativeAX() ↔ nativeTree() on a page of frames", () => {
  const session = new BrowserSession({ headless: true });

  afterAll(async () => {
    await session.close();
  });

  it("agree on every node, frame content included", async () => {
    await session.open(url);
    const { pairs } = await session.nativeAX();
    const native = await session.nativeTree();
    const fromTree = nodesOf(native)
      .filter((n) => n.id !== "ax-root")
      .map((n) =>
        n.a11y.name ? `${n.a11y.role} "${n.a11y.name}"` : n.a11y.role,
      );
    expect(pairs).toContain('button "Srcdoc button"');
    expect([...pairs].sort()).toEqual(fromTree.sort());
  });

  // A same-process frame's node keeps a plain `ax-dom-<n>` id, which the page's
  // own CDP session resolves: acting inside the frame needs nothing new.
  it("acts on a node inside a frame through its plain id", async () => {
    await session.open(url);
    const before = await session.nativeTree();
    const field = nodesOf(before).find((n) => n.a11y.name === "Name on card")!;
    expect(field.id).toMatch(/^ax-dom-\d+$/);

    const typed = await session.act({
      nodeId: field.id,
      action: "type",
      payload: { value: "Grace Hopper" },
    });
    expect(typed).toEqual({ success: true });

    const after = await session.nativeTree();
    expect(after.nodes.get(field.id)?.a11y.value).toBe("Grace Hopper");
  });
});

describe("native tree — a site-isolated Chrome (--site-per-process)", () => {
  let browser: Browser;
  let tree: ExtractionResult;

  beforeAll(async () => {
    browser = await chromium.launch({ args: ["--site-per-process"] });
    tree = await nativeTree(await load(browser));
  });

  afterAll(async () => {
    await browser.close();
  });

  it("still reads every frame of the page's own site", () => {
    for (const title of ["same-origin", "cross-origin"]) {
      expect(inside(tree, rowOf(tree, title)), title).toEqual(CHILD_CONTENT);
    }
    expect(inside(tree, rowOf(tree, "srcdoc"))).toHaveLength(2);
    expect(inside(tree, rowOf(tree, "pay"))).toHaveLength(3);
  });

  // Not read yet: a frame in another process has a session of its own. When
  // the producer reads those, this flips.
  it("leaves the rows of out-of-process frames (cross-site, sandboxed) empty", () => {
    expect(rowOf(tree, "cross-site").childIds).toEqual([]);
    expect(rowOf(tree, "sandboxed").childIds).toEqual([]);
    expect(nodesOf(tree).filter((n) => n.parentId === null)).toHaveLength(1);
  });
});
