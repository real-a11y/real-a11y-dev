import { describe, it, expect, beforeEach } from "vitest";

import {
  createInspector,
  type ActionRequest,
  type ActionResult,
} from "./index.js";

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

  it.each(["shadow", "light"] as const)(
    "keeps its own panel out of the tree when mounted inside the root (%s)",
    (mount) => {
      document.body.innerHTML = "<main><h1>App</h1></main>";
      const container = document.createElement("div");
      document.body.appendChild(container);
      const nav = createInspector({ root: document.body, container, mount });
      nav.mount();

      const roles = Array.from(nav.getTree().nodes.values()).map(
        (n) => n.a11y.role,
      );
      expect(roles).toContain("main");
      // The panel's toolbar buttons, search box and tree must not appear.
      expect(roles).not.toContain("button");
      expect(roles).not.toContain("searchbox");
      expect(roles).not.toContain("tree");

      nav.unmount();
      expect(container.hasAttribute("data-real-a11y-panel")).toBe(false);
      // mount: "light" puts its stylesheet in <head>; don't leak it.
      document.getElementById("sn-styles")?.remove();
    },
  );

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

describe("createInspector: onAction results", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  /**
   * Preact flushes effect-driven state updates over several async hops, so
   * poll for the rendered row rather than using a fixed timeout — see
   * TreeView.test.tsx.
   */
  const waitUntil = async (fn: () => boolean, timeoutMs = 2000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (fn()) return;
      await new Promise((r) => setTimeout(r, 5));
    }
  };

  /** Mount an inspector over one button and return its row action button. */
  async function mountWithButton() {
    const { root, container } = mountDoc('<button id="btn">Press</button>');
    const seen: Array<[ActionRequest, ActionResult]> = [];
    const nav = createInspector({
      root,
      container,
      onAction: (request, result) => seen.push([request, result]),
    });
    nav.mount();

    const actionButton = () =>
      container.shadowRoot!.querySelector<HTMLButtonElement>(".sn-action");
    await waitUntil(() => actionButton() !== null);
    expect(actionButton()).not.toBeNull();

    return { root, nav, seen, actionButton };
  }

  it("reports the dispatcher's failure instead of a fabricated success", async () => {
    const { root, nav, seen, actionButton } = await mountWithButton();

    // Detach the host element after extraction: the ref map still holds it,
    // so the dispatcher answers `{ success: false }` rather than throwing.
    root.querySelector("#btn")!.remove();
    actionButton()!.click();

    expect(seen).toHaveLength(1);
    expect(seen[0]![1].success).toBe(false);
    expect(seen[0]![1].error).toMatch(/disconnected|no longer in DOM/i);

    nav.unmount();
  });

  it("still reports success when the action really is dispatched", async () => {
    const { root, nav, seen, actionButton } = await mountWithButton();

    let clicked = 0;
    root.querySelector("#btn")!.addEventListener("click", () => clicked++);
    actionButton()!.click();

    expect(clicked).toBe(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]![0].action).toBe("click");
    expect(seen[0]![1].success).toBe(true);

    nav.unmount();
  });
});
