import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  LiveTreeExtractor,
  DomObserver,
  extractA11yTree,
  extractDomTree,
  resetIdCounter,
} from "../index.js";
import type { ExtractionResult, TreeChange } from "../types.js";

describe("LiveTreeExtractor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    resetIdCounter();
  });

  it("produces the same initial tree as extractA11yTree", () => {
    document.body.innerHTML = `
      <main>
        <button>Click me</button>
        <ul>
          <li>One</li>
          <li>Two</li>
        </ul>
      </main>
    `;

    const live = new LiveTreeExtractor(document.body, { mode: "a11y" });
    const expected = extractA11yTree(document.body);
    expect(live.extract()).toEqual(expected);
  });

  it("updates a button name when its text node changes", async () => {
    document.body.innerHTML = `<main><button>Old</button></main>`;

    const live = new LiveTreeExtractor(document.body, { mode: "a11y" });
    let lastChange: TreeChange | undefined;
    const observer = new DomObserver(
      document.body,
      (change) => {
        lastChange = change;
      },
      50,
    );
    observer.start();

    const button = document.querySelector("button")!;
    button.textContent = "New";

    await vi.advanceTimersByTimeAsync(100);

    const result = live.refresh(lastChange);
    const expected = extractA11yTree(document.body);

    expect(result.nodes).toEqual(expected.nodes);
    expect(result.nodes.get(result.rootId!)?.childIds).toHaveLength(1);
    const buttonId = result.nodes.get(result.rootId!)?.childIds[0];
    expect(result.nodes.get(buttonId!)?.a11y.name).toBe("New");

    observer.stop();
  });

  it("updates the tree when a list item is added", async () => {
    document.body.innerHTML = `<main><ul><li>One</li></ul></main>`;

    const live = new LiveTreeExtractor(document.body, { mode: "a11y" });
    let lastChange: TreeChange | undefined;
    const observer = new DomObserver(
      document.body,
      (change) => {
        lastChange = change;
      },
      50,
    );
    observer.start();

    const ul = document.querySelector("ul")!;
    const li = document.createElement("li");
    li.textContent = "Two";
    ul.appendChild(li);

    await vi.advanceTimersByTimeAsync(100);

    const result = live.refresh(lastChange);
    const expected = extractA11yTree(document.body);

    expect(result.nodes).toEqual(expected.nodes);

    const ulId = result.nodes.get(result.rootId!)?.childIds[0];
    expect(result.nodes.get(ulId!)?.childIds).toHaveLength(2);

    observer.stop();
  });

  it("updates an aria-labelledby referrer when the target text changes", async () => {
    document.body.innerHTML = `
      <main>
        <span id="target">Old</span>
        <button aria-labelledby="target"></button>
      </main>
    `;

    const live = new LiveTreeExtractor(document.body, { mode: "a11y" });
    let lastChange: TreeChange | undefined;
    const observer = new DomObserver(
      document.body,
      (change) => {
        lastChange = change;
      },
      50,
    );
    observer.start();

    document.getElementById("target")!.textContent = "New";

    await vi.advanceTimersByTimeAsync(100);

    const result = live.refresh(lastChange);
    const expected = extractA11yTree(document.body);

    expect(result.nodes).toEqual(expected.nodes);

    const buttonId = result.nodes.get(result.rootId!)?.childIds[1];
    expect(result.nodes.get(buttonId!)?.a11y.name).toBe("New");

    observer.stop();
  });

  it("updates a wrapping label's input name when the label text changes", async () => {
    document.body.innerHTML = `
      <main>
        <label>Old <input type="text" /></label>
      </main>
    `;

    const live = new LiveTreeExtractor(document.body, { mode: "a11y" });
    let lastChange: TreeChange | undefined;
    const observer = new DomObserver(
      document.body,
      (change) => {
        lastChange = change;
      },
      50,
    );
    observer.start();

    const label = document.querySelector("label")!;
    label.childNodes[0]!.textContent = "New ";

    await vi.advanceTimersByTimeAsync(100);

    const result = live.refresh(lastChange);
    const expected = extractA11yTree(document.body);

    expect(result.nodes).toEqual(expected.nodes);

    // The label is suppressed; the input is promoted under the main region.
    const inputId = result.nodes.get(result.rootId!)?.childIds[0];
    expect(result.nodes.get(inputId!)?.a11y.name).toBe("New");

    observer.stop();
  });

  it("updates an input's value attribute after an input event", async () => {
    document.body.innerHTML = `<main><input type="text" /></main>`;

    const live = new LiveTreeExtractor(document.body, { mode: "a11y" });
    let lastChange: TreeChange | undefined;
    const observer = new DomObserver(
      document.body,
      (change) => {
        lastChange = change;
      },
      50,
    );
    observer.start();

    const input = document.querySelector("input") as HTMLInputElement;
    input.value = "hello";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.advanceTimersByTimeAsync(100);

    const result = live.refresh(lastChange);
    const expected = extractA11yTree(document.body);

    expect(result.nodes).toEqual(expected.nodes);

    const inputId = result.nodes.get(result.rootId!)?.childIds[0];
    expect(result.nodes.get(inputId!)?.dom.attributes.value).toBe("hello");

    observer.stop();
  });

  it("falls back to a full extract when a reference attribute changes", async () => {
    document.body.innerHTML = `
      <main>
        <span id="target">Old</span>
        <button aria-labelledby="target"></button>
      </main>
    `;

    const live = new LiveTreeExtractor(document.body, { mode: "a11y" });
    let lastChange: TreeChange | undefined;
    const observer = new DomObserver(
      document.body,
      (change) => {
        lastChange = change;
      },
      50,
    );
    observer.start();

    const button = document.querySelector("button")!;
    button.setAttribute("aria-labelledby", "other");

    await vi.advanceTimersByTimeAsync(100);

    const result = live.refresh(lastChange);
    const expected = extractA11yTree(document.body);

    expect(result.nodes).toEqual(expected.nodes);

    observer.stop();
  });

  it("stays correct through multiple incremental updates", async () => {
    document.body.innerHTML = `<main><button>One</button></main>`;

    const live = new LiveTreeExtractor(document.body, { mode: "a11y" });
    const changes: TreeChange[] = [];
    const observer = new DomObserver(
      document.body,
      (change) => {
        changes.push(change);
      },
      50,
    );
    observer.start();

    const button = document.querySelector("button")!;

    button.textContent = "Two";
    await vi.advanceTimersByTimeAsync(100);
    let result = live.refresh(changes[0]);
    expect(result.nodes).toEqual(extractA11yTree(document.body).nodes);

    button.setAttribute("aria-expanded", "true");
    await vi.advanceTimersByTimeAsync(100);
    result = live.refresh(changes[1]);
    expect(result.nodes).toEqual(extractA11yTree(document.body).nodes);

    observer.stop();
  });

  it("supports dom mode", async () => {
    document.body.innerHTML = `<main><div>Old</div></main>`;

    const live = new LiveTreeExtractor(document.body, { mode: "dom" });
    let lastChange: TreeChange | undefined;
    const observer = new DomObserver(
      document.body,
      (change) => {
        lastChange = change;
      },
      50,
    );
    observer.start();

    const div = document.querySelector("div")!;
    div.textContent = "New";

    await vi.advanceTimersByTimeAsync(100);

    const result = live.refresh(lastChange);

    const divId = result.nodes.get(result.rootId!)?.childIds[0];
    expect(result.nodes.get(divId!)?.dom.textContent).toBe("New");

    observer.stop();
  });

  it("includes a portal overlay mounted outside a scoped root", async () => {
    document.body.innerHTML = `<div id="app"><main><button>Open</button></main></div>`;
    const root = document.getElementById("app")!;

    const live = new LiveTreeExtractor(root, { mode: "dom" });
    let lastChange: TreeChange | undefined;
    const observer = new DomObserver(
      root,
      (change) => {
        lastChange = change;
      },
      50,
    );
    observer.start();

    // A dropdown menu portals into <body>, outside the observed root. The
    // primary observer never sees it — only the top-level portal observer does.
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.innerHTML = `<div role="menuitem">Copy</div>`;
    document.body.appendChild(menu);

    await vi.advanceTimersByTimeAsync(100);

    // The portal observer can't map an out-of-root mount to a MutationRecord,
    // so it must flag a full re-extraction rather than a silent no-op.
    expect(lastChange?.full).toBe(true);

    const result = live.refresh(lastChange);
    const expected = extractDomTree(root);

    expect(result.nodes).toEqual(expected.nodes);
    // The extractor pivots to <body> and the portal content joins the tree.
    const roles = [...result.nodes.values()].map((n) => n.a11y.role);
    expect(roles).toContain("menu");
    expect(roles).toContain("menuitem");

    observer.stop();
  });

  it("drops a dangling child reference when an element is hidden (dom mode)", async () => {
    document.body.innerHTML = `<main><button>Btn</button><div id="panel"><p>Content</p></div></main>`;

    const live = new LiveTreeExtractor(document.body, { mode: "dom" });
    let lastChange: TreeChange | undefined;
    const observer = new DomObserver(
      document.body,
      (change) => {
        lastChange = change;
      },
      50,
    );
    observer.start();

    const panel = document.getElementById("panel")!;
    panel.style.display = "none";

    await vi.advanceTimersByTimeAsync(100);

    const result = live.refresh(lastChange);
    const expected = extractDomTree(document.body);

    expect(result.nodes).toEqual(expected.nodes);

    // Every child id must resolve to a node — no dangling references.
    for (const node of result.nodes.values()) {
      for (const childId of node.childIds) {
        expect(result.nodes.has(childId)).toBe(true);
      }
    }

    observer.stop();
  });

  it("updates a name-host's name when nested text changes via childList", async () => {
    document.body.innerHTML = `<main><button><span class="label"><em>Old</em></span></button></main>`;

    const live = new LiveTreeExtractor(document.body, { mode: "a11y" });
    let lastChange: TreeChange | undefined;
    const observer = new DomObserver(
      document.body,
      (change) => {
        lastChange = change;
      },
      50,
    );
    observer.start();

    // Replacing the span's content swaps its <em> child for a text node,
    // producing a childList mutation on the span (not characterData).
    const span = document.querySelector("span.label")!;
    span.textContent = "New";

    await vi.advanceTimersByTimeAsync(100);

    const result = live.refresh(lastChange);
    const expected = extractA11yTree(document.body);

    expect(result.nodes).toEqual(expected.nodes);

    const buttonId = result.nodes.get(result.rootId!)?.childIds[0];
    expect(result.nodes.get(buttonId!)?.a11y.name).toBe("New");

    observer.stop();
  });

  it("updates an enclosing name-host when a descendant widget's attribute changes", async () => {
    // A named widget contributes its COMPUTED name to a name-from-content
    // host, so the heading is named "API docs" (the link's aria-label).
    document.body.innerHTML = `<main><h3><a href="#" aria-label="API docs">config.ts</a></h3></main>`;

    const live = new LiveTreeExtractor(document.body, { mode: "a11y" });
    let lastChange: TreeChange | undefined;
    const observer = new DomObserver(
      document.body,
      (change) => {
        lastChange = change;
      },
      50,
    );
    observer.start();

    // Only the inner link's aria-label changes; the enclosing heading's name
    // is derived from that link, so the heading must be re-extracted too.
    const link = document.querySelector("a")!;
    link.setAttribute("aria-label", "README");

    await vi.advanceTimersByTimeAsync(100);

    const result = live.refresh(lastChange);
    const expected = extractA11yTree(document.body);

    expect(result.nodes).toEqual(expected.nodes);

    const heading = [...result.nodes.values()].find(
      (n) => n.a11y.role === "heading",
    );
    expect(heading?.a11y.name).toBe("README");

    observer.stop();
  });

  it("refreshes an aria-labelledby referrer when text changes inside a name host", async () => {
    document.body.innerHTML = `<main><h3><span id="lbl">Old</span></h3><button aria-labelledby="lbl">x</button></main>`;

    const live = new LiveTreeExtractor(document.body, { mode: "a11y" });
    let lastChange: TreeChange | undefined;
    const observer = new DomObserver(
      document.body,
      (change) => {
        lastChange = change;
      },
      50,
    );
    observer.start();

    // Edit the text node directly so this arrives as a characterData mutation.
    // The label text lives in a <span id="lbl"> nested inside a name-host <h3>,
    // and a <button aria-labelledby="lbl"> outside the host borrows its name.
    const span = document.getElementById("lbl")!;
    span.firstChild!.nodeValue = "New";

    await vi.advanceTimersByTimeAsync(100);

    const result = live.refresh(lastChange);
    const expected = extractA11yTree(document.body);

    expect(result.nodes).toEqual(expected.nodes);

    const button = [...result.nodes.values()].find(
      (n) => n.a11y.role === "button",
    );
    expect(button?.a11y.name).toBe("New");

    observer.stop();
  });

  it("updates a name host when a descendant gains a name-barrier role", async () => {
    document.body.innerHTML = `<main><button><span>Save</span></button></main>`;

    const live = new LiveTreeExtractor(document.body, { mode: "a11y" });
    let lastChange: TreeChange | undefined;
    const observer = new DomObserver(
      document.body,
      (change) => {
        lastChange = change;
      },
      50,
    );
    observer.start();

    // Making the span a name-barrier role removes its text from the button's
    // computed name. The post-mutation role would stop the ancestor climb at
    // the span, so the enclosing button must still be re-extracted.
    const span = document.querySelector("span")!;
    span.setAttribute("role", "list");

    await vi.advanceTimersByTimeAsync(100);

    const result = live.refresh(lastChange);
    const expected = extractA11yTree(document.body);

    expect(result.nodes).toEqual(expected.nodes);

    const button = [...result.nodes.values()].find(
      (n) => n.a11y.role === "button",
    );
    // A barrier-role descendant no longer contributes to the button's name.
    expect(button?.a11y.name).not.toBe("Save");

    observer.stop();
  });

  it("invalidates an aria-labelledby referrer when its nested target is removed", async () => {
    // The referrer button sits in a different container than the removed
    // wrapper, so re-extracting only the mutation target's subtree would miss
    // it — the fix must find the referrer via the wrapper's nested id.
    document.body.innerHTML = `<main><section id="host"><div id="wrap"><span id="lbl">Old</span></div></section><button aria-labelledby="lbl">x</button></main>`;

    const live = new LiveTreeExtractor(document.body, { mode: "a11y" });
    let lastChange: TreeChange | undefined;
    const observer = new DomObserver(
      document.body,
      (change) => {
        lastChange = change;
      },
      50,
    );
    observer.start();

    // The removed node is the wrapper; the referenced id lives on a descendant,
    // so the button's name still has to be recomputed against a full extract.
    document.getElementById("wrap")!.remove();

    await vi.advanceTimersByTimeAsync(100);

    const result = live.refresh(lastChange);
    const expected = extractA11yTree(document.body);

    expect(result.nodes).toEqual(expected.nodes);

    observer.stop();
  });

  it("keeps parity when a node is reparented between siblings", async () => {
    document.body.innerHTML = `<main><ul id="a"><li>One</li></ul><ul id="b"></ul></main>`;

    const live = new LiveTreeExtractor(document.body, { mode: "a11y" });
    let lastChange: TreeChange | undefined;
    const observer = new DomObserver(
      document.body,
      (change) => {
        lastChange = change;
      },
      50,
    );
    observer.start();

    const li = document.querySelector("#a li")!;
    document.getElementById("b")!.appendChild(li);

    await vi.advanceTimersByTimeAsync(100);

    const result = live.refresh(lastChange);
    const expected = extractA11yTree(document.body);

    expect(result.nodes).toEqual(expected.nodes);

    // Every child id resolves to a node — no dangling reference after the move.
    for (const node of result.nodes.values()) {
      for (const childId of node.childIds) {
        expect(result.nodes.has(childId)).toBe(true);
      }
    }

    observer.stop();
  });

  it("updates the outermost host when a nested host's text changes", async () => {
    document.body.innerHTML = `<main><a href="#"><h3>Old</h3></a></main>`;

    const live = new LiveTreeExtractor(document.body, { mode: "a11y" });
    let lastChange: TreeChange | undefined;
    const observer = new DomObserver(
      document.body,
      (change) => {
        lastChange = change;
      },
      50,
    );
    observer.start();

    // Both the heading and the enclosing link derive their name from this
    // text, so re-extracting only the innermost host would leave the link
    // name stale.
    const heading = document.querySelector("h3")!;
    heading.textContent = "New";

    await vi.advanceTimersByTimeAsync(100);

    const result = live.refresh(lastChange);
    const expected = extractA11yTree(document.body);

    expect(result.nodes).toEqual(expected.nodes);

    const names = [...result.nodes.values()].map((n) => n.a11y.name);
    expect(names).toContain("New");
    expect(names).not.toContain("Old");

    observer.stop();
  });

  describe("extraction scope", () => {
    /**
     * A synthetic attribute change. The scope logic under test lives in
     * `refresh`, so drive it directly rather than through DomObserver's
     * debounce — and for an out-of-root overlay the primary observer would
     * never deliver the record anyway.
     */
    const attrChange = (
      target: Element,
      attributeName: string,
    ): TreeChange => ({
      mutations: [
        {
          type: "attributes",
          target,
          attributeName,
        } as unknown as MutationRecord,
      ],
    });

    const firstNodeWithTag = (result: ExtractionResult, tag: string) =>
      [...result.nodes.values()].find((n) => n.dom.tagName === tag);

    it("re-scopes to a modal when aria-modal is toggled on in place", () => {
      document.body.innerHTML = `
        <main id="app">
          <p>Background</p>
          <div id="dlg" role="dialog"><button>Confirm</button></div>
        </main>
      `;
      const root = document.getElementById("app")!;
      const live = new LiveTreeExtractor(root, { mode: "a11y" });

      const dlg = document.getElementById("dlg")!;
      dlg.setAttribute("aria-modal", "true");

      const result = live.refresh(attrChange(dlg, "aria-modal"));
      const expected = extractA11yTree(root);

      // Scoping is EXCLUSIVE to the modal: content behind it is inert to AT.
      expect(result.rootId).toBe(expected.rootId);
      expect(result.nodes).toEqual(expected.nodes);
      const names = [...result.nodes.values()].map((n) => n.a11y.name);
      expect(names).not.toContain("Background");
    });

    it("restores the surrounding tree when aria-modal is removed in place", () => {
      document.body.innerHTML = `
        <main id="app">
          <p>Background</p>
          <div id="dlg" role="dialog" aria-modal="true">
            <button>Confirm</button>
          </div>
        </main>
      `;
      const root = document.getElementById("app")!;
      const live = new LiveTreeExtractor(root, { mode: "a11y" });

      const dlg = document.getElementById("dlg")!;
      dlg.removeAttribute("aria-modal");

      const result = live.refresh(attrChange(dlg, "aria-modal"));
      const expected = extractA11yTree(root);

      // Without a scope re-check the tree stays rooted at the closed dialog
      // and the rest of the page never comes back.
      expect(result.rootId).toBe(expected.rootId);
      expect(result.nodes).toEqual(expected.nodes);
      expect(
        [...result.nodes.values()].some(
          (n) => n.dom.textContent === "Background",
        ),
      ).toBe(true);
    });

    it("un-pivots when an out-of-root overlay loses its overlay role", () => {
      // The overlay sits inside a portal wrapper rather than directly under
      // <body>: a direct child would make the `role` name-host climb add <body>
      // (the effective root) to the dirty set, tripping the existing
      // "effective root dirty alongside others" guard and masking the scope bug.
      document.body.innerHTML = `
        <main id="app"><p>Background</p></main>
        <div id="portal">
          <div id="menu" role="menu"><button>Item</button></div>
        </div>
      `;
      const root = document.getElementById("app")!;
      const live = new LiveTreeExtractor(root, { mode: "a11y" });

      // The portal overlay pivots extraction to <body> so it joins the tree.
      const menu = document.getElementById("menu")!;
      menu.removeAttribute("role");

      const result = live.refresh(attrChange(menu, "role"));
      const expected = extractA11yTree(root);

      expect(result.rootId).toBe(expected.rootId);
      expect(result.nodes).toEqual(expected.nodes);
    });

    it("keeps repositioning an open overlay incremental", () => {
      document.body.innerHTML = `
        <main id="app"><p>Background</p></main>
        <div id="menu" role="menu"><button>Item</button></div>
      `;
      const root = document.getElementById("app")!;
      const live = new LiveTreeExtractor(root, { mode: "dom" });

      const before = live.extract();
      const backgroundBefore = firstNodeWithTag(before, "p");
      expect(backgroundBefore).toBeDefined();

      // Floating-UI-style reposition: inline style churn on the open menu.
      // The scope is unchanged, so this must NOT trigger a full re-extract.
      const menu = document.getElementById("menu")!;
      menu.setAttribute("style", "transform: translate(10px, 0)");
      const after = live.refresh(attrChange(menu, "style"));

      // A full extraction rebuilds every node object; an incremental splice
      // leaves untouched nodes referentially identical.
      expect(firstNodeWithTag(after, "p")).toBe(backgroundBefore);
    });
  });
});
