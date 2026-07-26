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

// The three shapes the CDP backend used to no-op on, each reporting its
// outcome into a heading so a native-tree read can see it:
//   1. a control whose handler gates on the pointer sequence (jsaction shape),
//   2. a composite wrapper whose real handler is delegated via closest(),
//   3. an editor that consumes `beforeinput` and owns its own content.
const FIDELITY_PAGE =
  dataUrl(`<!doctype html><html><head><title>fidelity</title></head><body>
  <main>
    <button onpointerdown="document.getElementById('p-out').textContent='pointer fired'">Pointer gated</button>
    <h2 id="p-out">pointer idle</h2>

    <div onclick="if (event.target.closest('a[href]')) document.getElementById('m-out').textContent='menu chose'">
      <div role="menuitem"><a href="#pick">Pick me</a></div>
    </div>
    <h3 id="m-out">menu idle</h3>

    <div id="editor" role="textbox" aria-label="Editor" contenteditable="true"
         onbeforeinput="event.preventDefault(); document.getElementById('e-out').textContent='editor handled'"
         oninput="document.getElementById('e-clobber').textContent='clobbered'">model-owned</div>
    <h4 id="e-out">editor idle</h4>
    <h4 id="e-clobber">not clobbered</h4>
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

  // Each of these fails against a bare `element.click()` / unconditional
  // `textContent` write — the shapes that silently no-op'd through CDP while
  // core's in-page dispatcher handled them.
  describe("dispatch fidelity", () => {
    it("fires the pointer sequence, not a bare click", async () => {
      await session.open(FIDELITY_PAGE);
      const before = await session.nativeTree();
      const buttonId = findId(before, "button", "Pointer gated");
      expect(buttonId).toBeDefined();

      const result = await session.act({
        nodeId: buttonId!,
        action: "click",
      });
      expect(result).toEqual({ success: true });

      const after = await session.nativeTree();
      expect(findId(after, "heading", "pointer fired")).toBeDefined();
    });

    it("retargets a composite wrapper to the descendant that owns the handler", async () => {
      await session.open(FIDELITY_PAGE);
      const before = await session.nativeTree();
      // Target the menuitem WRAPPER — the delegated handler only matches when
      // the click lands on the inner <a href>.
      const wrapperId = findId(before, "menuitem", "Pick me");
      expect(wrapperId).toBeDefined();

      const result = await session.act({
        nodeId: wrapperId!,
        action: "click",
      });
      expect(result).toEqual({ success: true });

      const after = await session.nativeTree();
      expect(findId(after, "heading", "menu chose")).toBeDefined();
    });

    it("lets an editor that consumes beforeinput keep its own content", async () => {
      await session.open(FIDELITY_PAGE);
      const before = await session.nativeTree();
      const editorId = findId(before, "textbox", "Editor");
      expect(editorId).toBeDefined();

      const result = await session.act({
        nodeId: editorId!,
        action: "type",
        payload: { value: "typed by the agent" },
      });
      expect(result).toEqual({ success: true });

      const after = await session.nativeTree();
      // The editor saw its beforeinput…
      expect(findId(after, "heading", "editor handled")).toBeDefined();
      // …and we did NOT write over its model-owned content (the write path
      // would have fired `input`, flipping this heading).
      expect(findId(after, "heading", "not clobbered")).toBeDefined();
      expect(findId(after, "heading", "clobbered")).toBeUndefined();
    });
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
