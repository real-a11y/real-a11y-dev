/**
 * AccName 1.2 step 2C, "Embedded Control": a control the user adjusts lends
 * its value to a name or description it sits in. Chromium names
 * `<label><input type="checkbox"> Flash the screen <input value="3"> times
 * </label>` "Flash the screen 3 times", and so does the native producer; the
 * DOM producer read it as "Flash the screen times". Spacing around a value
 * comes from computed `display`, which jsdom doesn't match, so
 * `packages/browser/e2e/embedded-control.e2e.test.ts` pins these against
 * real Chromium too.
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

const nameOf = (html: string, selector = "#t", redactInput = false) =>
  read(html, redactInput)(selector).name;

describe("an embedded control lends its value (AccName 2C)", () => {
  // The finding's six repro cases, with the names Chromium gives them.
  it.each([
    [
      `<label><input id="t" type="checkbox"> Flash the screen <input value="3" aria-label="number of times"> times</label>`,
      "Flash the screen 3 times",
    ],
    [
      `<label><input id="t" type="checkbox"> Flash the screen <span role="textbox" contenteditable tabindex="0" aria-label="n">5</span> times</label>`,
      "Flash the screen 5 times",
    ],
    [`<h2 id="t">Items: <input value="12"></h2>`, "Items: 12"],
    [
      `<h2 id="t">Sort by <select><option>Name</option><option selected>Date</option></select></h2>`,
      "Sort by Date",
    ],
    [
      `<div role="tablist"><div role="tab" id="t">Tab <input value="x" aria-label="n"></div></div>`,
      "Tab x",
    ],
    [
      `<input id="i" value="hi"><button id="t" aria-labelledby="i">b</button>`,
      "hi",
    ],
  ])("%s", (html, name) => {
    expect(nameOf(html)).toBe(name);
  });

  // The WPT comp_embedded_control variants the DOM producer failed.
  it.each([
    [
      "a select",
      `<select><option>One</option><option selected>Two</option></select>`,
      "Two",
    ],
    [
      "a select with a size",
      `<select size="2"><option>One</option><option selected>Two</option></select>`,
      "Two",
    ],
    ["an input combobox", `<input role="combobox" value="Choice">`, "Choice"],
    [
      "a span combobox",
      `<span role="combobox" tabindex="0">Choice</span>`,
      "Choice",
    ],
    [
      "a div combobox",
      `<div role="combobox" tabindex="0">Choice</div>`,
      "Choice",
    ],
    [
      "an ARIA listbox, by its chosen option",
      `<ul role="listbox"><li role="option">One</li><li role="option" aria-selected="true">Two</li><li role="option">Three</li></ul>`,
      "Two",
    ],
    ["a range input", `<input type="range" min="0" max="10" value="4">`, "4"],
    ["a number input", `<input type="number" value="7">`, "7"],
    [
      "an ARIA slider by aria-valuenow",
      `<div role="slider" tabindex="0" aria-valuenow="5"></div>`,
      "5",
    ],
    [
      "an ARIA slider by aria-valuetext",
      `<div role="slider" tabindex="0" aria-valuenow="5" aria-valuetext="five"></div>`,
      "five",
    ],
    [
      "an ARIA spinbutton by aria-valuenow",
      `<div role="spinbutton" tabindex="0" aria-valuenow="3"></div>`,
      "3",
    ],
    [
      "an ARIA spinbutton by aria-valuetext",
      `<div role="spinbutton" tabindex="0" aria-valuenow="3" aria-valuetext="three"></div>`,
      "three",
    ],
  ])("%s", (_, control, value) => {
    const html = `<label><input id="t" type="checkbox"> Flash the screen ${control} times</label>`;
    expect(nameOf(html)).toBe(`Flash the screen ${value} times`);
  });

  it("is the value alone: never the control's aria-label (step 2D)", () => {
    expect(
      nameOf(`<h2 id="t">Count <input value="2" aria-label="how many"></h2>`),
    ).toBe("Count 2");
  });

  it("reads a range the page sets too, as Chromium does", () => {
    // AccName 2C names only a control the user adjusts; Chromium reads every
    // range, so the DOM producer does.
    expect(
      nameOf(
        `<h2 id="t">Upload <progress value="40" max="100"></progress></h2>`,
      ),
    ).toBe("Upload 40");
    expect(nameOf(`<h2 id="t">Disk <meter value="0.6"></meter></h2>`)).toBe(
      "Disk 0.6",
    );
    expect(
      nameOf(
        `<h2 id="t">Disk <div role="meter" aria-valuenow="60" aria-valuetext="60 percent"></div></h2>`,
      ),
    ).toBe("Disk 60 percent");
    // An indeterminate progress bar holds no value.
    expect(nameOf(`<h2 id="t">Loading <progress></progress></h2>`)).toBe(
      "Loading",
    );
  });

  it("joins several chosen options with spaces", () => {
    expect(
      nameOf(
        `<h2 id="t">Pick <select multiple size="3"><option selected>A</option><option>B</option><option selected>C</option></select></h2>`,
      ),
    ).toBe("Pick A C");
  });

  it("puts a referenced control's value before its aria-label (2C precedes 2D)", () => {
    expect(
      nameOf(
        `<input id="i" aria-label="Field" value="typed"><button id="t" aria-labelledby="i">b</button>`,
      ),
    ).toBe("typed");
    expect(
      nameOf(
        `<div role="slider" id="i" tabindex="0" aria-valuenow="5" aria-label="Vol"></div><button id="t" aria-labelledby="i">b</button>`,
      ),
    ).toBe("5");
    // An empty one gives way to its aria-label.
    expect(
      nameOf(
        `<input id="i" aria-label="Field"><button id="t" aria-labelledby="i">b</button>`,
      ),
    ).toBe("Field");
  });

  it("reads a chosen option by its resolved role, however it is spelled", () => {
    for (const role of ["OPTION", "option fallback"]) {
      expect(
        nameOf(
          `<h2 id="t">Pick <ul role="listbox"><li role="${role}">A</li><li role="${role}" aria-selected="true">B</li></ul></h2>`,
        ),
        role,
      ).toBe("Pick B");
    }
  });

  it("is a chosen option in a wrapper the listbox owns, as in Chromium", () => {
    // Chromium reads only options it owns directly or holds as their context:
    // its tree names this heading "Pick" (browser e2e embedded-control).
    expect(
      nameOf(
        `<h2 id="t">Pick <div role="listbox" tabindex="0" aria-owns="w"></div></h2><div id="w"><span role="option">One</span><span role="option" aria-selected="true">Two</span></div>`,
      ),
    ).toBe("Pick");
  });

  it("lends a description its value too", () => {
    expect(
      read(
        `<input id="d" value="hint text"><button id="t" aria-describedby="d">Go</button>`,
      )("#t").description,
    ).toBe("hint text");
  });
});

describe("what an embedded control never lends", () => {
  it("is the named control's own value, in its own label", () => {
    expect(nameOf(`<label>Name <input id="t" value="x"></label>`)).toBe("Name");
    expect(
      nameOf(`<label><span>Name <input id="t" value="x"></span></label>`),
    ).toBe("Name");
    // The field in case 1 keeps its own name.
    expect(
      nameOf(
        `<label><input type="checkbox"> Flash the screen <input id="t" value="3" aria-label="number of times"> times</label>`,
      ),
    ).toBe("number of times");
  });

  it("is a label's own name read from its control's value", () => {
    expect(nameOf(`<label id="t">Email <input value="a@b.c"></label>`)).toBe(
      "Email",
    );
  });

  it("is an option the user didn't choose", () => {
    expect(
      nameOf(
        `<h2 id="t">Pick <select><option>Apple</option><option selected>Pear</option><option>Plum</option></select></h2>`,
      ),
    ).toBe("Pick Pear");
    expect(
      nameOf(
        `<h2 id="t">Pick <ul role="listbox"><li role="option">Apple</li><li role="option">Pear</li></ul></h2>`,
      ),
    ).toBe("Pick");
  });

  it("is a date, time or colour input's value, which Chromium reads as parts", () => {
    for (const [type, value] of [
      ["color", "#ff0000"],
      ["date", "2030-04-01"],
      ["datetime-local", "2030-01-02T03:04"],
      ["month", "2030-04"],
      ["time", "13:45"],
      ["week", "2030-W05"],
    ]) {
      expect(
        nameOf(`<h2 id="t">Due <input type="${type}" value="${value}"></h2>`),
        type,
      ).toBe("Due");
    }
  });

  it("is a hidden chosen option, and finds one the listbox aria-owns", () => {
    expect(
      nameOf(
        `<h2 id="t">Pick <ul role="listbox"><li role="option">A</li><li role="option" aria-selected="true" style="display:none">B</li></ul></h2>`,
      ),
    ).toBe("Pick");
    expect(
      nameOf(
        `<h2 id="t">Pick <div role="listbox" tabindex="0" aria-owns="o1 o2"></div></h2><div role="option" id="o1">One</div><div role="option" id="o2" aria-selected="true">Two</div>`,
      ),
    ).toBe("Pick Two");
  });

  it("is a chosen option inside something hidden", () => {
    for (const wrapper of [
      `<div aria-hidden="true">`,
      `<div style="display:none">`,
    ]) {
      expect(
        nameOf(
          `<h2 id="t">Pick <ul role="listbox"><li role="option">A</li>${wrapper}<span role="option" aria-selected="true">B</span></div></ul></h2>`,
        ),
        wrapper,
      ).toBe("Pick");
      // An owned wrapper hides what it holds too.
      expect(
        nameOf(
          `<h2 id="t">Pick <div role="listbox" tabindex="0" aria-owns="w"></div></h2>${wrapper.replace("<div", '<div id="w"')}<span role="option" aria-selected="true">B</span></div>`,
        ),
        wrapper,
      ).toBe("Pick");
    }
  });

  it("keeps a chosen option visible again inside a visibility:hidden wrapper", () => {
    // visibility is no subtree rule: an option that sets it back is shown.
    expect(
      nameOf(
        `<h2 id="t">Pick <ul role="listbox"><li role="option">A</li><div style="visibility:hidden"><span role="option" aria-selected="true" style="visibility:visible">B</span></div></ul></h2>`,
      ),
    ).toBe("Pick B");
  });

  it("is anything, for an empty control", () => {
    expect(nameOf(`<h2 id="t">Save<input>now</h2>`)).toBe("Save now");
  });

  it("is a checkbox's, a radio's or a button's value", () => {
    expect(
      nameOf(
        `<label><input id="t" type="checkbox"> Agree <input type="radio" value="yes"> <input type="button" value="Press"></label>`,
      ),
    ).toBe("Agree");
  });
});

describe("an embedded control's value under ADR-0001", () => {
  it("withholds a whole name that a sensitive field's value reaches", () => {
    expect(
      nameOf(
        `<label><input id="t" type="checkbox"> Send code <input autocomplete="one-time-code" value="482913"> now</label>`,
      ),
    ).toBe(REDACTED_VALUE);
    expect(
      nameOf(`<h2 id="t">PIN <input type="password" value="hunter2"></h2>`),
    ).toBe(REDACTED_VALUE);
    expect(
      nameOf(
        `<input id="c" autocomplete="cc-number" value="4111111111111111"><button id="t" aria-labelledby="c">b</button>`,
      ),
    ).toBe(REDACTED_VALUE);
  });

  it("drops a description that a sensitive field's value reaches", () => {
    const at = read(
      `<input id="c" autocomplete="cc-csc" value="321"><button id="t" aria-describedby="c">Pay</button>`,
    );
    expect(at("#t")).toEqual({ name: "Pay", description: "" });
  });

  it("withholds nothing for an empty sensitive field", () => {
    expect(nameOf(`<h2 id="t">PIN <input type="password"> please</h2>`)).toBe(
      "PIN please",
    );
  });

  it("withholds every value in strict mode", () => {
    for (const html of [
      `<label><input id="t" type="checkbox"> Flash the screen <input value="3"> times</label>`,
      `<h2 id="t">Sort by <select><option>Name</option><option selected>Date</option></select></h2>`,
      `<h2 id="t">Volume <div role="slider" tabindex="0" aria-valuenow="5"></div></h2>`,
      `<input id="i" value="hi"><button id="t" aria-labelledby="i">b</button>`,
    ]) {
      expect(nameOf(html, "#t", true), html).toBe(REDACTED_VALUE);
      expect(nameOf(html, "#t", false), html).not.toBe(REDACTED_VALUE);
    }
  });

  it("withholds a select-only combobox named by its own text in strict mode", () => {
    // MUI Select: the combobox lists itself in its own aria-labelledby.
    const html = `<label id="l">Age</label><div role="combobox" id="t" tabindex="0" aria-labelledby="l t">Ten</div>`;
    expect(nameOf(html)).toBe("Age Ten");
    expect(nameOf(html, "#t", true)).toBe(REDACTED_VALUE);
  });

  it("keeps a value the page sets in strict mode, as native does", () => {
    // A progress bar's value is the page's state, never something entered.
    expect(
      nameOf(
        `<h2 id="t">Upload <progress value="40" max="100"></progress></h2>`,
        "#t",
        true,
      ),
    ).toBe("Upload 40");
  });

  it("keeps a name with no value in it, in strict mode", () => {
    expect(
      nameOf(
        `<label><input id="t" type="checkbox"> Flash the screen <input> times</label>`,
        "#t",
        true,
      ),
    ).toBe("Flash the screen times");
  });
});
