import { describe, it, expect } from "vitest";
import {
  auditSnapshot,
  outlineSnapshot,
  tabSequenceSnapshot,
  assertNoUnlabeledInteractive,
  assertHeadingOrder,
  assertDialogsLabeled,
  assertLandmarkStructure,
  flow,
  A11yAssertionError,
} from "./index.js";

function mount(html: string): HTMLElement {
  document.body.innerHTML = "";
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

describe("auditSnapshot", () => {
  it("serializes a small tree deterministically", () => {
    const root = mount(`
      <main>
        <h1>Title</h1>
        <button>Go</button>
      </main>
    `);
    const out = auditSnapshot(root);
    expect(out).toContain(`main`);
    expect(out).toContain(`heading "Title" (level 1)`);
    expect(out).toContain(`button "Go"`);
  });

  it("redacts sensitive text when asked", () => {
    const root = mount(`<h1>Order #12345 placed</h1>`);
    const out = auditSnapshot(root, { redact: [/#\d+/g] });
    expect(out).not.toContain("#12345");
    expect(out).toContain("[REDACTED]");
  });
});

describe("outlineSnapshot", () => {
  it("indents by level", () => {
    const root = mount(`<h1>Top</h1><h2>A</h2><h3>A.1</h3><h2>B</h2>`);
    const lines = outlineSnapshot(root).split("\n");
    expect(lines[0]).toBe("h1 Top");
    expect(lines[1]).toBe("  h2 A");
    expect(lines[2]).toBe("    h3 A.1");
    expect(lines[3]).toBe("  h2 B");
  });
});

describe("tabSequenceSnapshot", () => {
  it("lists focusable nodes with positive tabindexes first", () => {
    const root = mount(`
      <button>Zero</button>
      <button tabindex="1">First</button>
    `);
    const out = tabSequenceSnapshot(root);
    expect(out).toMatch(/01\. button "First"/);
    expect(out).toMatch(/02\. button "Zero"/);
  });
});

describe("assertions", () => {
  it("assertNoUnlabeledInteractive passes on labeled controls", () => {
    const root = mount(`<button>Go</button>`);
    expect(() => assertNoUnlabeledInteractive(root)).not.toThrow();
  });

  it("assertNoUnlabeledInteractive throws on unlabeled button", () => {
    const root = mount(`<button></button>`);
    expect(() => assertNoUnlabeledInteractive(root)).toThrow(A11yAssertionError);
  });

  it("assertHeadingOrder flags missing h1", () => {
    const root = mount(`<h2>Only</h2>`);
    expect(() => assertHeadingOrder(root)).toThrow(/Missing <h1>/);
  });

  it("assertHeadingOrder flags skipped level", () => {
    const root = mount(`<h1>A</h1><h3>B</h3>`);
    expect(() => assertHeadingOrder(root)).toThrow(/level skipped/i);
  });

  it("assertDialogsLabeled passes on labeled dialog", () => {
    const root = mount(`
      <div role="dialog" aria-label="Confirm">Body</div>
    `);
    expect(() => assertDialogsLabeled(root)).not.toThrow();
  });

  it("assertDialogsLabeled throws on unlabeled dialog", () => {
    const root = mount(`<div role="dialog"></div>`);
    expect(() => assertDialogsLabeled(root)).toThrow(A11yAssertionError);
  });

  it("assertLandmarkStructure requires exactly one <main>", () => {
    const rootNone = mount(`<div>no main</div>`);
    expect(() => assertLandmarkStructure(rootNone)).toThrow(/Missing <main>/);

    const rootTwo = mount(`<main>A</main><main>B</main>`);
    expect(() => assertLandmarkStructure(rootTwo)).toThrow(/exactly one <main>/);
  });
});

describe("flow", () => {
  it("finds a node by role and then runs an arbitrary expect block", async () => {
    const root = mount(`
      <main>
        <h1>Hi</h1>
        <button id="btn" aria-label="Go">Go</button>
      </main>
    `);
    await flow(root)
      .findByRole("button", { name: "Go" })
      .expect((tree) => {
        const node = Array.from(tree.nodes.values()).find(
          (n) => n.a11y.role === "button",
        );
        expect(node?.a11y.name).toBe("Go");
      });
  });

  it("throws with a helpful message when no node matches", async () => {
    const root = mount(`<p>Nothing here</p>`);
    await expect(
      flow(root).findByRole("button", { name: "Missing" }),
    ).rejects.toThrow(/no node with role "button"/);
  });
});
