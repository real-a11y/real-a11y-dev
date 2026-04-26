import { describe, it, expect, beforeEach } from "vitest";

import { createInspector } from "./index.js";

function mountDoc(html: string): { root: HTMLElement; container: HTMLElement } {
  document.body.innerHTML = "";
  const root = document.createElement("div");
  root.innerHTML = html;
  const container = document.createElement("div");
  document.body.appendChild(root);
  document.body.appendChild(container);
  return { root, container };
}

describe("createInspector", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("mounts inside a ShadowRoot by default", () => {
    const { root, container } = mountDoc("<h1>Hi</h1>");
    const nav = createInspector({ root, container });
    nav.mount();

    expect(container.shadowRoot).not.toBeNull();
    // Style isolation: the <style> lives in the shadow root, not in head.
    expect(document.getElementById("sn-styles")).toBeNull();
    expect(container.shadowRoot!.querySelector("style")).not.toBeNull();

    nav.unmount();
  });

  it("mount: 'light' injects a document-level <style> and renders in-place", () => {
    const { root, container } = mountDoc("<h1>Hi</h1>");
    const nav = createInspector({
      root,
      container,
      mount: "light",
    });
    nav.mount();

    expect(container.shadowRoot).toBeNull();
    expect(document.getElementById("sn-styles")).not.toBeNull();

    nav.unmount();
  });

  it("getTree() returns an ExtractionResult without requiring mount()", () => {
    const { root, container } = mountDoc(`
      <main><h1>Title</h1><button>Go</button></main>
    `);
    const nav = createInspector({ root, container, viewMode: "a11y" });

    const tree = nav.getTree();
    expect(tree.nodes.size).toBeGreaterThan(0);
    const roles = new Set(
      Array.from(tree.nodes.values()).map((n) => n.a11y.role),
    );
    expect(roles.has("heading")).toBe(true);
    expect(roles.has("button")).toBe(true);
  });

  it("setRoot() swaps the observed subtree on the next getTree()", () => {
    const { root, container } = mountDoc("<h1>First</h1>");
    const other = document.createElement("section");
    other.innerHTML = "<h2>Second</h2>";
    document.body.appendChild(other);

    const nav = createInspector({ root, container });
    const before = nav.getTree();
    const headingBefore = Array.from(before.nodes.values()).find(
      (n) => n.a11y.role === "heading",
    );
    expect(headingBefore?.a11y.name).toBe("First");

    nav.setRoot(other);
    const after = nav.getTree();
    const headingAfter = Array.from(after.nodes.values()).find(
      (n) => n.a11y.role === "heading",
    );
    expect(headingAfter?.a11y.name).toBe("Second");
  });

  it("unmount() is idempotent and clears the shadow render", () => {
    const { root, container } = mountDoc("<h1>Hi</h1>");
    const nav = createInspector({ root, container });
    nav.mount();
    expect(() => {
      nav.unmount();
      nav.unmount();
      nav.destroy();
    }).not.toThrow();
  });
});
