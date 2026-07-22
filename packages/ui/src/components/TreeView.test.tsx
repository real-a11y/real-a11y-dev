import { render } from "preact";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

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
  // 2s — generous on purpose. Linux jsdom on CI takes noticeably longer
  // to flush Preact's effect chain (extract → setState → rerender → render
  // toolbar) than local Windows jsdom does. The previous 200ms was tight
  // enough to flake on the Linux runners.
  timeoutMs = 2000,
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

  it("drops the diff baseline when the view mode changes", async () => {
    const root = makeRoot();
    try {
      render(<TreeView root={root} />, container);
      await waitFor(container, '[aria-label="Checkpoint tree for diff"]');

      const checkpoint = container.querySelector(
        '[aria-label="Checkpoint tree for diff"]',
      ) as HTMLButtonElement;
      checkpoint.click();
      await waitFor(
        container,
        '[aria-label="Checkpoint tree for diff"][aria-pressed="true"]',
      );

      // Switching view re-extracts with a different extractor, so the captured
      // baseline is no longer comparable — it must be dropped rather than
      // diffed against a tree it shares no nodes with.
      const domBtn = Array.from(
        container.querySelectorAll(".sn-toggle-btn"),
      ).find((b) => b.textContent === "DOM") as HTMLButtonElement;
      domBtn.click();

      await waitFor(
        container,
        '[aria-label="Checkpoint tree for diff"][aria-pressed="false"]',
      );
      expect(container.querySelector(".sn-diff-marker")).toBeNull();
    } finally {
      root.remove();
    }
  });

  it("gives every virtualized treeitem aria-posinset/aria-setsize", async () => {
    // The list is virtualized, so offscreen sibling rows are absent from the
    // DOM. Screen readers need explicit set markers on each rendered row to
    // perceive the full tree — assert they are present and internally
    // consistent (posinset within 1..setsize).
    const root = makeRoot();
    try {
      render(<TreeView root={root} />, container);
      await waitFor(container, '[role="treeitem"]');

      const items = Array.from(container.querySelectorAll('[role="treeitem"]'));
      expect(items.length).toBeGreaterThan(0);

      for (const item of items) {
        const posinset = item.getAttribute("aria-posinset");
        const setsize = item.getAttribute("aria-setsize");
        expect(posinset).not.toBeNull();
        expect(setsize).not.toBeNull();
        const pos = Number(posinset);
        const size = Number(setsize);
        expect(pos).toBeGreaterThanOrEqual(1);
        expect(pos).toBeLessThanOrEqual(size);
      }
    } finally {
      root.remove();
    }
  });

  it("drops the diff baseline when the mode changes via the prop", async () => {
    // The host can switch views without touching the toolbar —
    // `InspectorInstance.setViewMode()` and the React wrapper's `mode` prop
    // both arrive as a changed `initialViewMode`. That path must honor the
    // same rule: a baseline captured in one view is not comparable against
    // the other, so it has to go.
    const root = makeRoot();
    try {
      render(<TreeView root={root} initialViewMode="a11y" />, container);
      await waitFor(container, '[aria-label="Checkpoint tree for diff"]');

      (
        container.querySelector(
          '[aria-label="Checkpoint tree for diff"]',
        ) as HTMLButtonElement
      ).click();
      await waitFor(
        container,
        '[aria-label="Checkpoint tree for diff"][aria-pressed="true"]',
      );

      render(<TreeView root={root} initialViewMode="dom" />, container);

      await waitFor(
        container,
        '[aria-label="Checkpoint tree for diff"][aria-pressed="false"]',
      );
      expect(container.querySelector(".sn-diff-marker")).toBeNull();
      expect(container.querySelector(".sn-removed")).toBeNull();
    } finally {
      root.remove();
    }
  });

  it("drops the diff baseline when the root is swapped in place", async () => {
    // `createInspector` re-keys TreeView on setRoot(), so it remounts and
    // never reaches this — but TreeView is a public export, and a consumer
    // rendering it directly with a changing `root` and no key gets no such
    // help. Node ids are per-element, so the old root's baseline shares no
    // ids with the new root's tree: every row would read as added.
    const rootA = makeRoot();
    const rootB = makeRoot();
    try {
      render(<TreeView root={rootA} />, container);
      await waitFor(container, '[aria-label="Checkpoint tree for diff"]');

      (
        container.querySelector(
          '[aria-label="Checkpoint tree for diff"]',
        ) as HTMLButtonElement
      ).click();
      await waitFor(
        container,
        '[aria-label="Checkpoint tree for diff"][aria-pressed="true"]',
      );

      // Same component instance, no key change — only the prop moves.
      render(<TreeView root={rootB} />, container);

      await waitFor(
        container,
        '[aria-label="Checkpoint tree for diff"][aria-pressed="false"]',
      );
      expect(container.querySelector(".sn-diff-marker")).toBeNull();
      expect(container.querySelector(".sn-removed")).toBeNull();
    } finally {
      rootA.remove();
      rootB.remove();
    }
  });
});
