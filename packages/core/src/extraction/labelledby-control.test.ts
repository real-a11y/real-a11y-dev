/**
 * A form control an aria-labelledby (or aria-describedby) reference points at
 * lends its own name, as Chromium computes it (AccName 1.2 step 2B: "compute
 * the text alternative of the current node beginning with the overall
 * Computation step"). `<button aria-labelledby="c">Toggle</button>` over
 * `<label for="c">Checkbox Label Text</label><input type="checkbox" id="c">`
 * is "Checkbox Label Text" in Chromium and the native producer; the DOM
 * producer read the checkbox's content, found none, and fell back to "Toggle".
 *
 * Every expected name here was read from Chromium's own tree;
 * `packages/browser/e2e/labelledby-control.e2e.test.ts` pins them there. The
 * same rule makes an empty field lend its name to a name it sits in (step 2C):
 * `<h2>Save <input placeholder="Draft"> now</h2>` is "Save Draft now".
 */
import { afterEach, describe, expect, it } from "vitest";

import { extractDomTree, getElementRefs } from "./dom-extractor.js";
import { REDACTED_VALUE } from "./sensitivity.js";

let mounted: Element | null = null;

afterEach(() => {
  mounted?.remove();
  mounted = null;
});

/** Mount `html` in the document, so IDREFs resolve, and extract it. */
function read(html: string, redactInput = false) {
  mounted?.remove();
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  mounted = root;
  const tree = extractDomTree(root, { redactInput });
  const refs = getElementRefs();
  return (selector: string) => {
    const target = root.querySelector(selector)!;
    const node = [...tree.nodes.values()].find(
      (n) => refs.get(n.id) === target,
    )!;
    return { name: node.a11y.name, description: node.a11y.description ?? "" };
  };
}

/** The name and description of a button labelled, then described, by #c. */
function borrowed(target: string, redactInput = false) {
  const at = read(
    `${target}<button id="b" aria-labelledby="c">Toggle</button>` +
      `<button id="d" aria-describedby="c">Go</button>`,
    redactInput,
  );
  return { name: at("#b").name, description: at("#d").description };
}

const nameOf = (html: string, selector = "#t", redactInput = false) =>
  read(html, redactInput)(selector).name;

