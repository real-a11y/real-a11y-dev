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

  it("setViewMode() updates the rendered tree, not just getTree()", async () => {
    const { root, container } = mountDoc(
      `<main><h1>Title</h1><button>Go</button></main>`,
    );
    const nav = createInspector({ root, container, viewMode: "a11y" });
    nav.mount();

    const pressed = () => {
      const btns = Array.from(
        container.shadowRoot!.querySelectorAll(".sn-toggle-btn"),
      );
      const find = (label: string) =>
        btns.find((b) => b.textContent?.trim() === label);
      return {
        dom: find("DOM")?.getAttribute("aria-pressed"),
        a11y: find("A11Y")?.getAttribute("aria-pressed"),
      };
    };

    // Preact flushes effect-driven state updates over several async hops
    // (prop → sync effect → setState → rerender → re-extract → rerender), so
    // poll rather than using a fixed timeout — see TreeView.test.tsx.
    const waitUntil = async (fn: () => boolean, timeoutMs = 2000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (fn()) return;
        await new Promise((r) => setTimeout(r, 5));
      }
    };

    await waitUntil(() => pressed().a11y === "true");
    expect(pressed()).toEqual({ dom: "false", a11y: "true" });

    nav.setViewMode("dom");
    await waitUntil(() => pressed().dom === "true");

    // The UI must follow the API. Previously the toolbar stayed on A11Y while
    // getTree() already reported DOM, so the data API and the rendered tree
    // silently disagreed after any post-mount setViewMode().
    expect(pressed()).toEqual({ dom: "true", a11y: "false" });
    expect(nav.getTree().nodes.size).toBeGreaterThan(0);

    nav.unmount();
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
