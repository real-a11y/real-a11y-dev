import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  LiveTreeExtractor,
  DomObserver,
  extractA11yTree,
  extractDomTree,
  resetIdCounter,
} from "../index.js";
import { clobber, shadow } from "../test-support/clobber.js";
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
    expect(result.nodes.get(inputId!)?.dom?.attributes.value).toBe("hello");
    // The announced value follows the typing too (ADR-0001).
    expect(result.nodes.get(inputId!)?.a11y.value).toBe("hello");

    observer.stop();
  });

  describe("a field's value, when what changed is beneath or beside it (ADR-0001)", () => {
    /** Refresh after `mutate` (no input event) and return the live and a
     *  freshly extracted tree, which must agree. */
    async function refreshAfter(html: string, mutate: () => void) {
      document.body.innerHTML = html;
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
      mutate();
      await vi.advanceTimersByTimeAsync(100);
      const result = live.refresh(lastChange);
      observer.stop();
      return { result, expected: extractA11yTree(document.body), lastChange };
    }
    const valueOf = (tree: ExtractionResult, role: string) =>
      [...tree.nodes.values()].find((n) => n.a11y.role === role)?.a11y.value;

    it("re-reads an editor's value when text inside it changes with no input event", async () => {
      // A remote collaborator's edit: the paragraph's text node changes, and
      // nothing fires on the editor itself.
      const { result, expected } = await refreshAfter(
        `<main><div contenteditable="true" role="textbox" aria-label="Doc"><p>Old</p></div></main>`,
        () => {
          document.querySelector("p")!.firstChild!.textContent = "New";
        },
      );
      expect(valueOf(result, "textbox")).toBe("New");
      expect(result.nodes).toEqual(expected.nodes);
    });

    it("re-reads a <select>'s value when its selected option is relabelled", async () => {
      const { result, expected } = await refreshAfter(
        `<main><select aria-label="Country"><option selected>Spain</option></select></main>`,
        () => {
          document.querySelector("option")!.textContent = "España";
        },
      );
      expect(valueOf(result, "combobox")).toBe("España");
      expect(result.nodes).toEqual(expected.nodes);
    });

    it("re-reads a slider when only its aria-valuetext changes", async () => {
      const { result, expected, lastChange } = await refreshAfter(
        `<main><div role="slider" aria-label="Rating" tabindex="0" aria-valuenow="4" aria-valuetext="four stars"></div></main>`,
        () => {
          document
            .querySelector("[role=slider]")!
            .setAttribute("aria-valuetext", "five stars");
        },
      );
      expect(lastChange).toBeDefined(); // the observer saw it at all
      expect(valueOf(result, "slider")).toBe("five stars");
      expect(result.nodes).toEqual(expected.nodes);
    });
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
    // `DomObserver`'s callback is `(change?: TreeChange)`, and `refresh` accepts
    // the same optional — a debounced batch can coalesce to "something moved,
    // no usable delta". Recording that faithfully is the point: typing this
    // `TreeChange[]` would have the test assert a guarantee the observer never
    // made.
    const changes: (TreeChange | undefined)[] = [];
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

  // An editor toggled read-only (ProseMirror's `editable: false` flips the
  // host to contenteditable="false") gives every link inside it back its
  // focusability, and turns the host itself back into a plain container.
  it("refreshes an editor's links when its contenteditable toggles", async () => {
    document.body.innerHTML = `<main><div id="ed" contenteditable="true" role="textbox" aria-label="Message"><p>See <a href="/x">docs</a></p></div></main>`;

    const live = new LiveTreeExtractor(document.body, { mode: "a11y" });
    // Optional, as the observer's callback is — see the test above.
    const changes: (TreeChange | undefined)[] = [];
    const observer = new DomObserver(
      document.body,
      (change) => {
        changes.push(change);
      },
      50,
    );
    observer.start();

    const focusable = (result: ExtractionResult) =>
      [...result.nodes.values()]
        .filter((n) => n.interaction?.isFocusable)
        .map((n) => n.a11y.role);
    expect(focusable(live.extract())).toEqual(["textbox"]);

    document.getElementById("ed")!.setAttribute("contenteditable", "false");
    await vi.advanceTimersByTimeAsync(100);
    let result = live.refresh(changes[0]);
    expect(result.nodes).toEqual(extractA11yTree(document.body).nodes);
    expect(focusable(result)).toEqual(["link"]);

    document.getElementById("ed")!.setAttribute("contenteditable", "true");
    await vi.advanceTimersByTimeAsync(100);
    result = live.refresh(changes[1]);
    expect(result.nodes).toEqual(extractA11yTree(document.body).nodes);
    expect(focusable(result)).toEqual(["textbox"]);

    observer.stop();
  });

  // An editable button has no name of its own, but its text still names the
  // heading around it. Named widgets aren't name barriers, so the refresh
  // climbs past the button to the heading.
  it("refreshes a heading's name when an editable button inside it is edited", async () => {
    document.body.innerHTML = `<main><h2>Before <button contenteditable="true">Save</button> after</h2></main>`;

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

    document.querySelector("button")!.firstChild!.textContent = "Send";
    await vi.advanceTimersByTimeAsync(100);
    const result = live.refresh(lastChange);

    expect(result.nodes).toEqual(extractA11yTree(document.body).nodes);
    const heading = [...result.nodes.values()].find(
      (n) => n.a11y.role === "heading",
    );
    expect(heading?.a11y.name).toBe("Before Send after");

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
    expect(result.nodes.get(divId!)?.dom?.textContent).toBe("New");

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

  it("updates a table name when its caption text changes", async () => {
    document.body.innerHTML = `<main><table><caption>Q3 results</caption><tbody><tr><td>x</td></tr></tbody></table></main>`;

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

    document.querySelector("caption")!.textContent = "Q4 results";
    await vi.advanceTimersByTimeAsync(100);

    const result = live.refresh(lastChange);
    const expected = extractA11yTree(document.body);
    expect(result.nodes).toEqual(expected.nodes);
    const table = [...result.nodes.values()].find(
      (n) => n.a11y.role === "table",
    );
    expect(table?.a11y.name).toBe("Q4 results");

    observer.stop();
  });

  it("updates a fieldset name when its legend text changes", async () => {
    document.body.innerHTML = `<main><fieldset><legend>Old</legend><input aria-label="x" /></fieldset></main>`;

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

    document.querySelector("legend")!.textContent = "New";
    await vi.advanceTimersByTimeAsync(100);

    const result = live.refresh(lastChange);
    expect(result.nodes).toEqual(extractA11yTree(document.body).nodes);
    const group = [...result.nodes.values()].find(
      (n) => n.a11y.role === "group",
    );
    expect(group?.a11y.name).toBe("New");

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

  // An input's role follows the <datalist> its `list` names, which can sit
  // anywhere in the tree and come or go after the input does.
  it.each([
    [
      "its datalist is added",
      `<input aria-label="Fruit" list="fruits"><section id="host"></section>`,
      () =>
        document.getElementById("host")!.append(
          Object.assign(document.createElement("datalist"), {
            id: "fruits",
          }),
        ),
      "combobox",
    ],
    [
      "its datalist is removed",
      `<input aria-label="Fruit" list="fruits"><section><div id="wrap"><datalist id="fruits"></datalist></div></section>`,
      () => document.getElementById("wrap")!.remove(),
      "textbox",
    ],
    [
      "its list starts naming a datalist",
      `<input aria-label="Fruit"><datalist id="fruits"></datalist>`,
      () => document.querySelector("input")!.setAttribute("list", "fruits"),
      "combobox",
    ],
  ])("re-reads an input's role when %s", async (_label, html, mutate, role) => {
    document.body.innerHTML = `<main>${html}</main>`;

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

    mutate();

    await vi.advanceTimersByTimeAsync(100);

    const result = live.refresh(lastChange);
    const expected = extractA11yTree(document.body);

    expect(result.nodes).toEqual(expected.nodes);
    const input = [...result.nodes.values()].find(
      (n) => n.a11y.name === "Fruit",
    );
    expect(input?.a11y.role).toBe(role);

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

  // A heading names itself through a `<details>` it contains (its summary, or
  // all of it once open), so an edit inside the disclosure must re-extract the
  // heading. The climb used to stop at `<details>` as a group barrier.
  // The a11y projection is rebuilt from the root on every refresh, and it
  // drops a non-exposed node's whole subtree, so an incremental update can't
  // bring an aria-hidden descendant back.
  describe("aria-hidden subtrees across a refresh", () => {
    async function refreshAfter(html: string, mutate: () => void) {
      document.body.innerHTML = html;
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
      mutate();
      await vi.advanceTimersByTimeAsync(100);
      const result = live.refresh(lastChange);
      observer.stop();
      return result;
    }

    it("drops the descendants when a container becomes aria-hidden", async () => {
      const result = await refreshAfter(
        `<main><div id="c"><h2>Behind a modal</h2><button>Act</button></div></main>`,
        () => document.getElementById("c")!.setAttribute("aria-hidden", "true"),
      );
      const names = [...result.nodes.values()].map((n) => n.a11y.name);
      expect(names).not.toContain("Behind a modal");
      expect(names).not.toContain("Act");
      expect(result.nodes).toEqual(extractA11yTree(document.body).nodes);
    });

    it("does not add a heading inserted inside an aria-hidden container", async () => {
      const result = await refreshAfter(
        `<main><div id="c" aria-hidden="true"><p>Old</p></div><h2>Shown</h2></main>`,
        () => {
          const h = document.createElement("h2");
          h.textContent = "Inserted";
          document.getElementById("c")!.appendChild(h);
        },
      );
      const names = [...result.nodes.values()].map((n) => n.a11y.name);
      expect(names).toContain("Shown");
      expect(names).not.toContain("Inserted");
      expect(result.nodes).toEqual(extractA11yTree(document.body).nodes);
    });
  });

  // A node can inherit `disabled` from an ancestor. The refresh re-extracts
  // only the mutated subtree, which holds every node whose state moved.
  describe("an inherited disabled state across a refresh", () => {
    async function refreshAfter(html: string, mutate: () => void) {
      document.body.innerHTML = html;
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
      mutate();
      await vi.advanceTimersByTimeAsync(100);
      const result = live.refresh(lastChange);
      observer.stop();
      return result;
    }

    function disabledOf(result: ExtractionResult, name: string): unknown {
      const node = [...result.nodes.values()].find((n) => n.a11y.name === name);
      expect(node).toBeDefined();
      return node!.a11y.states["disabled"];
    }

    it("follows an ancestor's aria-disabled on and off", async () => {
      const html = `<main><div id="g" role="group" aria-label="Pay"><div><button>Send</button></div></div></main>`;
      const on = await refreshAfter(html, () =>
        document.getElementById("g")!.setAttribute("aria-disabled", "true"),
      );
      expect(disabledOf(on, "Send")).toBe(true);
      expect(on.nodes).toEqual(extractA11yTree(document.body).nodes);

      const off = await refreshAfter(
        html.replace('id="g"', 'id="g" aria-disabled="true"'),
        () => document.getElementById("g")!.removeAttribute("aria-disabled"),
      );
      expect(disabledOf(off, "Send")).toBeUndefined();
      expect(off.nodes).toEqual(extractA11yTree(document.body).nodes);
    });

    it("disables a button moved into an aria-disabled group", async () => {
      const result = await refreshAfter(
        `<main><div id="g" role="group" aria-label="Pay" aria-disabled="true"></div><button>Send</button></main>`,
        () =>
          document
            .getElementById("g")!
            .appendChild(document.querySelector("button")!),
      );
      expect(disabledOf(result, "Send")).toBe(true);
      expect(result.nodes).toEqual(extractA11yTree(document.body).nodes);
    });

    it("follows a select's disabled onto its options", async () => {
      const result = await refreshAfter(
        `<main><select id="s" aria-label="Size"><option>Small</option></select></main>`,
        () => document.getElementById("s")!.setAttribute("disabled", ""),
      );
      expect(disabledOf(result, "Small")).toBe(true);
      expect(result.nodes).toEqual(extractA11yTree(document.body).nodes);
    });
  });

  // A click on one checkbox or radio fires its events on that one alone, yet
  // can move other controls' checkedness, which no attribute reflects.
  describe("checkedness a change moves elsewhere", () => {
    async function refreshAfter(html: string, mutate: () => void) {
      document.body.innerHTML = html;
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
      mutate();
      await vi.advanceTimersByTimeAsync(100);
      const result = live.refresh(lastChange);
      observer.stop();
      return result;
    }

    function checkedOf(result: ExtractionResult, name: string): unknown {
      const node = [...result.nodes.values()].find((n) => n.a11y.name === name);
      expect(node).toBeDefined();
      return node!.a11y.states["checked"];
    }

    it("unchecks the radio its sibling replaced", async () => {
      const result = await refreshAfter(
        `<main><input type="radio" name="size" aria-label="Small" checked><input id="large" type="radio" name="size" aria-label="Large"></main>`,
        () => document.getElementById("large")!.click(),
      );
      expect(checkedOf(result, "Small")).toBe(false);
      expect(checkedOf(result, "Large")).toBe(true);
      expect(result.nodes).toEqual(extractA11yTree(document.body).nodes);
    });

    it("unchecks the radio a sibling's checked attribute replaced", async () => {
      const result = await refreshAfter(
        `<main><input type="radio" name="size" aria-label="Small" checked><input id="large" type="radio" name="size" aria-label="Large"></main>`,
        () => document.getElementById("large")!.setAttribute("checked", ""),
      );
      expect(checkedOf(result, "Small")).toBe(false);
      expect(checkedOf(result, "Large")).toBe(true);
      expect(result.nodes).toEqual(extractA11yTree(document.body).nodes);
    });

    it("marks mixed the box a handler made indeterminate", async () => {
      const result = await refreshAfter(
        `<main><input id="all" type="checkbox" aria-label="All"><ul><li><input id="one" type="checkbox" aria-label="One"></li><li><input type="checkbox" aria-label="Two"></li></ul></main>`,
        () => {
          const all = document.getElementById("all") as HTMLInputElement;
          const one = document.getElementById("one")!;
          one.addEventListener("change", () => {
            all.indeterminate = true;
          });
          one.click();
        },
      );
      expect(checkedOf(result, "All")).toBe("mixed");
      expect(checkedOf(result, "One")).toBe(true);
      expect(result.nodes).toEqual(extractA11yTree(document.body).nodes);
    });

    it.each([
      ["1", "3", undefined],
      ["3", "1", false],
    ])("follows a select's size from %s to %s", async (from, to, expanded) => {
      document.body.innerHTML = `<main><select id="s" size="${from}" aria-label="Items"><option>A</option><option>B</option></select></main>`;
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
      document.getElementById("s")!.setAttribute("size", to);
      await vi.advanceTimersByTimeAsync(100);
      observer.stop();
      // The size change alone has to wake the tree.
      expect(lastChange).toBeDefined();
      const result = live.refresh(lastChange);
      const select = [...result.nodes.values()].find(
        (n) => n.a11y.name === "Items",
      );
      expect(select?.a11y.states["expanded"]).toBe(expanded);
      expect(result.nodes).toEqual(extractA11yTree(document.body).nodes);
    });

    // Opening a picker changes no attribute and fires no event, so it shows
    // only when something else refreshes the tree. jsdom has no picker: stand
    // one in through `:open`.
    it("re-reads a drop-down's picker when something else refreshes", async () => {
      const matches = Element.prototype.matches;
      const spy = vi
        .spyOn(Element.prototype, "matches")
        .mockImplementation(function (this: Element, selector: string) {
          if (selector === ":open")
            return this.id === "size" && document.body.dataset.open === "1";
          return matches.call(this, selector);
        });
      try {
        const result = await refreshAfter(
          `<main><select id="size" aria-label="Size"><option>S</option></select><p id="p">Old</p></main>`,
          () => {
            document.body.dataset.open = "1";
            document.getElementById("p")!.textContent = "New";
          },
        );
        const select = [...result.nodes.values()].find(
          (n) => n.a11y.name === "Size",
        );
        expect(select?.a11y.states["expanded"]).toBe(true);
        expect(result.nodes).toEqual(extractA11yTree(document.body).nodes);
      } finally {
        spy.mockRestore();
        delete document.body.dataset.open;
      }
    });
  });

  describe("a heading named through a <details>", () => {
    async function refreshAfter(mutate: () => void) {
      document.body.innerHTML = `<main><h3>A <details><summary>Old</summary>Body</details></h3></main>`;
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
      mutate();
      await vi.advanceTimersByTimeAsync(100);
      const result = live.refresh(lastChange);
      observer.stop();
      const heading = [...result.nodes.values()].find(
        (n) => n.a11y.role === "heading",
      )!;
      return { result, heading };
    }

    it("follows an edit to the summary text", async () => {
      const { result, heading } = await refreshAfter(() => {
        document.querySelector("summary")!.textContent = "New";
      });
      expect(heading.a11y.name).toBe("A New");
      expect(result.nodes).toEqual(extractA11yTree(document.body).nodes);
    });

    it("follows the disclosure opening", async () => {
      const { result, heading } = await refreshAfter(() => {
        document.querySelector("details")!.setAttribute("open", "");
      });
      expect(heading.a11y.name).toBe("A Old Body");
      expect(result.nodes).toEqual(extractA11yTree(document.body).nodes);
    });
  });

  // Focusability can hang on an element outside the node's own subtree: an
  // <area> is a stop only while an <img usemap> names its map and is rendered,
  // and a control is disabled by an ancestor <fieldset>. Each case must come
  // out of a refresh the way a fresh extraction would.
  describe("focusability that depends on another element", () => {
    // Chromium's UA sheet gives every <area> `display: none` since 153, as
    // jsdom's does. Say so here rather than lean on jsdom: the walk has to
    // reach the areas through their image all the same.
    beforeEach(() => {
      const style = document.createElement("style");
      style.id = "render-areas";
      style.textContent = "area { display: none }";
      document.head.append(style);
    });
    afterEach(() => {
      document.getElementById("render-areas")?.remove();
    });

    async function refreshAfter(html: string, mutate: () => void) {
      // Inside <main>, so a mutation isn't at the root, where the extractor
      // always re-extracts the whole tree whatever changed.
      document.body.innerHTML = `<main>${html}</main>`;
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
      mutate();
      await vi.advanceTimersByTimeAsync(100);
      // No change at all would leave an open panel on the old tree, while
      // `refresh(undefined)` re-extracts everything and would hide that.
      expect(lastChange).toBeDefined();
      const result = live.refresh(lastChange);
      observer.stop();
      return result;
    }

    function focusableIds(result: ExtractionResult): string[] {
      return [...result.nodes.values()]
        .filter((n) => n.interaction?.isFocusable)
        .map((n) => n.dom?.attributes["id"] ?? "");
    }

    const MAPS = `
      <div id="figure"><img src="x.gif" alt="Plan" usemap="#a"></div>
      <div>
        <map name="a"><area id="in-a" href="/a" alt="A"></map>
        <map name="b"><area id="in-b" href="/b" alt="B"></map>
      </div>
    `;

    it("moves the stop when an image points at another map", async () => {
      const result = await refreshAfter(MAPS, () =>
        document.querySelector("img")!.setAttribute("usemap", "#b"),
      );
      expect(focusableIds(result)).toEqual(["in-b"]);
      expect(result.nodes).toEqual(extractDomTree(document.body).nodes);
    });

    it("drops the stop when the map is renamed away from the image", async () => {
      const result = await refreshAfter(MAPS, () =>
        document.querySelector('map[name="a"]')!.setAttribute("name", "c"),
      );
      expect(focusableIds(result)).toEqual([]);
      expect(result.nodes).toEqual(extractDomTree(document.body).nodes);
    });

    it("adds the stop when an image using the map is inserted", async () => {
      const result = await refreshAfter(MAPS, () => {
        const img = document.createElement("img");
        img.setAttribute("usemap", "#b");
        img.setAttribute("alt", "Second plan");
        document.getElementById("figure")!.append(img);
      });
      expect(focusableIds(result)).toEqual(["in-a", "in-b"]);
      expect(result.nodes).toEqual(extractDomTree(document.body).nodes);
    });

    it("drops the stop when the image using the map is removed", async () => {
      const result = await refreshAfter(MAPS, () =>
        document.querySelector("img")!.remove(),
      );
      expect(focusableIds(result)).toEqual([]);
      expect(result.nodes).toEqual(extractDomTree(document.body).nodes);
    });

    // A map's areas are rendered only while the image using it is, and the
    // image can be hidden from anywhere above it. The map sits elsewhere, so
    // re-extracting what changed would leave its areas as they were.
    it.each([
      ["the image", "img", "hidden", ""],
      ["the image", "img", "style", "visibility: hidden"],
      ["its container", "#figure", "style", "display: none"],
      ["its container", "#figure", "inert", ""],
      ["its container", "#figure", "class", "gone"],
    ])(
      "drops the areas when %s is hidden (%s[%s])",
      async (_what, selector, attr, value) => {
        const html = `<style>.gone { display: none }</style>${MAPS}`;
        const result = await refreshAfter(html, () =>
          document.querySelector(selector)!.setAttribute(attr, value),
        );
        expect(
          [...result.nodes.values()].filter((n) => n.dom?.tagName === "area"),
        ).toEqual([]);
        expect(result.nodes).toEqual(extractDomTree(document.body).nodes);
      },
    );

    it("brings the areas back when the image shows again, splicing in the map", () => {
      // `visibility` keeps the figure's node, so the refresh can splice: the
      // figure's subtree, and the map, which is nowhere inside it.
      document.body.innerHTML = `<main>${MAPS}</main>`;
      const figure = document.getElementById("figure")!;
      figure.setAttribute("style", "visibility: hidden");
      const live = new LiveTreeExtractor(document.body, { mode: "dom" });
      expect(focusableIds(live.extract())).toEqual([]);

      figure.removeAttribute("style");
      const full = vi.spyOn(live, "extract");
      const result = live.refresh({
        mutations: [
          {
            type: "attributes",
            target: figure,
            attributeName: "style",
          } as unknown as MutationRecord,
        ],
      });

      expect(full).not.toHaveBeenCalled();
      expect(focusableIds(result)).toEqual(["in-a"]);
      expect(result.nodes).toEqual(extractDomTree(document.body).nodes);
    });

    it("hides the areas from AT when the image turns aria-hidden", async () => {
      const result = await refreshAfter(MAPS, () =>
        document.querySelector("img")!.setAttribute("aria-hidden", "true"),
      );
      const area = [...result.nodes.values()].find(
        (n) => n.dom?.attributes["id"] === "in-a",
      )!;
      expect(area.a11y.isExposedToAT).toBe(false);
      expect(result.nodes).toEqual(extractDomTree(document.body).nodes);
    });

    it("follows a fieldset being disabled, slotted controls included", () => {
      document.body.innerHTML = `<main><fieldset id="fs">
        <button id="direct">Save</button>
        <x-host id="host"><button id="slotted">Send</button></x-host>
      </fieldset></main>`;
      document
        .getElementById("host")!
        .attachShadow({ mode: "open" }).innerHTML = "<slot></slot>";
      const live = new LiveTreeExtractor(document.body, { mode: "dom" });
      live.extract();

      const fieldset = document.getElementById("fs")!;
      fieldset.setAttribute("disabled", "");
      // Spy after the first extract: the refresh must splice the fieldset's
      // subtree, and the slotted button is in it, since every DOM descendant
      // of the fieldset is also one in the flat tree the walk descends.
      const full = vi.spyOn(live, "extract");
      const result = live.refresh({
        mutations: [
          {
            type: "attributes",
            target: fieldset,
            attributeName: "disabled",
          } as unknown as MutationRecord,
        ],
      });

      expect(full).not.toHaveBeenCalled();
      expect(focusableIds(result)).not.toContain("direct");
      expect(focusableIds(result)).not.toContain("slotted");
      expect(result.nodes).toEqual(extractDomTree(document.body).nodes);
    });

    // Only a details' first summary child is a stop, so inserting or
    // removing a sibling summary moves the stop between two nodes.
    const SUMMARIES = `<details id="d" open>
      <summary id="first">First</summary><summary id="second">Second</summary>
    </details>`;

    it("moves the stop when a summary is inserted ahead of the first", async () => {
      const result = await refreshAfter(SUMMARIES, () => {
        const summary = document.createElement("summary");
        summary.id = "new";
        summary.textContent = "New";
        document.getElementById("d")!.prepend(summary);
      });
      expect(focusableIds(result)).toEqual(["new"]);
      expect(result.nodes).toEqual(extractDomTree(document.body).nodes);
    });

    it("moves the stop when the first summary is removed", async () => {
      const result = await refreshAfter(SUMMARIES, () =>
        document.getElementById("first")!.remove(),
      );
      expect(focusableIds(result)).toEqual(["second"]);
      expect(result.nodes).toEqual(extractDomTree(document.body).nodes);
    });
  });

  // A closed <details> renders only its summary, so the body has to come and
  // go with `open` — which find-in-page also sets, like it clears
  // `hidden="until-found"` on the match it reveals.
  describe("a <details> body across a refresh", () => {
    function track(html: string, mode: "a11y" | "dom") {
      document.body.innerHTML = html;
      const live = new LiveTreeExtractor(document.body, { mode });
      let lastChange: TreeChange | undefined;
      const observer = new DomObserver(
        document.body,
        (change) => {
          lastChange = change;
        },
        50,
      );
      observer.start();
      const clean = () =>
        mode === "a11y"
          ? extractA11yTree(document.body)
          : extractDomTree(document.body);
      return {
        async step(mutate: () => void) {
          mutate();
          await vi.advanceTimersByTimeAsync(100);
          const result = live.refresh(lastChange);
          expect(result.nodes).toEqual(clean().nodes);
          return [...result.nodes.values()].map((n) => n.a11y.name);
        },
        stop: () => observer.stop(),
      };
    }

    it.each(["a11y", "dom"] as const)(
      "adds the body when it opens and drops it when it closes (%s)",
      async (mode) => {
        const t = track(
          `<main><details><summary>S</summary><a href="/x">Body link</a></details></main>`,
          mode,
        );
        const details = document.querySelector("details")!;
        expect(await t.step(() => details.setAttribute("open", ""))).toContain(
          "Body link",
        );
        expect(
          await t.step(() => details.removeAttribute("open")),
        ).not.toContain("Body link");
        t.stop();
      },
    );

    it("splices around a change inside a closed body, not re-extracting the page", async () => {
      document.body.innerHTML = `<main><p>Background</p><details><summary>S</summary><div id="body"></div></details></main>`;
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
      const paragraph = (result: ExtractionResult) =>
        [...result.nodes.values()].find((n) => n.dom!.tagName === "p");
      const before = paragraph(live.extract());
      document.getElementById("body")!.append("Streamed log line");
      await vi.advanceTimersByTimeAsync(100);
      const after = live.refresh(lastChange);
      observer.stop();
      // A full extraction rebuilds every node object; a splice leaves the
      // untouched ones referentially identical.
      expect(before).toBeDefined();
      expect(paragraph(after)).toBe(before);
      expect(after.nodes).toEqual(extractDomTree(document.body).nodes);
    });

    it("splices around a change inside a light child no slot takes", async () => {
      document.body.innerHTML = `<main><p>Background</p><x-box><div id="unslotted"></div></x-box></main>`;
      document
        .querySelector("x-box")!
        .attachShadow({ mode: "open" }).innerHTML = `<span>Box</span>`;
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
      const paragraph = (result: ExtractionResult) =>
        [...result.nodes.values()].find((n) => n.dom!.tagName === "p");
      const before = paragraph(live.extract());
      document.getElementById("unslotted")!.append("Not rendered");
      await vi.advanceTimersByTimeAsync(100);
      const after = live.refresh(lastChange);
      observer.stop();
      expect(paragraph(after)).toBe(before);
      expect(after.nodes).toEqual(extractDomTree(document.body).nodes);
    });

    it("keeps a control added to a closed body out", async () => {
      const t = track(
        `<main><details><summary>S</summary><div id="body"></div></details><h2>Shown</h2></main>`,
        "a11y",
      );
      const names = await t.step(() => {
        const b = document.createElement("button");
        b.textContent = "Added";
        document.getElementById("body")!.appendChild(b);
      });
      expect(names).toContain("Shown");
      expect(names).not.toContain("Added");
      t.stop();
    });

    it("brings back content find-in-page reveals from hidden=until-found", async () => {
      const t = track(
        `<main><div id="uf" hidden="until-found"><a href="/u">Found link</a></div><h2>Shown</h2></main>`,
        "a11y",
      );
      expect(
        [...extractA11yTree(document.body).nodes.values()].map(
          (n) => n.a11y.name,
        ),
      ).not.toContain("Found link");
      expect(
        await t.step(() =>
          document.getElementById("uf")!.removeAttribute("hidden"),
        ),
      ).toContain("Found link");
      t.stop();
    });
  });

  it("keeps a reparented node when its destination was dirtied first", () => {
    document.body.innerHTML = `
      <main id="app">
        <div id="a"><span id="y">Moved</span></div>
        <div id="b"></div>
      </main>
    `;
    const root = document.getElementById("app")!;
    const live = new LiveTreeExtractor(root, { mode: "dom" });

    const a = document.getElementById("a")!;
    const b = document.getElementById("b")!;
    const y = document.getElementById("y")!;

    // One batch: an attribute change on the DESTINATION lands before the move,
    // so `b` enters the dirty set ahead of the move's source `a`. Re-extracting
    // `b` re-adds `y`; a later deleteSubtree(`a`) must not then follow `a`'s
    // stale childIds and delete the node that now lives under `b`.
    b.setAttribute("class", "highlight");
    b.appendChild(y);

    const result = live.refresh({
      mutations: [
        { type: "attributes", target: b, attributeName: "class" },
        { type: "childList", target: a, addedNodes: [], removedNodes: [y] },
        { type: "childList", target: b, addedNodes: [y], removedNodes: [] },
      ] as unknown as MutationRecord[],
    });
    const expected = extractDomTree(root);

    expect(result.nodes).toEqual(expected.nodes);
    // No parent may reference a node that is not in the map.
    for (const node of result.nodes.values()) {
      for (const childId of node.childIds) {
        expect(result.nodes.has(childId)).toBe(true);
      }
    }
  });

  // The id a referrer points at often sits on a plain wrapper several levels
  // above the text that actually changed. That wrapper is neither the text's
  // direct parent nor a name-from-content host, so nothing seeds it into the
  // dirty set — the referrer has to be found by walking up from the change.
  it("refreshes an aria-labelledby referrer when nested wrapper text changes", () => {
    document.body.innerHTML = `
      <main id="app">
        <div id="lbl"><span id="s">Old</span></div>
        <button aria-labelledby="lbl"></button>
      </main>
    `;
    const root = document.getElementById("app")!;
    const live = new LiveTreeExtractor(root, { mode: "a11y" });

    const text = document.getElementById("s")!.firstChild!;
    text.textContent = "New";

    const result = live.refresh({
      mutations: [
        { type: "characterData", target: text },
      ] as unknown as MutationRecord[],
    });
    const expected = extractA11yTree(root);

    expect(result.nodes).toEqual(expected.nodes);
    const names = [...result.nodes.values()].map((n) => n.a11y.name);
    expect(names).toContain("New");
    expect(names).not.toContain("Old");
  });

  it("refreshes an aria-labelledby referrer when nested wrapper text is replaced", () => {
    document.body.innerHTML = `
      <main id="app">
        <div id="lbl"><span id="s">Old</span></div>
        <button aria-labelledby="lbl"></button>
      </main>
    `;
    const root = document.getElementById("app")!;
    const live = new LiveTreeExtractor(root, { mode: "a11y" });

    // textContent= is a childList mutation, not characterData.
    const s = document.getElementById("s")!;
    s.textContent = "New";

    const result = live.refresh({
      mutations: [
        { type: "childList", target: s, addedNodes: [], removedNodes: [] },
      ] as unknown as MutationRecord[],
    });
    const expected = extractA11yTree(root);

    expect(result.nodes).toEqual(expected.nodes);
    const names = [...result.nodes.values()].map((n) => n.a11y.name);
    expect(names).toContain("New");
    expect(names).not.toContain("Old");
  });

  it("does not resurrect a node removed later in the same batch", () => {
    document.body.innerHTML = `
      <main id="app">
        <div id="p"><span id="e">Gone</span></div>
      </main>
    `;
    const root = document.getElementById("app")!;
    const live = new LiveTreeExtractor(root, { mode: "dom" });

    const p = document.getElementById("p")!;
    const e = document.getElementById("e")!;

    // One batch: `e` is mutated (entering the dirty set), then detached. Its
    // subtree must stay deleted — re-extracting a detached element succeeds,
    // because getComputedStyle reports nothing hidden for it.
    e.setAttribute("class", "x");
    p.removeChild(e);

    const result = live.refresh({
      mutations: [
        { type: "attributes", target: e, attributeName: "class" },
        { type: "childList", target: p, addedNodes: [], removedNodes: [e] },
      ] as unknown as MutationRecord[],
    });
    const expected = extractDomTree(root);

    expect(result.nodes.size).toBe(expected.nodes.size);
    expect(result.nodes).toEqual(expected.nodes);
    expect(
      [...result.nodes.values()].some((n) => n.dom?.textContent === "Gone"),
    ).toBe(false);
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
      [...result.nodes.values()].find((n) => n.dom?.tagName === tag);

    /**
     * jsdom has no `showModal()` and never matches `:modal`, so open `dialog`
     * as a browser modal by answering `:modal` for it alone.
     */
    const fakeShowModal = (dialog: Element) => {
      const matches = Element.prototype.matches;
      vi.spyOn(Element.prototype, "matches").mockImplementation(function (
        this: Element,
        selector: string,
      ) {
        return selector === ":modal"
          ? this === dialog
          : matches.call(this, selector);
      });
      dialog.setAttribute("open", "");
    };

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("re-scopes to a modal when a <dialog> is opened with showModal() in place", () => {
      document.body.innerHTML = `
        <main id="app">
          <p>Background</p>
          <dialog id="dlg"><button>Confirm</button></dialog>
        </main>
      `;
      const root = document.getElementById("app")!;
      const live = new LiveTreeExtractor(root, { mode: "a11y" });

      const dlg = document.getElementById("dlg")!;
      fakeShowModal(dlg);

      const result = live.refresh(attrChange(dlg, "open"));
      const expected = extractA11yTree(root);

      // Scoping is EXCLUSIVE to the modal: content behind it is inert to AT.
      expect(result.rootId).toBe(expected.rootId);
      expect(result.nodes).toEqual(expected.nodes);
      const names = [...result.nodes.values()].map((n) => n.a11y.name);
      expect(names).not.toContain("Background");
    });

    it("restores the surrounding tree when the modal <dialog> closes in place", () => {
      document.body.innerHTML = `
        <main id="app">
          <p>Background</p>
          <dialog id="dlg"><button>Confirm</button></dialog>
        </main>
      `;
      const dlg = document.getElementById("dlg")!;
      fakeShowModal(dlg);
      const root = document.getElementById("app")!;
      const live = new LiveTreeExtractor(root, { mode: "a11y" });

      vi.restoreAllMocks();
      dlg.removeAttribute("open");

      const result = live.refresh(attrChange(dlg, "open"));
      const expected = extractA11yTree(root);

      // Without a scope re-check the tree stays rooted at the closed dialog
      // and the rest of the page never comes back.
      expect(result.rootId).toBe(expected.rootId);
      expect(result.nodes).toEqual(expected.nodes);
      expect(
        [...result.nodes.values()].some(
          (n) => n.dom?.textContent === "Background",
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

    it("un-pivots when an out-of-root overlay becomes aria-hidden", () => {
      // An overlay AT cannot reach is no reason to widen, so a portal that
      // gains aria-hidden (a drawer closing without unmounting) must hand the
      // scope back to the root rather than leave the whole page in the view.
      document.body.innerHTML = `
        <main id="app"><p>Background</p></main>
        <div id="portal">
          <div id="menu" role="menu"><button>Item</button></div>
        </div>
      `;
      const root = document.getElementById("app")!;
      const live = new LiveTreeExtractor(root, { mode: "a11y" });

      const menu = document.getElementById("menu")!;
      menu.setAttribute("aria-hidden", "true");

      const result = live.refresh(attrChange(menu, "aria-hidden"));
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

  describe("aria-describedby target suppression stays in sync", () => {
    // Whether a description target is kept depends on its WHOLE subtree (does
    // it still hold a reachable control?), so a mutation deep inside one can
    // flip that verdict. The splice has to re-evaluate the target itself, or
    // the live tree drifts from what a full extraction would produce.
    const hasHelpNode = (result: ExtractionResult) =>
      [...result.nodes.values()].some((n) => n.dom?.attributes?.id === "help");

    const childListOn = (target: Element): TreeChange => ({
      mutations: [
        {
          type: "childList",
          target,
          addedNodes: [],
          removedNodes: [],
        } as unknown as MutationRecord,
      ],
    });

    it("drops the target once its last control is removed", () => {
      document.body.innerHTML = `
        <main id="app">
          <input aria-label="Password" aria-describedby="help" />
          <div id="help"><span>Must be 8+ chars. <a href="/x">Full rules</a></span></div>
        </main>
      `;
      const root = document.getElementById("app")!;
      const live = new LiveTreeExtractor(root, { mode: "dom" });

      expect(hasHelpNode(live.extract())).toBe(true);

      const span = document.querySelector("#help span")!;
      document.querySelector("#help a")!.remove();
      const after = live.refresh(childListOn(span));

      expect(hasHelpNode(after)).toBe(false);
      expect(after.nodes).toEqual(extractDomTree(root).nodes);
    });

    it("brings the target back once a control appears inside it", () => {
      document.body.innerHTML = `
        <main id="app">
          <input aria-label="Password" aria-describedby="help" />
          <div id="help"><span>Must be 8+ chars.</span></div>
        </main>
      `;
      const root = document.getElementById("app")!;
      const live = new LiveTreeExtractor(root, { mode: "dom" });

      expect(hasHelpNode(live.extract())).toBe(false);

      const span = document.querySelector("#help span")!;
      const link = document.createElement("a");
      link.setAttribute("href", "/x");
      link.textContent = "Full rules";
      span.append(link);
      const after = live.refresh(childListOn(span));

      expect(hasHelpNode(after)).toBe(true);
      expect(after.nodes).toEqual(extractDomTree(root).nodes);
    });

    it("drops the target once its last control is hidden from AT", () => {
      document.body.innerHTML = `
        <main id="app">
          <input aria-label="Password" aria-describedby="help" />
          <div id="help"><span>Must be 8+ chars. <a href="/x">Full rules</a></span></div>
        </main>
      `;
      const root = document.getElementById("app")!;
      const live = new LiveTreeExtractor(root, { mode: "dom" });

      expect(hasHelpNode(live.extract())).toBe(true);

      const link = document.querySelector("#help a")!;
      link.setAttribute("aria-hidden", "true");
      const after = live.refresh({
        mutations: [
          {
            type: "attributes",
            target: link,
            attributeName: "aria-hidden",
          } as unknown as MutationRecord,
        ],
      });

      expect(hasHelpNode(after)).toBe(false);
      expect(after.nodes).toEqual(extractDomTree(root).nodes);
    });
  });

  describe("a <form> whose control shadows a method the splice calls", () => {
    // `<form>` has [LegacyOverrideBuiltIns]: `<input name="getAttribute">` makes
    // `form.getAttribute` that input, so calling it throws. The splice calls a
    // dozen such members on every dirty element and ancestor it reaches, and a
    // throw escaped `refresh()` — the caller kept a stale tree, and every later
    // refresh touching the form threw again. A full extraction survives the
    // same form (its per-element boundary skips it), and a splice exists only
    // to reach that same tree faster.
    afterEach(() => {
      vi.restoreAllMocks();
    });

    /** The records a MutationObserver on `root` gets for `mutate`. */
    const observe = (root: Element, mutate: () => void): TreeChange => {
      const observer = new MutationObserver(() => {});
      observer.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      mutate();
      const mutations = observer.takeRecords();
      observer.disconnect();
      return { mutations };
    };

    const buttonName = (result: ExtractionResult) =>
      [...result.nodes.values()].find((n) => n.a11y.role === "button")?.a11y
        .name;

    it.each([
      [
        "getAttribute",
        "expandDependencies reads each dirty ancestor's id",
        clobber,
      ],
      [
        "contains",
        "collapseToOutermost asks the form whether it holds the text",
        clobber,
      ],
    ])(
      "keeps the tree right when the form's %s is shadowed (%s)",
      (prop, _how, shadowProp) => {
        document.body.innerHTML = `
          <main id="app">
            <h1 id="title">Title</h1>
            <form aria-label="Signup">
              <input name="${prop}" aria-label="Field" />
              <span id="lbl">Old</span>
            </form>
            <button aria-labelledby="lbl">x</button>
          </main>
        `;
        const root = document.getElementById("app")!;
        const form = root.querySelector("form")!;
        shadowProp(form, prop);
        const live = new LiveTreeExtractor(root, { mode: "a11y" });

        const change = observe(root, () => {
          form.setAttribute("class", "touched");
          document.getElementById("lbl")!.firstChild!.nodeValue = "New";
          document.getElementById("title")!.setAttribute("class", "touched");
        });
        const result = live.refresh(change);

        expect(buttonName(result)).toBe("New");
        expect(result.nodes).toEqual(extractA11yTree(root).nodes);
      },
    );

    it.each([
      ["matches", "asks the added form whether it is an overlay", clobber],
      ["querySelectorAll", "scans the added form for references", clobber],
      ["getAttribute", "indexes the references the added form makes", clobber],
      ["ownerDocument", "resolves the added form's aria-labelledby", shadow],
    ])(
      "keeps the tree right when an added form's %s is shadowed (the splice %s)",
      (prop, _how, shadowProp) => {
        document.body.innerHTML = `
          <main id="app"><h1 id="title">Title</h1><div id="slot"></div></main>
        `;
        const root = document.getElementById("app")!;
        const live = new LiveTreeExtractor(root, { mode: "a11y" });

        const form = document.createElement("form");
        form.setAttribute("aria-labelledby", "title");
        form.innerHTML = `<input name="${prop}" aria-label="Field" />`;
        shadowProp(form, prop);
        const change = observe(root, () => {
          document.getElementById("slot")!.append(form);
        });
        const result = live.refresh(change);

        expect(result.nodes).toEqual(extractA11yTree(root).nodes);
      },
    );

    it("warns outside production that it fell back to a full extraction", () => {
      // The fallback is silent in its output by design, so a bug that made the
      // splice throw on ordinary pages would pass every equality test here and
      // only cost speed. The warning is what keeps that visible.
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      document.body.innerHTML = `
        <main id="app">
          <form><input name="getAttribute" /><span>Old</span></form>
        </main>
      `;
      const root = document.getElementById("app")!;
      const form = root.querySelector("form")!;
      clobber(form, "getAttribute");
      const live = new LiveTreeExtractor(root, { mode: "a11y" });
      warn.mockClear();

      live.refresh(
        observe(root, () => {
          form.querySelector("span")!.firstChild!.nodeValue = "New";
        }),
      );

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("fell back to a full extraction"),
        expect.any(Error),
      );
    });
  });

  describe("a <form> whose control shadows parentElement", () => {
    // `<form>` is the one HTML element with [LegacyOverrideBuiltIns]: in a real
    // browser `form.parentElement` is the `<input name="parentElement">` inside
    // it, whose own parent is the form again. A climb that reads it plainly
    // cycles between the two forever, freezing the page. Forced, because
    // jsdom's named-property override is not guaranteed.
    function clobberParentElement(): HTMLFormElement {
      const form = document.querySelector("form")!;
      Object.defineProperty(form, "parentElement", {
        configurable: true,
        get: () => form.querySelector('[name="parentElement"]'),
      });
      return form;
    }

    async function refreshAfter(
      html: string,
      mutate: (form: HTMLFormElement) => void,
      mode: "a11y" | "dom" = "a11y",
    ) {
      document.body.innerHTML = html;
      const form = clobberParentElement();
      const live = new LiveTreeExtractor(document.body, { mode });
      let lastChange: TreeChange | undefined;
      const observer = new DomObserver(
        document.body,
        (change) => {
          lastChange = change;
        },
        50,
      );
      observer.start();
      mutate(form);
      await vi.advanceTimersByTimeAsync(100);
      observer.stop();
      expect(lastChange?.full).toBeFalsy(); // the incremental path, not a rebuild
      const result = live.refresh(lastChange);
      const clean =
        mode === "a11y"
          ? extractA11yTree(document.body)
          : extractDomTree(document.body);
      return { result, clean };
    }
    const names = (tree: ExtractionResult) =>
      [...tree.nodes.values()].map((n) => n.a11y.name);

    it.each(["a11y", "dom"] as const)(
      "refreshes when text inside the form changes (%s)",
      async (mode) => {
        const { result, clean } = await refreshAfter(
          `<main><form aria-label="Search"><input name="parentElement" aria-label="Query"><button>Old</button></form></main>`,
          () => {
            document.querySelector("button")!.firstChild!.textContent = "New";
          },
          mode,
        );
        expect(names(result)).toContain("New");
        expect(result.nodes).toEqual(clean.nodes);
      },
    );

    it("refreshes when the form's own role changes", async () => {
      const { result, clean } = await refreshAfter(
        `<main><form aria-label="Search"><input name="parentElement" aria-label="Query"></form></main>`,
        (form) => form.setAttribute("role", "search"),
      );
      expect([...result.nodes.values()].map((n) => n.a11y.role)).toContain(
        "search",
      );
      expect(result.nodes).toEqual(clean.nodes);
    });

    it("refreshes an editor's value, and keeps a link live, inside the form", async () => {
      const { result, clean } = await refreshAfter(
        `<main><form aria-label="Compose">
          <input name="parentElement" aria-label="Subject">
          <div contenteditable="true" role="textbox" aria-label="Body"><p>Old</p></div>
          <a href="/help">Help</a>
        </form></main>`,
        () => {
          document.querySelector("p")!.firstChild!.textContent = "New";
        },
      );
      const node = (name: string) =>
        [...result.nodes.values()].find((n) => n.a11y.name === name);
      expect(node("Body")?.a11y.value).toBe("New");
      expect(node("Help")?.interaction?.actions).toContain("click");
      expect(result.nodes).toEqual(clean.nodes);
    });
  });

  // `<input name="tagName">` makes `form.tagName` that input, and
  // `.toLowerCase()` on it throws. Every change inside or on the form climbs
  // through it reading tags, so the splice threw. The splice fallback (see "a
  // method the splice calls" above) keeps the tree right when that happens,
  // but at a full extraction's cost on every change near the form — and the
  // tag is a read the splice can make safely, so these must splice without
  // falling back. (Forced: jsdom doesn't shadow a form's own members.)
  describe("a <form> whose control shadows tagName", () => {
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      // The full walk warns about the form it skips; the fallback would too.
      warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    /**
     * The refresh spliced: it never had to fall back to a full extraction.
     * Checked by hand rather than with `not.toHaveBeenCalledWith`, whose
     * failure message prints every call — and the walk's own warning passes
     * the shadowed form, which the printer then reads `tagName` on and throws.
     */
    const expectSpliced = (): void => {
      const fellBack = warn.mock.calls.some(([message]) =>
        String(message).includes("fell back to a full extraction"),
      );
      expect(fellBack, "the refresh fell back to a full extraction").toBe(
        false,
      );
    };

    afterEach(() => {
      vi.restoreAllMocks();
    });

    function page(control = `<input name="tagName" aria-label="Tag" />`) {
      document.body.innerHTML = `
        <main id="app">
          <h1 id="title">Orders</h1>
          <form aria-label="Search">
            ${control}
            <span id="hint">Old hint</span>
          </form>
        </main>
      `;
      return {
        root: document.getElementById("app")!,
        form: document.querySelector("form")!,
        hint: document.getElementById("hint")!,
        title: document.getElementById("title")!,
      };
    }

    it("keeps updating when text inside the form changes", () => {
      const { root, form, hint, title } = page();
      shadow(form, "tagName");
      const live = new LiveTreeExtractor(root, { mode: "a11y" });

      // One batch, as the observer delivers it: the form's text, and the
      // heading's beside it. Losing the batch loses the heading's change too.
      const hintText = hint.firstChild!;
      const titleText = title.firstChild!;
      hintText.textContent = "New hint";
      titleText.textContent = "Open orders";
      const result = live.refresh({
        mutations: [
          { type: "characterData", target: hintText },
          { type: "characterData", target: titleText },
        ] as unknown as MutationRecord[],
      });

      expect(result.nodes).toEqual(extractA11yTree(root).nodes);
      expectSpliced();
      const names = [...result.nodes.values()].map((n) => n.a11y.name);
      expect(names).toContain("Open orders");
    });

    it("keeps updating when an attribute inside the form changes", () => {
      const { root, form, hint } = page();
      shadow(form, "tagName");
      const live = new LiveTreeExtractor(root, { mode: "a11y" });

      hint.setAttribute("title", "More");
      const result = live.refresh({
        mutations: [
          { type: "attributes", target: hint, attributeName: "title" },
        ] as unknown as MutationRecord[],
      });

      expect(result.nodes).toEqual(extractA11yTree(root).nodes);
      expectSpliced();
    });

    it("keeps updating when an attribute on the form itself changes", () => {
      const { root, form } = page();
      shadow(form, "tagName");
      const live = new LiveTreeExtractor(root, { mode: "dom" });

      form.setAttribute("class", "busy");
      const result = live.refresh({
        mutations: [
          { type: "attributes", target: form, attributeName: "class" },
        ] as unknown as MutationRecord[],
      });

      expect(result.nodes).toEqual(extractDomTree(root).nodes);
      expectSpliced();
    });

    it("keeps updating when content inside the form is replaced", () => {
      const { root, form, hint } = page();
      shadow(form, "tagName");
      const live = new LiveTreeExtractor(root, { mode: "a11y" });

      // `textContent =` swaps the text node: a childList change, not text.
      hint.textContent = "New hint";
      const result = live.refresh({
        mutations: [
          { type: "childList", target: hint, addedNodes: [], removedNodes: [] },
        ] as unknown as MutationRecord[],
      });

      expect(result.nodes).toEqual(extractA11yTree(root).nodes);
      expectSpliced();
    });

    it("drops the form, as a fresh extraction does, when the control arrives later", () => {
      const { root, form } = page("");
      const live = new LiveTreeExtractor(root, { mode: "dom" });
      const before = [...live.extract().nodes.values()].map((n) => n.a11y.name);
      expect(before).toContain("Search");

      const control = document.createElement("input");
      control.name = "tagName";
      form.prepend(control);
      shadow(form, "tagName");
      const result = live.refresh({
        mutations: [
          {
            type: "childList",
            target: form,
            addedNodes: [control],
            removedNodes: [],
          },
        ] as unknown as MutationRecord[],
      });

      expect(result.nodes).toEqual(extractDomTree(root).nodes);
      expectSpliced();
      const after = [...result.nodes.values()].map((n) => n.a11y.name);
      expect(after).not.toContain("Search");
      expect(after).toContain("Orders");
    });
  });
});