describe("a reference reads a form control's own name (AccName 2B)", () => {
  // The finding's repro tables, with the names Chromium gives them.
  it.each([
    [
      `<label for="c">Checkbox Label Text</label><input type="checkbox" id="c">`,
      "Checkbox Label Text",
    ],
    [
      `<label for="c">Radio Label Text</label><input type="radio" id="c">`,
      "Radio Label Text",
    ],
    [`<label>Wrapped Label <input id="c"></label>`, "Wrapped Label"],
    [`<input id="c" value="typed">`, "typed"],
    [`<textarea id="c" placeholder="Reply"></textarea>`, "Reply"],
    [`<input id="c" title="Email">`, "Email"],
    [
      `<select id="c"><option>Alpha</option><option selected>Beta</option></select>`,
      "Beta",
    ],
    [
      `<fieldset id="c"><legend>Legend text</legend><input></fieldset>`,
      "Legend text",
    ],
    [`<table id="c"><caption>Cap</caption><tr><td>A</td></tr></table>`, "Cap"],
    [`<svg id="c"><title>Shape</title><circle r="4"/></svg>`, "Shape"],
  ])("%s", (target, name) => {
    // A description reads the same text (the finding's describedby case).
    expect(borrowed(target)).toEqual({ name, description: name });
  });

  it("orders a field's sources as Chromium does", () => {
    for (const [target, name] of [
      // The value first, even over a label (2C before 2E)...
      [`<label for="c">Lab</label><input id="c" value="typed">`, "typed"],
      [`<label>Lab <input id="c" value="typed"></label>`, "typed"],
      [`<label for="c">Lab</label><textarea id="c">typed</textarea>`, "typed"],
      // ...then aria-label, the labels, title and placeholder.
      [`<label for="c">Lab</label><input id="c" aria-label="AL">`, "AL"],
      [
        `<label for="c">Lab</label><input type="checkbox" id="c" aria-label="AL">`,
        "AL",
      ],
      [`<label for="c">Lab</label><input id="c" title="T">`, "Lab"],
      [`<label for="c">Lab</label><input id="c" placeholder="P">`, "Lab"],
      [`<input id="c" title="T" placeholder="P">`, "T"],
      [`<textarea id="c" title="T" placeholder="P"></textarea>`, "T"],
      [`<input type="checkbox" id="c" title="Agree">`, "Agree"],
    ]) {
      expect(borrowed(target!).name, target).toBe(name);
    }
  });

  it("joins every label, and reads what the label holds", () => {
    for (const [target, name] of [
      [
        `<label for="c">One</label><label for="c">Two</label><input type="checkbox" id="c">`,
        "One Two",
      ],
      [
        `<label for="c">One</label><label>Two <input type="checkbox" id="c"></label>`,
        "One Two",
      ],
      [
        `<label for="c">Flash <input value="3"> times</label><input type="checkbox" id="c">`,
        "Flash 3 times",
      ],
      [
        `<label><input type="checkbox" id="c"> Flash <input value="3"> times</label>`,
        "Flash 3 times",
      ],
      [
        `<label for="c">Agree <span>here</span></label><input type="checkbox" id="c">`,
        "Agree here",
      ],
    ]) {
      expect(borrowed(target!).name, target).toBe(name);
    }
  });

  it("ignores the target's own aria-labelledby, as any reference does", () => {
    expect(
      borrowed(
        `<span id="o">Other</span><label for="c">Lab</label><input type="checkbox" id="c" aria-labelledby="o">`,
      ).name,
    ).toBe("Lab");
  });

  it("reads a hidden target's label", () => {
    expect(
      borrowed(
        `<label for="c">Lab</label><input type="checkbox" id="c" hidden>`,
      ).name,
    ).toBe("Lab");
  });

  it("reads a label once, however often it is reached", () => {
    expect(
      nameOf(
        `<label for="c">Lab</label><input type="checkbox" id="c"><button id="t" aria-labelledby="c c">x</button>`,
      ),
    ).toBe("Lab");
  });

  it("leaves the referrer out of a label that holds it", () => {
    const at = read(
      `<label for="c">Agree <button id="in" aria-labelledby="c">Toggle</button></label>` +
        `<input type="checkbox" id="c"><button id="out" aria-labelledby="c">x</button>`,
    );
    expect(at("#in").name).toBe("Agree");
    expect(at("#out").name).toBe("Agree Toggle");
  });

  it("reads a button input's value or default before its title", () => {
    for (const [target, name] of [
      [`<input type="submit" id="c" value="Send">`, "Send"],
      [
        `<label for="c">Lab</label><input type="submit" id="c" value="Send">`,
        "Lab",
      ],
      [`<input type="submit" id="c">`, "Submit"],
      [`<input type="reset" id="c">`, "Reset"],
      [`<input type="submit" id="c" title="T">`, "Submit"],
      [`<input type="image" id="c" alt="Go">`, "Go"],
      [`<input type="image" id="c" title="T">`, "T"],
      [`<input type="image" id="c">`, "Submit"],
    ]) {
      expect(borrowed(target!).name, target).toBe(name);
    }
  });

  // A `<button>`'s own label is a gap of its own name (Chromium names
  // `<label for="c">Lab</label><button id="c">Go</button>` "Lab", the DOM
  // producer "Go"), which a reference to it shares.
  it("reads a labelable element's label before its content", () => {
    for (const [target, name] of [
      [`<button id="c" title="T">Go</button>`, "Go"],
      [`<button id="c" title="T"></button>`, "T"],
      [`<label for="c">Total</label><output id="c">42</output>`, "Total"],
      [`<output id="c" title="T">42</output>`, "42"],
      [`<output id="c" title="T"></output>`, "T"],
    ]) {
      expect(borrowed(target!).name, target).toBe(name);
    }
  });

  it("reads a range's value, and a control with none by its label", () => {
    for (const [target, name] of [
      [`<label for="c">Disk</label><meter id="c" value="0.6"></meter>`, "0.6"],
      [
        `<label for="c">Vol</label><input type="range" id="c" value="4" min="0" max="10">`,
        "4",
      ],
      [`<label for="c">Load</label><progress id="c"></progress>`, "Load"],
      [
        `<label for="c">Hue</label><input type="color" id="c" value="#ff0000">`,
        "Hue",
      ],
      [
        `<label for="c">Day</label><input type="date" id="c" value="1991-09-10">`,
        "Day",
      ],
      [`<label for="c">Lab</label><input type="number" id="c">`, "Lab"],
      [
        `<label for="c">Lab</label><input id="c" list="dl"><datalist id="dl"><option value="A"></datalist>`,
        "Lab",
      ],
      [
        `<label for="c">Lab</label><select id="c" size="3"><option>A</option></select>`,
        "Lab",
      ],
      [
        `<ul role="listbox" id="c" aria-label="AL"><li role="option">A</li></ul>`,
        "AL",
      ],
      [`<input role="combobox" id="c" aria-label="AL">`, "AL"],
    ]) {
      expect(borrowed(target!).name, target).toBe(name);
    }
  });

  it("reads nothing more from an empty single select or ARIA text field", () => {
    // Chromium lends the chosen option and stops, even when there is none.
    for (const target of [
      `<select id="c" aria-label="Pick"></select>`,
      `<label for="c">Lab</label><select id="c" title="T"></select>`,
      `<label for="c">Lab</label><select id="c"><option></option></select>`,
      `<div role="combobox" id="c" tabindex="0" aria-label="AL"></div>`,
      `<div role="textbox" id="c" aria-label="AL"></div>`,
      `<div role="searchbox" id="c" aria-label="AL"></div>`,
    ]) {
      expect(borrowed(target).name, target).toBe("Toggle");
    }
  });

  it("reads any target's title last (AccName 2I)", () => {
    for (const [target, name] of [
      [`<span id="c" title="T"></span>`, "T"],
      [`<span id="c" title="T">content</span>`, "content"],
      [`<div role="checkbox" id="c" tabindex="0" title="T"></div>`, "T"],
    ]) {
      expect(borrowed(target!).name, target).toBe(name);
    }
  });

  it("falls back to the referrer's own content when the target lends nothing", () => {
    for (const target of [
      `<input id="c">`,
      `<input type="checkbox" id="c">`,
      `<span id="x">X</span><input id="c" aria-labelledby="x">`,
      // A `<label for>` names only a labelable element.
      `<label for="c">Lab</label><div role="checkbox" id="c" tabindex="0" aria-checked="false"></div>`,
    ]) {
      expect(borrowed(target).name, target).toBe("Toggle");
    }
  });
});

