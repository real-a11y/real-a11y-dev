import { extractA11yTree, type ExtractionResult } from "@real-a11y-dev/core";
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { semanticTreeRules } from "../semantic-tree-diff.js";
import { diffTreeRows, NO_TREE_CHANGES } from "../tree-changes-diff.js";
import type { ChangeMarks, TreeChangesProp } from "../tree-changes.js";

import { TreePanel } from "./TreePanel.js";

/**
 * What the shared panel shows of the changes its host hands it (`changes`):
 * `TreePanel` is the pure component, so the changes are worked out here, by
 * the panel's own rules, rather than by `TreeView` from a live page. That
 * keeps these deterministic and independent of the observer's timing.
 *
 * This is an accessibility tool, so the marks themselves have to be
 * accessible: WCAG 1.4.1 (Use of Color) means a mark can't be a tint alone,
 * and a screen reader hears each one in words.
 */
describe("TreePanel change marks", () => {
  let host: HTMLElement;
  let container: HTMLElement;
  let originalScrollIntoView: typeof Element.prototype.scrollIntoView;
  let seq = 0;

  beforeEach(() => {
    host = document.createElement("div");
    host.innerHTML = `
      <main>
        <button id="open">Open menu</button>
        <section aria-label="Panel"><p>Nothing yet</p></section>
      </main>
    `;
    document.body.appendChild(host);

    container = document.createElement("div");
    document.body.appendChild(container);
    originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function () {};
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    host.remove();
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  function panel(treeData: ExtractionResult, props: Record<string, unknown>) {
    act(() => {
      render(
        <TreePanel
          treeData={treeData}
          viewMode="a11y"
          onViewModeChange={() => {}}
          {...props}
        />,
        container,
      );
    });
  }

  /** The marks for what changed from `before` to `after`, arriving as a
   *  read the user caused. */
  function marks(before: ExtractionResult, after: ExtractionResult) {
    const changes = diffTreeRows(before, after, semanticTreeRules("a11y"));
    return { changes, seq: ++seq, announce: true } satisfies ChangeMarks;
  }

  /** The panel shows `before`, then `after` arrives with what changed: the
   *  marks show only once they arrive, not on a panel that mounts with them. */
  function update(
    change: () => void,
    props: Partial<TreeChangesProp> = {},
  ): { after: ExtractionResult; clear: () => void } {
    const before = extractA11yTree(host);
    const clear = vi.fn();
    panel(before, { changes: { marks: null, clear, ...props } });
    change();
    const after = extractA11yTree(host);
    panel(after, {
      changes: { marks: marks(before, after), clear, ...props },
    });
    return { after, clear };
  }

  const row = (name: string) =>
    [...container.querySelectorAll<HTMLElement>('[role="treeitem"]')].find(
      (r) => r.querySelector(".sn-name")?.textContent === name,
    );

  it("marks nothing, and offers no bar or keys, without changes", () => {
    panel(extractA11yTree(host), { enableDiff: true });

    expect(container.querySelector(".sn-change-tag")).toBeNull();
    expect(container.querySelector(".sn-changes-bar")).toBeNull();
    expect(container.querySelector('[aria-live="polite"]')).toBeNull();
    expect(
      container
        .querySelector('[role="tree"]')!
        .getAttribute("aria-keyshortcuts"),
    ).not.toContain("Alt+N");
    // The toolbar button is still offered — that is how you capture one.
    expect(
      container.querySelector('[aria-label="Checkpoint tree for diff"]'),
    ).not.toBeNull();
  });

  it("omits the checkpoint button when the feature is off", () => {
    panel(extractA11yTree(host), { enableDiff: false });

    expect(
      container.querySelector('[aria-label="Checkpoint tree for diff"]'),
    ).toBeNull();
  });

  it("marks a new row with more than colour, and says so at the end of its label", () => {
    update(
      () => {
        const save = document.createElement("button");
        save.textContent = "Save";
        host.querySelector("main")!.appendChild(save);
      },
      { since: "the checkpoint" },
    );

    const saved = row("Save")!;
    expect(saved.classList).toContain("sn-node--change-new");
    // A visible word carries the meaning, not just the edge's colour...
    const tag = saved.querySelector(".sn-change-tag--new")!;
    expect(tag.textContent).toBe("new");
    expect(tag.getAttribute("title")).toBe("New since the checkpoint");
    // ...hidden from a screen reader, which hears it last in the label.
    expect(tag.getAttribute("aria-hidden")).toBe("true");
    expect(saved.querySelector(".sn-label .sn-sr-only")!.textContent).toBe(
      ", new",
    );
    // The unchanged rows carry nothing.
    expect(row("Open menu")!.querySelector(".sn-change-tag")).toBeNull();
  });

  it("underlines what changed on a changed row, and names it", () => {
    update(() => {
      host.querySelector("#open")!.textContent = "Close menu";
    });

    const changed = row("Close menu")!;
    expect(changed.classList).toContain("sn-node--change-changed");
    expect(changed.querySelector(".sn-name")!.classList).toContain(
      "sn-change-part",
    );
    expect(
      changed.querySelector(".sn-change-tag--changed")!.getAttribute("title"),
    ).toBe('Changed since the read before:\nname: "Open menu" → "Close menu"');
    expect(changed.querySelector(".sn-label .sn-sr-only")!.textContent).toBe(
      ", changed: name",
    );
  });

  it("outlines a badge that changed", () => {
    update(() => {
      host.querySelector("#open")!.setAttribute("aria-disabled", "true");
    });

    const badge = [...row("Open menu")!.querySelectorAll(".sn-badge")].find(
      (b) => b.textContent === "disabled",
    )!;
    expect(badge.classList).toContain("sn-change-part");
  });

  it("lists the removed rows in the bar, not as rows", () => {
    update(() => host.querySelector("#open")!.remove());

    const bar = container.querySelector(
      '[role="group"][aria-label="Changes since the read before"]',
    )!;
    expect(bar.querySelector(".sn-changes-summary")!.textContent).toContain(
      "removed",
    );
    const removed = bar.querySelector(".sn-removed")!;
    // A native <details> — no aria-expanded or id bookkeeping to get wrong.
    expect(removed.tagName).toBe("DETAILS");
    expect(removed.textContent).toContain('button "Open menu"');
    // Removed entries are not tree rows: they are not focusable, and they
    // carry no treeitem semantics that would imply an actionable element.
    expect(removed.querySelector('[role="treeitem"]')).toBeNull();
    expect(removed.querySelector("[tabindex]")).toBeNull();
    expect(row("Open menu")).toBeUndefined();
  });

  it("opens a new row's subtree in the render that brings it", () => {
    update(() => {
      // Deep enough to start closed (`expanded: depth < 3`).
      host.querySelector("section")!.innerHTML =
        '<ul aria-label="Results"><li>One</li><li>Two</li></ul>';
    });

    const list = [
      ...container.querySelectorAll<HTMLElement>('[role="treeitem"]'),
    ].find((r) => r.querySelector(".sn-role")?.textContent === "list")!;
    expect(list.getAttribute("aria-expanded")).toBe("true");
    expect(
      [...container.querySelectorAll(".sn-role")].filter(
        (r) => r.textContent === "listitem",
      ),
    ).toHaveLength(2);
  });

  it("goes from change to change with Alt+N, and says so in the tree's keys", () => {
    update(() => {
      host.querySelector("#open")!.textContent = "Close menu";
      const save = document.createElement("button");
      save.textContent = "Save";
      host.querySelector("main")!.appendChild(save);
    });

    const tree = container.querySelector<HTMLElement>('[role="tree"]')!;
    expect(tree.getAttribute("aria-keyshortcuts")).toContain(
      "Alt+N Alt+Shift+N",
    );
    const press = (shiftKey: boolean) =>
      act(() => {
        tree.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "n",
            code: "KeyN",
            altKey: true,
            shiftKey,
            bubbles: true,
          }),
        );
      });
    press(false);
    expect(row("Close menu")!.getAttribute("aria-selected")).toBe("true");
    press(false);
    expect(row("Save")!.getAttribute("aria-selected")).toBe("true");
    press(true);
    expect(row("Close menu")!.getAttribute("aria-selected")).toBe("true");
  });

  it("shows the bar in the TAB view too, without arrows to rows it doesn't show", () => {
    const { after, clear } = update(() =>
      host.querySelector("#open")!.remove(),
    );
    const changes = container.querySelector(".sn-changes-bar");
    expect(changes).not.toBeNull();
    // The same marks, shown in the TAB view.
    act(() => {
      render(
        <TreePanel
          treeData={after}
          viewMode="tab"
          onViewModeChange={() => {}}
          changes={{ marks: marks(extractA11yTree(host), after), clear }}
        />,
        container,
      );
    });
    expect(container.querySelector('[role="tree"]')).toBeNull();
    const bar = container.querySelector(".sn-changes-bar")!;
    expect(bar.querySelector(".sn-removed")).toBeDefined();
    expect(bar.querySelector('[aria-label="Next change"]')).toBeNull();
  });

  it("hands focus to the TAB view's list when the bar goes from under it there", () => {
    const before = extractA11yTree(host);
    host.querySelector("#open")!.remove();
    const after = extractA11yTree(host);
    const clear = vi.fn();
    const tab = (changes: TreeChangesProp) =>
      act(() => {
        render(
          <TreePanel
            treeData={after}
            viewMode="tab"
            onViewModeChange={() => {}}
            changes={changes}
          />,
          container,
        );
      });
    tab({ marks: null, clear });
    tab({ marks: marks(before, after), clear });
    container
      .querySelector<HTMLButtonElement>('[aria-label="Clear change marks"]')!
      .focus();
    tab({ marks: null, clear });
    expect(document.activeElement).toBe(
      container.querySelector('[role="listbox"]'),
    );
  });

  it("says what a read the user caused found", () => {
    update(() => host.querySelector("#open")!.remove());

    expect(container.querySelector('[aria-live="polite"]')!.textContent).toBe(
      "1 removed in the tree",
    );
  });

  it("says what marks counting from a checkpoint count from", () => {
    update(() => host.querySelector("#open")!.remove(), {
      since: "the checkpoint",
      noticeEnd: "since the checkpoint",
    });

    expect(container.querySelector('[aria-live="polite"]')!.textContent).toBe(
      "1 removed since the checkpoint",
    );
  });

  it("shows no bar for marks with nothing in them", () => {
    const tree = extractA11yTree(host);
    const clear = vi.fn();
    panel(tree, { changes: { marks: null, clear } });
    panel(tree, {
      changes: {
        marks: { changes: NO_TREE_CHANGES, seq: ++seq, announce: true },
        clear,
        totals: true,
        noticeEnd: "since the checkpoint",
      },
    });
    expect(container.querySelector(".sn-changes-bar")).toBeNull();
    expect(container.querySelector('[aria-live="polite"]')!.textContent).toBe(
      "No changes since the checkpoint",
    );
  });

  it("hands focus to the tree when the bar goes from under it", () => {
    const { after, clear } = update(() => {
      host.querySelector("#open")!.textContent = "Close menu";
    });
    container
      .querySelector<HTMLButtonElement>('[aria-label="Next change"]')!
      .focus();
    panel(after, { changes: { marks: null, clear } });
    expect(document.activeElement).toBe(
      container.querySelector('[role="tree"]'),
    );
  });

  it("hands focus to the tree from inside a shadow root, as the inspector mounts the panel", () => {
    const shadowHost = document.createElement("div");
    document.body.appendChild(shadowHost);
    const mountPoint = document.createElement("div");
    shadowHost.attachShadow({ mode: "open" }).appendChild(mountPoint);
    const before = extractA11yTree(host);
    host.querySelector("#open")!.textContent = "Close menu";
    const after = extractA11yTree(host);
    const clear = vi.fn();
    const at = (changes: TreeChangesProp) =>
      act(() => {
        render(
          <TreePanel
            treeData={after}
            viewMode="a11y"
            onViewModeChange={() => {}}
            changes={changes}
          />,
          mountPoint,
        );
      });
    try {
      at({ marks: null, clear });
      at({ marks: marks(before, after), clear });
      const shadow = shadowHost.shadowRoot!;
      shadow
        .querySelector<HTMLButtonElement>('[aria-label="Next change"]')!
        .focus();
      expect(shadow.activeElement?.getAttribute("aria-label")).toBe(
        "Next change",
      );
      at({ marks: null, clear });
      expect(shadow.activeElement).toBe(shadow.querySelector('[role="tree"]'));
    } finally {
      render(null, mountPoint);
      shadowHost.remove();
    }
  });

  it("clears the marks from the bar's ✕, and hands focus to the tree", () => {
    const { clear } = update(() => {
      host.querySelector("#open")!.textContent = "Close menu";
    });

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Clear change marks"]')!
        .click();
    });
    expect(clear).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(
      container.querySelector('[role="tree"]'),
    );
  });
});
