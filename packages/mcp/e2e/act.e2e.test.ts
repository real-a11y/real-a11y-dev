/**
 * End-to-end: an MCP client drives the act tools against a real headless
 * Chromium — the full checkpoint_tree → click/type → diff_tree loop the unit
 * tests fake out, including the R1 guarantee that a typed value never appears
 * in a tool result. Requires a Chromium binary (`npx playwright install
 * chromium`); run via `pnpm test:e2e`.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { BrowserSession } from "@real-a11y-dev/browser";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { buildServer } from "../src/server.js";

const SECRET = "hunter2-SECRET";

// Each action has a visible a11y-tree effect (the button writes to a heading,
// the input echoes into another), plus a duplicate-named pair for the
// ambiguity → nth flow. The second "Add" button proves nth picks by document
// order: only it writes "second".
const PAGE =
  "data:text/html," +
  encodeURIComponent(`<!doctype html><html><head><title>act e2e</title></head><body>
  <main>
    <button onclick="document.getElementById('out').textContent='clicked'">Go</button>
    <h2 id="out">idle</h2>
    <input aria-label="Echo box"
           oninput="document.getElementById('echo').textContent=this.value" />
    <h3 id="echo">empty</h3>
    <button onclick="document.getElementById('out').textContent='first'">Add</button>
    <button onclick="document.getElementById('out').textContent='second'">Add</button>
  </main>
</body></html>`);

const session = new BrowserSession({ headless: true });
let client: Client;

function textOf(res: { content: { type: string; text?: string }[] }): string {
  return res.content.map((c) => c.text ?? "").join("");
}

beforeAll(async () => {
  const server = buildServer(session);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "e2e", version: "0.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  await client.callTool({ name: "open_page", arguments: { url: PAGE } });
});

afterAll(async () => {
  await session.close();
});

describe("act tools end-to-end (checkpoint → act → diff)", () => {
  it("click_element lands a real click and diff_tree reports the change", async () => {
    await client.callTool({ name: "checkpoint_tree", arguments: {} });

    const clicked = await client.callTool({
      name: "click_element",
      arguments: { role: "button", name: "Go" },
    });
    expect(clicked.isError).toBeFalsy();
    expect(textOf(clicked)).toMatch(/Clicked button "Go"/);
    expect(textOf(clicked)).toMatch(/diff_tree/);

    const diff = textOf(
      await client.callTool({ name: "diff_tree", arguments: {} }),
    );
    expect(diff).toMatch(/idle/); // the old heading text left the tree…
    expect(diff).toMatch(/clicked/); // …and the new one entered it
  });

  it("type_text delivers the value to the page but never to the result (R1)", async () => {
    await client.callTool({ name: "checkpoint_tree", arguments: {} });

    const typed = await client.callTool({
      name: "type_text",
      arguments: { role: "textbox", name: "Echo box", text: SECRET },
    });
    expect(typed.isError).toBeFalsy();
    expect(textOf(typed)).not.toContain(SECRET);

    // The page provably received it: its own echo heading now carries it…
    const diff = textOf(
      await client.callTool({ name: "diff_tree", arguments: {} }),
    );
    expect(diff).toContain(SECRET);

    // …and the action result was the only channel that had to stay clean.
    const tree = textOf(
      await client.callTool({
        name: "get_semantic_tree",
        arguments: { producer: "native" },
      }),
    );
    expect(tree).toContain(SECRET); // page content, where the page put it
  });

  it("ambiguity lists candidates, then nth resolves by document order", async () => {
    const ambiguous = await client.callTool({
      name: "click_element",
      arguments: { role: "button", name: "Add" },
    });
    expect(ambiguous.isError).toBe(true);
    expect(textOf(ambiguous)).toMatch(/2 button\(s\) match/);
    expect(textOf(ambiguous)).toMatch(/nth=2/);

    await client.callTool({ name: "checkpoint_tree", arguments: {} });
    const picked = await client.callTool({
      name: "click_element",
      arguments: { role: "button", name: "Add", nth: 2 },
    });
    expect(picked.isError).toBeFalsy();

    const diff = textOf(
      await client.callTool({ name: "diff_tree", arguments: {} }),
    );
    expect(diff).toMatch(/second/); // the SECOND Add button ran, not the first
  });

  it("focus_element flags a text field so type_text can follow", async () => {
    const focused = await client.callTool({
      name: "focus_element",
      arguments: { role: "textbox", name: "Echo box" },
    });
    expect(focused.isError).toBeFalsy();
    expect(textOf(focused)).toMatch(/text field/);
    expect(textOf(focused)).toMatch(/type_text/);
  });

  it("a miss is an agent-correctable error, not a crash", async () => {
    const missed = await client.callTool({
      name: "click_element",
      arguments: { role: "button", name: "No Such Button" },
    });
    expect(missed.isError).toBe(true);
    expect(textOf(missed)).toMatch(/other names exist/);
  });
});
