/**
 * End-to-end: the write side of the native producer (RFC PR G).
 *
 * Reads Chromium's own accessibility tree (`nativeTree`), targets a node by its
 * native id, and dispatches a real action against it via `BrowserSession.act`
 * (the graduated CDP dispatch spike). Proves author-DOM click + type work
 * end-to-end, and that the typed value never comes back in the result.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e`
 * (needs a Chromium binary: `pnpm exec playwright install chromium`).
 */

import { BrowserSession, backendNodeIdFrom } from "@real-a11y-dev/browser";
import type { ExtractionResult } from "@real-a11y-dev/core";
import { afterAll, describe, expect, it } from "vitest";

function dataUrl(html: string): string {
  return "data:text/html," + encodeURIComponent(html);
}

/** First node id whose role (and, if given, accessible name) matches. */
function findId(
  tree: ExtractionResult,
  role: string,
  name?: string,
): string | undefined {
  for (const node of tree.nodes.values()) {
    if (node.a11y.role !== role) continue;
    if (name !== undefined && node.a11y.name !== name) continue;
    return node.id;
  }
  return undefined;
}

// A page wired so each action has a visible a11y-tree effect: the button writes
// to a heading, and the input echoes into another heading on `input`.
const PAGE = dataUrl(`<!doctype html><html><head><title>act</title></head><body>
  <main>
    <button onclick="document.getElementById('out').textContent='clicked'">Go</button>
    <h2 id="out">idle</h2>
    <input aria-label="Echo box"
           oninput="document.getElementById('echo').textContent=this.value" />
    <h3 id="echo">empty</h3>
    <video controls width="120" height="80" src="data:video/mp4;base64,AAAA"></video>
  </main>
</body></html>`);

const session = new BrowserSession({ headless: true });

afterAll(async () => {
  await session.close();
});

describe("BrowserSession.act (native producer, write side)", () => {
  it("clicks a button targeted by its native node id", async () => {
    await session.open(PAGE);
    const before = await session.nativeTree();
    expect(findId(before, "heading", "idle")).toBeDefined(); // pre-condition

    const buttonId = findId(before, "button", "Go");
    expect(buttonId).toBeDefined();
    expect(backendNodeIdFrom(buttonId!)).not.toBeNull(); // author-DOM node

    const result = await session.act({ nodeId: buttonId!, action: "click" });
    expect(result).toEqual({ success: true });

    // The click fired: the heading text changed, visible in a fresh read.
    const after = await session.nativeTree();
    expect(findId(after, "heading", "clicked")).toBeDefined();
    expect(findId(after, "heading", "idle")).toBeUndefined();
  });

  it("types into a field and never returns the typed value", async () => {
    await session.open(PAGE);
    const tree = await session.nativeTree();
    const boxId = findId(tree, "textbox", "Echo box");
    expect(boxId).toBeDefined();

    const secret = "hunter2 lives here";
    const result = await session.act({
      nodeId: boxId!,
      action: "type",
      payload: { value: secret },
    });
    expect(result).toEqual({ success: true });
    // R1: the typed text must not leak back through the result.
    expect(JSON.stringify(result)).not.toContain("hunter2");

    // The value DID reach the page — the `input` handler echoed it into the
    // heading, which the tree now shows.
    const after = await session.nativeTree();
    expect(findId(after, "heading", secret)).toBeDefined();
  });

  it("refuses a node id with no backing DOM element", async () => {
    await session.open(PAGE);
    // `ax-<n>` form — the id scheme's marker for a node with no DOM element
    // (a synthesized root). Guarded before any CDP traffic.
    const result = await session.act({ nodeId: "ax-424242", action: "click" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no backing DOM element/);
  });

  it("reports a stale id when a backend node no longer resolves", async () => {
    await session.open(PAGE);
    // A well-formed `ax-dom-<n>` id whose backend node doesn't exist — exercises
    // a real `DOM.resolveNode` miss over CDP.
    const result = await session.act({
      nodeId: "ax-dom-999999999",
      action: "click",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/could not resolve/);
  });
});
