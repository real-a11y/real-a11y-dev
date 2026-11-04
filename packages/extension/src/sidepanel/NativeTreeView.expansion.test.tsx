import { render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { NativeNode } from "../native/native-actions.js";

import { NativeTreeView } from "./NativeTreeView.js";

/**
 * Which rows of Chrome's tree stay open from read to read
 * (`use-tree-expansion.ts`). A document's reads don't always share a root:
 * Chromium's own is dropped, so a page with one row at the top is rooted at
 * it, one with more at the synthetic `ax-root`, and an open modal dialog
 * leaves only itself (`rootIdOf`). The rows the user opened stay open through
 * all of that; only another document starts again from its root and the rows
 * under it.
 */

/** A row of a read: its id, role and name, and the rows under it. */
type RowSpec = [id: string, role: string, name: string, childIds?: string[]];

/** One read of the page: its root and its rows, each row's depth worked out
 *  from the root, as a read gives it. */
interface Read {
  rootId: string;
  nodes: Map<string, NativeNode>;
}

function read(rootId: string, ...rows: RowSpec[]): Read {
  const nodes = new Map<string, NativeNode>();
  for (const [id, role, name, childIds = []] of rows) {
    nodes.set(id, {
      id,
      role,
      name,
      depth: 0,
      childIds,
      states: {},
      properties: {},
    });
  }
  const stack: Array<[string, number]> = [[rootId, 0]];
  while (stack.length > 0) {
    const [id, depth] = stack.pop()!;
    const node = nodes.get(id);
    if (!node) continue;
    node.depth = depth;
    for (const child of node.childIds ?? []) stack.push([child, depth + 1]);
  }
  return { rootId, nodes };
}

/** The page's navigation and main, and the cart in main: a row two levels
 *  down, so closed on mount. */
const PAGE_ROWS: RowSpec[] = [
  ["nav", "navigation", "Site", ["home"]],
  ["home", "link", "Home"],
  ["main", "main", "", ["cart"]],
  ["cart", "list", "Cart", ["shoes", "hats"]],
  ["shoes", "listitem", "Shoes"],
  ["hats", "listitem", "Hats"],
];

/** The page, with two rows at the top: rooted at the synthetic `ax-root`. */
const PAGE = read(
  "ax-root",
  ["ax-root", "document", "", ["nav", "main"]],
  ...PAGE_ROWS,
);

/** The page with a modal dialog open in front of it: Chrome's tree holds
 *  the dialog alone, which roots the read. */
const DIALOG = read(
  "dialog",
  ["dialog", "dialog", "Sign in", ["form"]],
  ["form", "form", "Account", ["email", "account"]],
  ["email", "textbox", "Email"],
  ["account", "group", "Remember", ["remember"]],
  ["remember", "checkbox", "Remember me"],
);

/** The page with main alone at the top, so rooted at it. */
const MAIN_ONLY = read(
  "main",
  ["main", "main", "", ["shop"]],
  ["shop", "region", "Shop", ["cart"]],
  ["cart", "list", "Cart", ["shoes", "hats"]],
  ["shoes", "listitem", "Shoes"],
  ["hats", "listitem", "Hats"],
);

/** MAIN_ONLY, once the page added a footer beside main: two rows at the
 *  top now, so rooted at `ax-root`. */
const MAIN_AND_FOOTER = read(
  "ax-root",
  ["ax-root", "document", "", ["main", "footer"]],
  ["main", "main", "", ["shop"]],
  ["shop", "region", "Shop", ["cart"]],
  ["cart", "list", "Cart", ["shoes", "hats"]],
  ["shoes", "listitem", "Shoes"],
  ["hats", "listitem", "Hats"],
  ["footer", "contentinfo", "", ["contact"]],
  ["contact", "link", "Contact"],
);

/** What `App.tsx` hands the tree: the read on screen, and which document
 *  it is of. */
interface OnScreen extends Read {
  documentKey: string;
}

describe("NativeTreeView expansion", () => {
  let container: HTMLDivElement;
  let originalScrollIntoView: typeof Element.prototype.scrollIntoView;
  let show: (next: OnScreen) => void;

  beforeEach(() => {
    originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function () {};
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  /** The panel, as far as the tree goes: it holds the read on screen. */
  function Panel({ first }: { first: OnScreen }) {
    const [onScreen, setOnScreen] = useState(first);
    show = setOnScreen;
    return (
      <NativeTreeView
        nodes={onScreen.nodes}
        rootId={onScreen.rootId}
        busy={false}
        capability={undefined}
        status=""
        onRefresh={() => {}}
        onActivate={() => {}}
        changes={{
          marks: null,
          clear: () => {},
          documentKey: onScreen.documentKey,
        }}
      />
    );
  }

  /** The panel with `first`, a read of document `documentKey`, on screen. */
  function mount(first: Read, documentKey = "1 doc-a") {
    act(() => {
      render(<Panel first={{ ...first, documentKey }} />, container);
    });
  }

  /** A read of `next`, of document `documentKey`, lands. */
  function land(next: Read, documentKey = "1 doc-a") {
    act(() => show({ ...next, documentKey }));
  }

  function row(id: string): HTMLElement {
    const el = container.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
    if (!el) throw new Error(`no row for ${id}`);
    return el;
  }

  const expandedOf = (id: string) => row(id).getAttribute("aria-expanded");
  const shows = (id: string) =>
    container.querySelector(`[data-node-id="${id}"]`) !== null;
  const selected = () =>
    container.querySelector<HTMLElement>(
      '[role="treeitem"][aria-selected="true"]',
    )?.dataset.nodeId;

  /** The row's chevron, clicked. */
  function toggle(id: string) {
    act(() => {
      row(id).querySelector<HTMLButtonElement>(".sn-toggle")!.click();
    });
  }

  it("opens the root and the rows under it on mount, and nothing deeper", () => {
    mount(PAGE);

    expect(expandedOf("ax-root")).toBe("true");
    expect(expandedOf("nav")).toBe("true");
    expect(expandedOf("main")).toBe("true");
    expect(expandedOf("cart")).toBe("false");
  });

  it("keeps a row the user opened open while a modal dialog takes the page out of the tree, and once it closes", () => {
    mount(PAGE);
    toggle("cart");
    expect(shows("shoes")).toBe(true);

    land(DIALOG);
    // The dialog is a root the tree hasn't been drawn from: it opens, and
    // so do the rows under it, as the page's root and its rows did.
    expect(expandedOf("dialog")).toBe("true");
    expect(expandedOf("form")).toBe("true");
    expect(expandedOf("account")).toBe("false");

    land(PAGE);
    expect(expandedOf("cart")).toBe("true");
    expect(shows("shoes")).toBe(true);
    expect(expandedOf("main")).toBe("true");
  });

  it("keeps a row the user closed closed once a modal dialog closes", () => {
    mount(PAGE);
    toggle("main");
    expect(expandedOf("main")).toBe("false");

    land(DIALOG);
    land(PAGE);

    expect(expandedOf("main")).toBe("false");
    expect(expandedOf("nav")).toBe("true");
  });

  it("keeps what the user opened and closed in a dialog when it opens again", () => {
    mount(PAGE);
    land(DIALOG);
    toggle("form");
    toggle("dialog");
    expect(expandedOf("dialog")).toBe("false");

    land(PAGE);
    land(DIALOG);

    // A root the tree was drawn from before opens nothing by itself.
    expect(expandedOf("dialog")).toBe("false");
    toggle("dialog");
    expect(expandedOf("form")).toBe("false");
  });

  it("keeps the rows the user opened when the root moves from the page's one row at the top to `ax-root`", () => {
    mount(MAIN_ONLY);
    expect(expandedOf("cart")).toBe("false");
    toggle("cart");

    land(MAIN_AND_FOOTER);

    expect(expandedOf("cart")).toBe("true");
    expect(shows("shoes")).toBe(true);
    // The new root opens, and the new row under it with it.
    expect(expandedOf("ax-root")).toBe("true");
    expect(expandedOf("footer")).toBe("true");
  });

  it("opens nothing the user had closed when the page is left with one row at the top", () => {
    mount(PAGE);
    expect(expandedOf("cart")).toBe("false");

    // The navigation went, a cookie banner dismissed, say: main alone is at
    // the top, and roots the read.
    land(
      read(
        "main",
        ["main", "main", "", ["cart"]],
        ["cart", "list", "Cart", ["shoes", "hats"]],
        ["shoes", "listitem", "Shoes"],
        ["hats", "listitem", "Hats"],
      ),
    );

    expect(expandedOf("main")).toBe("true");
    expect(expandedOf("cart")).toBe("false");
  });

  it("keeps the selection on a row under a root the tree moves to, in the render that brings it", () => {
    mount(MAIN_ONLY);
    toggle("cart");
    act(() => row("shoes").click());
    expect(selected()).toBe("shoes");

    land(MAIN_AND_FOOTER);

    expect(expandedOf("ax-root")).toBe("true");
    expect(selected()).toBe("shoes");
  });

  it("starts again from the root and the rows under it on another document, though its ids are the same", () => {
    mount(PAGE);
    toggle("cart");
    toggle("nav");

    // A navigation to the same page in a new renderer, whose numbering of
    // the page's elements starts over: the same ids name new rows.
    land(PAGE, "1 doc-b");

    expect(expandedOf("cart")).toBe("false");
    expect(expandedOf("nav")).toBe("true");
    expect(expandedOf("main")).toBe("true");
  });
});
