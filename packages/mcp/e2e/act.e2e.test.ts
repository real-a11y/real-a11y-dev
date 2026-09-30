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
    <div id="composer" contenteditable="true" role="textbox" aria-label="Composer"><p><br></p></div>
    <h4 id="typed-length">length 0</h4>
    <input type="password" aria-label="Password"
           oninput="document.getElementById('pw-length').textContent='password '+this.value.length" />
    <h4 id="pw-length">password 0</h4>
  </main>
  <script>
    // A model-driven editor (the ProseMirror / Lexical shape): it takes the
    // text from beforeinput into its own paragraph, and echoes only the
    // LENGTH, so delivery is provable without the text itself.
    document.getElementById("composer").addEventListener("beforeinput", (e) => {
      e.preventDefault();
      e.currentTarget.querySelector("p").textContent = e.data;
      document.getElementById("typed-length").textContent = "length " + e.data.length;
    });
  </script>
</body></html>`);

// R24's sentinel shape: an `=` inside and a trailing `=`.
const EDITOR_SECRET = "api_key=sk-editor-9f2b==";
const PASSWORD_SECRET = "api_key=sk-password-7c1d==";

const session = new BrowserSession({ headless: true });
let client: Client;
// The same browser session behind a second server in strict mode
// (REAL_A11Y_REDACT_INPUT=1): per-call, so the two can share a page.
let strict: Client;

function textOf(res: { content: { type: string; text?: string }[] }): string {
  return res.content.map((c) => c.text ?? "").join("");
}

beforeAll(async () => {
  const server = buildServer(session);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "e2e", version: "0.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  const strictServer = buildServer(session, { redactInput: true });
  const [strictClientT, strictServerT] = InMemoryTransport.createLinkedPair();
  strict = new Client({ name: "e2e-strict", version: "0.0.0" });
  await Promise.all([
    strictServer.connect(strictServerT),
    strict.connect(strictClientT),
  ]);
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
    // …and so does the field, the way a screen reader announces it
    // (ADR-0001): what an agent types, it can confirm landed.
    expect(diff).toContain(
      `~ textbox "Echo box": a11y.value (unset) → "${SECRET}"`,
    );

    // …and the action result was the only channel that had to stay clean.
    const tree = textOf(
      await client.callTool({
        name: "get_semantic_tree",
        arguments: { producer: "native" },
      }),
    );
    expect(tree).toContain(SECRET); // page content, where the page put it
  });

  it("type_text into a password field: [redacted] in every result, the text and its length in none (R24)", async () => {
    await client.callTool({ name: "checkpoint_tree", arguments: {} });

    const typed = await client.callTool({
      name: "type_text",
      arguments: { role: "textbox", name: "Password", text: PASSWORD_SECRET },
    });
    expect(typed.isError).toBeFalsy();

    // Delivered: the page counted every character…
    const diff = textOf(
      await client.callTool({ name: "diff_tree", arguments: {} }),
    );
    expect(diff).toContain(`password ${PASSWORD_SECRET.length}`);
    // …and the field says it holds something, never what or how long.
    expect(diff).toContain(
      '~ textbox "Password": a11y.value (unset) → "[redacted]"',
    );
    const results = [textOf(typed), diff];
    for (const name of ["get_semantic_tree", "inspect_page", "audit_page"]) {
      results.push(textOf(await client.callTool({ name, arguments: {} })));
    }
    results.push(
      textOf(
        await client.callTool({
          name: "list_elements",
          arguments: { filter: "form" },
        }),
      ),
    );
    for (const out of results) {
      expect(out).not.toContain("sk-password");
      expect(out).not.toContain("•");
    }
  });

  it("type_text into a rich-text editor: the text reaches the editor and the tree; strict mode withholds it", async () => {
    await client.callTool({ name: "checkpoint_tree", arguments: {} });

    const typed = await client.callTool({
      name: "type_text",
      arguments: { role: "textbox", name: "Composer", text: EDITOR_SECRET },
    });
    expect(typed.isError).toBeFalsy();
    // The result never echoes it.
    expect(textOf(typed)).not.toContain(EDITOR_SECRET);

    // Delivered: the editor's own handler saw every character, and the
    // editor now holds it — page content a screen reader reads (ADR-0001).
    const diff = textOf(
      await client.callTool({ name: "diff_tree", arguments: {} }),
    );
    expect(diff).toContain(`length ${EDITOR_SECRET.length}`);
    expect(diff).toContain(
      `~ textbox "Composer": a11y.value (unset) → "${EDITOR_SECRET}"`,
    );

    // Strict mode (REAL_A11Y_REDACT_INPUT=1) on the same page: no tool
    // result carries it — not the tree, not the inspect view, not an audit.
    for (const name of ["get_semantic_tree", "inspect_page", "audit_page"]) {
      const out = textOf(await strict.callTool({ name, arguments: {} }));
      expect(out).not.toContain(EDITOR_SECRET);
    }
    expect(
      textOf(
        await strict.callTool({ name: "get_semantic_tree", arguments: {} }),
      ),
    ).toContain('textbox "Composer"');
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