describe("an empty embedded control lends its name (AccName 2C)", () => {
  it.each([
    [`<h2 id="t">Save <input placeholder="P"> now</h2>`, "Save P now"],
    [`<h2 id="t">Save <input title="T"> now</h2>`, "Save T now"],
    [`<h2 id="t">Save <input aria-label="AL"> now</h2>`, "Save AL now"],
    [
      `<h2 id="t">Save <textarea placeholder="P"></textarea> now</h2>`,
      "Save P now",
    ],
    [
      `<label for="i">Lab</label><h2 id="t">Save <textarea id="i"></textarea> now</h2>`,
      "Save Lab now",
    ],
    [
      `<span id="x">X</span><h2 id="t">Save <input aria-labelledby="x"> now</h2>`,
      "Save X now",
    ],
    [`<h2 id="t">Save <input type="color" title="T"> now</h2>`, "Save T now"],
    [
      `<h2 id="t">Save <input type="date" aria-label="AL" value="1991-09-10"> now</h2>`,
      "Save AL now",
    ],
    [
      `<h2 id="t">Save <select size="3" aria-label="AL"><option>A</option></select> now</h2>`,
      "Save AL now",
    ],
    [
      `<h2 id="t">Save <ul role="listbox" aria-label="AL"><li role="option">A</li></ul> now</h2>`,
      "Save AL now",
    ],
    [
      `<h2 id="t">Save <progress aria-label="AL"></progress> now</h2>`,
      "Save AL now",
    ],
    [
      `<h2 id="t">Save <input type="number" aria-label="AL"> now</h2>`,
      "Save AL now",
    ],
    [
      `<h2 id="t">Save <input role="combobox" aria-label="AL"> now</h2>`,
      "Save AL now",
    ],
    [
      `<h2 id="t">Save <input type="search" title="T" placeholder="P"> now</h2>`,
      "Save T now",
    ],
    [
      `<h2 id="t">Save <input type="password" placeholder="P"> now</h2>`,
      "Save P now",
    ],
  ])("%s", (html, name) => {
    expect(nameOf(html)).toBe(name);
  });

  it("is nothing for an empty single select or ARIA text field", () => {
    for (const html of [
      `<h2 id="t">Save <select aria-label="AL"></select> now</h2>`,
      `<h2 id="t">Save <div role="combobox" tabindex="0" aria-label="AL"></div> now</h2>`,
      `<h2 id="t">Save <span role="textbox" contenteditable tabindex="0" aria-label="AL"></span> now</h2>`,
    ]) {
      expect(nameOf(html), html).toBe("Save now");
    }
  });

  it("drops the control's own aria-labelledby inside a reference", () => {
    const at = read(
      `<span id="x">X</span><h2 id="h">Save <input aria-labelledby="x"> now</h2>` +
        `<button id="t" aria-labelledby="h">b</button>`,
    );
    expect(at("#h").name).toBe("Save X now");
    expect(at("#t").name).toBe("Save now");
  });

  it("reaches a label around another control", () => {
    expect(
      nameOf(
        `<label><input type="checkbox" id="t"> Flash <input aria-label="n"> times</label>`,
      ),
    ).toBe("Flash n times");
    expect(
      nameOf(
        `<label for="t">Name <input placeholder="P"></label><input type="checkbox" id="t">`,
      ),
    ).toBe("Name P");
  });

  it("is never the named field's own name, in its own label", () => {
    expect(nameOf(`<label>Name <input id="t" placeholder="P"></label>`)).toBe(
      "Name",
    );
  });
});

