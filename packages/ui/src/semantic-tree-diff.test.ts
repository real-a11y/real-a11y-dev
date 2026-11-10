import {
  extractA11yTree,
  extractDomTree,
  rootRowScope,
  type ExtractionResult,
} from "@real-a11y-dev/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { semanticTreeRules } from "./semantic-tree-diff.js";
import { diffTreeRows, type FieldChange } from "./tree-changes-diff.js";

/**
 * What the shared panel's change marks call a change on a row: what the row
 * shows, in its view, and nothing it doesn't.
 */
describe("semanticTreeRules", () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement("div");
    host.innerHTML = `
      <main>
        <button id="open" class="btn" aria-controls="menu" aria-expanded="false">Open</button>
        <div id="title" role="heading" aria-level="2">Title</div>
        <div id="note" role="status" aria-label="Status">Saved</div>
      </main>
    `;
    document.body.appendChild(host);
  });

  afterEach(() => host.remove());

  const extract = (view: "a11y" | "dom") =>
    view === "dom" ? extractDomTree(host) : extractA11yTree(host);

  /** What changed on each row, by its element's id or tag, as `view`
   *  shows it, after `change`. */
  function changesAfter(
    view: "a11y" | "dom",
    change: () => void,
  ): Map<string, readonly FieldChange[]> {
    const before = extract(view);
    change();
    const after: ExtractionResult = extract(view);
    const found = diffTreeRows(before, after, semanticTreeRules(view));
    return new Map(
      [...found.changed].map(([id, changes]) => {
        const dom = after.nodes.get(id)!.dom!;
        return [dom.attributes["id"] ?? dom.tagName, changes];
      }),
    );
  }

  const open = () => host.querySelector("#open")!;

  it("names a state as the row's badges do, and reads which way it went", () => {
    const changed = changesAfter("a11y", () =>
      open().setAttribute("aria-expanded", "true"),
    );
    expect(changed.get("open")).toContainEqual({
      field: "states.expanded",
      before: false,
      after: true,
    });
  });

  it("calls a state that goes off gone, as its badge is", () => {
    open().setAttribute("aria-disabled", "true");
    const changed = changesAfter("a11y", () =>
      open().removeAttribute("aria-disabled"),
    );
    expect(changed.get("open")).toEqual([
      { field: "states.disabled", before: true },
    ]);
  });

  it("compares the name, the heading level and a leaf's text", () => {
    const changed = changesAfter("a11y", () => {
      open().textContent = "Close";
      host.querySelector("#title")!.setAttribute("aria-level", "3");
      host.querySelector("#note")!.textContent = "Saving";
    });
    expect(changed.get("open")).toEqual([
      { field: "name", before: "Open", after: "Close" },
    ]);
    expect(changed.get("title")).toEqual([
      { field: "properties.level", before: "2", after: "3" },
    ]);
    // A leaf named otherwise previews its text after the name.
    expect(changed.get("note")).toEqual([
      { field: "text", before: "Saved", after: "Saving" },
    ]);
  });

  it("marks nothing in the A11Y view for a class it doesn't show", () => {
    const changed = changesAfter("a11y", () =>
      open().setAttribute("class", "btn btn--hover"),
    );
    expect(changed.size).toBe(0);
  });

  it("marks the attributes and text a DOM row shows", () => {
    const changed = changesAfter("dom", () => {
      open().setAttribute("class", "btn btn--hover");
      open().textContent = "Close";
    });
    expect(changed.get("open")).toEqual([
      { field: "attributes.class", before: "btn", after: "btn btn--hover" },
      { field: "text", before: "Open", after: "Close" },
      // The name follows the text, and the DOM row shows no name.
    ]);
  });

  it("compares the rows a row controls", () => {
    const changed = changesAfter("a11y", () =>
      open().setAttribute("aria-controls", "menu other"),
    );
    expect(changed.get("open")).toEqual([
      { field: "controls", before: "menu", after: "menu other" },
    ]);
  });

  it("marks only the overlay a read widened to the whole page brings, and only it gone after", () => {
    // The panel was given <main>; a toast mounting at the page's top level
    // makes the extractor read the whole page, header and all.
    host.innerHTML = `
      <header><nav aria-label="Site"><a href="/">Home</a></nav></header>
      <main><button>Save</button></main>
    `;
    const main = host.querySelector("main")!;
    const rules = semanticTreeRules("a11y", rootRowScope(main));
    const before = extractA11yTree(main);
    const toast = Object.assign(document.createElement("div"), {
      role: "status",
      textContent: "Saved",
    });
    toast.setAttribute("role", "status");
    document.body.appendChild(toast);
    try {
      const wide = extractA11yTree(document.body);
      const opened = diffTreeRows(before, wide, rules);
      const roles = (ids: Iterable<string>) =>
        [...ids].map((id) => wide.nodes.get(id)!.a11y.role);
      expect(roles(opened.added)).toEqual(["status"]);
      expect(opened.removed).toEqual([]);

      toast.remove();
      const after = extractA11yTree(main);
      const closed = diffTreeRows(wide, after, rules);
      expect(closed.added.size).toBe(0);
      expect(closed.removed.map((r) => r.role)).toEqual(["status"]);
    } finally {
      toast.remove();
    }
  });

  it("leaves a shadow tree outside the root out of a widened read, and counts one inside", () => {
    host.innerHTML = `
      <header><div id="card"></div></header>
      <main><div id="widget"></div></main>
    `;
    const shadowButton = (id: string, name: string) => {
      const shadow = host.querySelector(id)!.attachShadow({ mode: "open" });
      shadow.innerHTML = `<button>${name}</button>`;
    };
    shadowButton("#card", "Outside");
    shadowButton("#widget", "Inside");
    const main = host.querySelector("main")!;
    const rules = semanticTreeRules("a11y", rootRowScope(main));
    const before = extractA11yTree(main);
    const toast = document.createElement("div");
    toast.setAttribute("role", "status");
    toast.textContent = "Saved";
    document.body.appendChild(toast);
    try {
      const wide = extractA11yTree(document.body);
      const names = [...wide.nodes.values()].map((n) => n.a11y.name);
      // Both shadow trees are read, and only the toast is new.
      expect(names).toEqual(expect.arrayContaining(["Outside", "Inside"]));
      const added = diffTreeRows(before, wide, rules).added;
      expect([...added].map((id) => wide.nodes.get(id)!.a11y.role)).toEqual([
        "status",
      ]);
    } finally {
      toast.remove();
    }
  });

  it("compares the root's own row, and doesn't take it for gone when a widened read flattens it", () => {
    host.innerHTML = `<main aria-label="Inbox"><button>Open</button></main>`;
    const main = host.querySelector("main")!;
    const rules = semanticTreeRules("a11y", rootRowScope(main));
    const before = extractA11yTree(main);
    main.setAttribute("aria-label", "Archive");
    const renamed = extractA11yTree(main);
    expect(
      Object.fromEntries(diffTreeRows(before, renamed, rules).changed),
    ).toEqual({
      [renamed.rootId]: [{ field: "name", before: "Inbox", after: "Archive" }],
    });

    // A root with no row of its own outside its own read: a plain <div>.
    host.innerHTML = `<div id="app"><button>Open</button></div>`;
    const app = host.querySelector("#app")!;
    const appRules = semanticTreeRules("a11y", rootRowScope(app));
    const narrow = extractA11yTree(app);
    const toast = document.createElement("div");
    toast.setAttribute("role", "status");
    toast.textContent = "Saved";
    document.body.appendChild(toast);
    try {
      const wide = extractA11yTree(document.body);
      expect(wide.nodes.has(narrow.rootId)).toBe(false);
      const widened = diffTreeRows(narrow, wide, appRules);
      expect(widened.removed).toEqual([]);
      expect(
        [...widened.added].map((id) => wide.nodes.get(id)!.a11y.role),
      ).toEqual(["status"]);
    } finally {
      toast.remove();
    }
  });

  it("doesn't count a row outside the root that goes while a read is widened", () => {
    host.innerHTML = `
      <header><a href="/">Home</a></header>
      <main><button>Save</button></main>
    `;
    const main = host.querySelector("main")!;
    const rules = semanticTreeRules("a11y", rootRowScope(main));
    const toast = document.createElement("div");
    toast.setAttribute("role", "status");
    toast.textContent = "Saved";
    document.body.appendChild(toast);
    try {
      const narrow = extractA11yTree(main);
      const wide = extractA11yTree(document.body);
      diffTreeRows(narrow, wide, rules);
      // The header goes from the page while the toast keeps the read wide.
      host.querySelector("header")!.remove();
      const after = extractA11yTree(document.body);
      expect(diffTreeRows(wide, after, rules).removed).toEqual([]);
    } finally {
      toast.remove();
    }
  });

  it("finds a row that goes and one that comes in either view", () => {
    for (const view of ["a11y", "dom"] as const) {
      host.innerHTML = "<main><button>Open</button></main>";
      const before = extract(view);
      host.querySelector("button")!.replaceWith(
        Object.assign(document.createElement("button"), {
          textContent: "Save",
        }),
      );
      const after = extract(view);
      const found = diffTreeRows(before, after, semanticTreeRules(view));
      expect(found.removed.map((r) => r.name)).toEqual(["Open"]);
      expect(
        [...found.added].map((id) => after.nodes.get(id)!.a11y.name),
      ).toContain("Save");
    }
  });
});
