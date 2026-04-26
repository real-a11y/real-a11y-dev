import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render } from "preact";
import { TreeView } from "./TreeView.js";

/**
 * Wait for a selector to appear inside `root`, flushing microtasks/timers
 * until either it shows up or `timeoutMs` elapses.
 *
 * Preact schedules rerenders asynchronously after `setState` inside a
 * `useEffect`, and the extractor inside `TreeView` goes through at least
 * two state updates before the toolbar shows up, so a fixed `setTimeout(0)`
 * is not a reliable flush.
 */
async function waitFor(
  root: ParentNode,
  selector: string,
  timeoutMs = 200,
): Promise<Element> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const el = root.querySelector(selector);
    if (el) return el;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`Timed out waiting for selector: ${selector}`);
}

/**
 * Smoke test for the full TreeView — uses a real DOM subtree as `root` so
 * the core extractors + DomObserver can run end-to-end in jsdom.
 *
 * We assert only load-success indicators, not specific tree shapes, because
 * extraction details are covered by `@real-a11y-dev/core` tests. This test's job
 * is to prove that `TreeView` wires extract → render → toolbar without
 * throwing and without requiring host-app side-effects by default.
 */
describe("TreeView (smoke)", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  function makeRoot(): HTMLElement {
    const root = document.createElement("div");
    root.innerHTML = `
      <header>
        <h1>Hello</h1>
      </header>
      <main>
        <button type="button">Click me</button>
        <a href="/x">A link</a>
      </main>
    `;
    document.body.appendChild(root);
    return root;
  }

  it("mounts, extracts a tree, and renders the toolbar", async () => {
    const root = makeRoot();
    try {
      render(<TreeView root={root} />, container);

      // Toolbar indicates we're past the "Extracting tree…" placeholder.
      await waitFor(container, '[role="toolbar"][aria-label="Tree controls"]');

      // The view-mode toggle is present.
      expect(
        container.querySelector('[role="group"][aria-label="Tree view mode"]'),
      ).not.toBeNull();
    } finally {
      root.remove();
    }
  });

  it("does not steal host focus or call scrollIntoView by default", async () => {
    const root = makeRoot();
    try {
      const btn = root.querySelector("button");
      expect(btn).not.toBeNull();

      let scrolled = 0;
      const originalScroll = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function () {
        scrolled++;
      };

      // Put focus on the host button; render the TreeView; assert focus stays.
      btn!.focus();
      expect(document.activeElement).toBe(btn);

      try {
        render(<TreeView root={root} />, container);
        await waitFor(
          container,
          '[role="toolbar"][aria-label="Tree controls"]',
        );
      } finally {
        Element.prototype.scrollIntoView = originalScroll;
      }

      expect(document.activeElement).toBe(btn);
      expect(scrolled).toBe(0);
    } finally {
      root.remove();
    }
  });
});