describe("a borrowed control name under ADR-0001", () => {
  it("lends an empty sensitive field's label, and withholds a filled one", () => {
    expect(
      borrowed(`<label for="c">Password</label><input type="password" id="c">`),
    ).toEqual({ name: "Password", description: "Password" });
    expect(
      borrowed(
        `<label for="c">Code</label><input autocomplete="one-time-code" id="c">`,
      ).name,
    ).toBe("Code");
    expect(
      borrowed(
        `<label for="c">Password</label><input type="password" id="c" value="hunter2">`,
      ),
    ).toEqual({ name: REDACTED_VALUE, description: "" });
  });

  it("keeps a name read from markup alone in strict mode", () => {
    for (const [target, name] of [
      [
        `<label for="c">Checkbox Label Text</label><input type="checkbox" id="c">`,
        "Checkbox Label Text",
      ],
      [`<label>Wrapped Label <input id="c"></label>`, "Wrapped Label"],
      [`<textarea id="c" placeholder="Reply"></textarea>`, "Reply"],
    ]) {
      expect(borrowed(target!, true), target).toEqual({
        name,
        description: name,
      });
    }
    expect(
      nameOf(`<h2 id="t">Save <input placeholder="P"> now</h2>`, "#t", true),
    ).toBe("Save P now");
  });

  it("withholds a label that a value reaches, in strict mode", () => {
    for (const target of [
      `<label for="c">Lab</label><input id="c" value="typed">`,
      `<label for="c">Flash <input value="3"> times</label><input type="checkbox" id="c">`,
    ]) {
      expect(borrowed(target, true), target).toEqual({
        name: REDACTED_VALUE,
        description: "",
      });
      expect(borrowed(target, false).name, target).not.toBe(REDACTED_VALUE);
    }
  });
});
