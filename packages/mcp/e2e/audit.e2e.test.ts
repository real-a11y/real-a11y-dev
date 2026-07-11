/**
 * End-to-end: a real MCP client drives the server, which drives a real headless
 * Chromium, injects the page-bundle, and audits a live page. Exercises the full
 * chain that the unit tests fake out. Requires a Chromium binary
 * (`npx playwright install chromium`); run via `pnpm test:e2e`.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { BrowserSession } from "../src/browser.js";
import { buildServer } from "../src/server.js";

const session = new BrowserSession({ headless: true });
let client: Client;

function textOf(res: { content: { type: string; text?: string }[] }): string {
  return res.content.map((c) => c.text ?? "").join("");
}

function dataUrl(html: string): string {
  return "data:text/html," + encodeURIComponent(html);
}

beforeAll(async () => {
  const server = buildServer(session);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "e2e", version: "0.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
});

afterAll(async () => {
  await session.close();
});

describe("MCP end-to-end against a real browser", () => {
  it("audits a page and finds exactly the real defects", async () => {
    const html = `<!doctype html><html><head><title>E2E</title></head><body>
      <main>
        <h1>Title</h1>
        <h3>Skips h2</h3>
        <button></button>
        <input aria-label="Search" />
        <a href="#">Docs</a>
      </main>
    </body></html>`;

    await client.callTool({
      name: "open_page",
      arguments: { url: dataUrl(html) },
    });

    const res = await client.callTool({ name: "audit_page", arguments: {} });
    const out = textOf(res);

    // Two real defects, and nothing spurious for the labeled input/link.
    expect(out).toMatch(/no-unlabeled-interactive/);
    expect(out).toMatch(/heading-order/);
    const json = out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1);
    const parsed = JSON.parse(json);
    expect(parsed.summary.total).toBe(2);
    expect(parsed.findings.map((f: { rule: string }) => f.rule).sort()).toEqual(
      ["heading-order", "no-unlabeled-interactive"],
    );
    // The unlabeled control carries a locator so it can be found and fixed.
    const unlabeled = parsed.findings.find(
      (f: { rule: string }) => f.rule === "no-unlabeled-interactive",
    );
    expect(unlabeled.locator).toMatch(/button/);
  });

  it("returns the semantic tree and heading outline", async () => {
    const tree = textOf(
      await client.callTool({ name: "get_semantic_tree", arguments: {} }),
    );
    expect(tree).toMatch(/button/);
    expect(tree).toMatch(/textbox "Search"/);

    const outline = textOf(
      await client.callTool({ name: "get_heading_outline", arguments: {} }),
    );
    expect(outline).toMatch(/h1 Title/);
    expect(outline).toMatch(/h3 Skips h2/);
  });

  it("inspect_page returns one internally-consistent snapshot", async () => {
    const out = textOf(
      await client.callTool({ name: "inspect_page", arguments: {} }),
    );
    // Findings, tree, outline, and tab order all from a single extraction.
    expect(out).toMatch(/Single-extraction snapshot/);
    expect(out).toMatch(/no-unlabeled-interactive/);
    expect(out).toMatch(/heading-order/);
    // Consistency: a heading the outline reports must also exist in the tree.
    expect(out).toMatch(/## Semantic tree/);
    expect(out).toMatch(/heading "Title"/); // in the tree section
    expect(out).toMatch(/h1 Title/); // in the outline section
    expect(out).toMatch(/textbox "Search"/); // labeled input, not flagged
  });

  it("extracts under a Trusted Types CSP that blocks addScriptTag", async () => {
    // `require-trusted-types-for 'script'` blocks `<script>.text` assignment
    // (the old addScriptTag path). Injection via page.evaluate must still work.
    const html = `<!doctype html><html><head>
      <meta http-equiv="Content-Security-Policy" content="require-trusted-types-for 'script'">
      <title>Secured</title></head><body><main>
        <h1>Secured page</h1>
        <button aria-label="Go">Go</button>
      </main></body></html>`;
    await client.callTool({
      name: "open_page",
      arguments: { url: dataUrl(html) },
    });
    const tree = textOf(
      await client.callTool({ name: "get_semantic_tree", arguments: {} }),
    );
    expect(tree).toMatch(/heading "Secured page"/);
    expect(tree).toMatch(/button "Go"/);
  });

  it("emulates a device so the tree reflects the mobile layout", async () => {
    // Responsive page: desktop shows the full nav, mobile shows a hamburger.
    const html = `<!doctype html><html><head><title>Responsive</title>
      <meta name="viewport" content="width=device-width, initial-scale=1"><style>
      .desktop-nav { display: block; }
      .hamburger { display: none; }
      @media (max-width: 600px) {
        .desktop-nav { display: none; }
        .hamburger { display: block; }
      }
    </style></head><body><main>
      <nav class="desktop-nav" aria-label="Primary">
        <a href="#a">Products</a><a href="#b">Pricing</a>
      </nav>
      <button class="hamburger" aria-label="Open menu">=</button>
      <h1>Home</h1>
    </main></body></html>`;
    const url = dataUrl(html);

    await client.callTool({ name: "open_page", arguments: { url } });
    const desktop = textOf(
      await client.callTool({ name: "get_semantic_tree", arguments: {} }),
    );

    await client.callTool({
      name: "open_page",
      arguments: { url, device: "iPhone 13" },
    });
    const mobile = textOf(
      await client.callTool({ name: "get_semantic_tree", arguments: {} }),
    );

    // Same URL, different extracted tree — the whole point.
    expect(desktop).toMatch(/link "Products"/);
    expect(desktop).not.toMatch(/Open menu/);
    expect(mobile).toMatch(/button "Open menu"/);
    expect(mobile).not.toMatch(/Products/);
  });

  it("list_elements returns a filtered, located category", async () => {
    const html = `<!doctype html><html><head><title>x</title></head><body><main>
      <a id="a1" href="/one">One</a><a href="/two">Two</a>
      <button>Go</button><img alt="Logo">
    </main></body></html>`;
    await client.callTool({
      name: "open_page",
      arguments: { url: dataUrl(html) },
    });

    const links = textOf(
      await client.callTool({
        name: "list_elements",
        arguments: { filter: "link" },
      }),
    );
    expect(links).toMatch(/link "One"/);
    expect(links).toMatch(/link "Two"/);
    expect(links).not.toMatch(/button|img/);
    expect(links).toContain("#a1"); // locator

    const images = textOf(
      await client.callTool({
        name: "list_elements",
        arguments: { filter: "image" },
      }),
    );
    expect(images).toMatch(/img "Logo"/);
  });

  it("errors clearly when rootSelector matches no element", async () => {
    const html = `<!doctype html><html><head><title>x</title></head>
      <body><main><h1>Here</h1></main></body></html>`;
    await client.callTool({
      name: "open_page",
      arguments: { url: dataUrl(html) },
    });
    const res = await client.callTool({
      name: "get_semantic_tree",
      arguments: { rootSelector: "#does-not-exist" },
    });
    // A missing root is an actionable error, not a silently-empty tree.
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(
      /#does-not-exist|matched no element|no element/i,
    );
  });

  it("refuses to open a file:// URL by default", async () => {
    const res = await client.callTool({
      name: "open_page",
      arguments: { url: "file:///etc/passwd" },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/REAL_A11Y_MCP_ALLOW_FILE|Refusing/);
  });

  it("reads the native tree and agrees with custom (post value-as-name fix)", async () => {
    // Unlabeled input WITH a value. Chromium never names it by value; since the
    // #119 core fix, the custom engine doesn't either — so the oracle agrees.
    const html = `<!doctype html><html><head><title>x</title></head><body><main>
      <h1>Sign in</h1>
      <input value="john@example.com" />
    </main></body></html>`;
    await client.callTool({
      name: "open_page",
      arguments: { url: dataUrl(html) },
    });

    const native = textOf(
      await client.callTool({ name: "get_native_tree", arguments: {} }),
    );
    expect(native).toMatch(/textbox/); // Chromium's own tree, via CDP
    expect(native).not.toMatch(/john@example\.com/); // never named by value

    const tree = textOf(
      await client.callTool({ name: "get_semantic_tree", arguments: {} }),
    );
    expect(tree).toMatch(/textbox/);
    expect(tree).not.toMatch(/john@example\.com/); // custom no longer either

    const cmp = textOf(
      await client.callTool({ name: "compare_trees", arguments: {} }),
    );
    expect(cmp).toMatch(/agree/); // custom and native match — the fix + oracle
  });
});
