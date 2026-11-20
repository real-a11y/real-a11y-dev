import { afterEach, describe, expect, it } from "vitest";

import { extractDomTree } from "./dom-extractor.js";

/**
 * A sensitive field's choice is its value, and a popup's selected option says
 * what it is. These pin the DOM producer's half of the rule; the native
 * producers' halves are in the browser package's native-tree tests and the
 * extension's native-core tests.
 */
describe("the choice a sensitive field holds", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  /** Each option's name and its `selected` state, in document order. */
  const selectedOf = (
    html: string,
    options: { redactInput?: boolean } = {},
  ): Array<[string, unknown]> => {
    document.body.innerHTML = html;
    return [...extractDomTree(document.body, options).nodes.values()]
      .filter((n) => n.a11y.role === "option")
      .map((n) => [n.a11y.name, n.a11y.states["selected"]]);
  };

  const months = (attrs: string) =>
    `<label for="m">Expiry month</label>` +
    `<input id="m" role="combobox" aria-expanded="true" ${attrs}>` +
    `<ul role="listbox" id="lb" aria-label="Months">` +
    `<li role="option" aria-selected="false">01</li>` +
    `<li role="option" aria-selected="true">03</li></ul>`;

  it("is withheld in the popup a sensitive combobox controls", () => {
    expect(
      selectedOf(months('autocomplete="cc-exp-month" aria-controls="lb"')),
    ).toEqual([
      ["01", undefined],
      ["03", undefined],
    ]);
  });

  it("is withheld in the popup a sensitive combobox owns", () => {
    expect(
      selectedOf(months('autocomplete="cc-exp-month" aria-owns="lb"')),
    ).toEqual([
      ["01", undefined],
      ["03", undefined],
    ]);
  });

  it("is withheld below a controlled wrapper, not only on its direct children", () => {
    expect(
      selectedOf(
        `<input role="combobox" aria-label="Card" autocomplete="cc-number" aria-controls="pop">` +
          `<div id="pop"><div><ul role="listbox" aria-label="Cards">` +
          `<li role="option" aria-selected="true">Visa ending 1111</li></ul></div></div>`,
      ),
    ).toEqual([["Visa ending 1111", undefined]]);
  });

  it("is withheld when one of several aria-controls ids names the popup", () => {
    expect(
      selectedOf(
        months('autocomplete="cc-exp-month" aria-controls="other  lb"'),
      ),
    ).toEqual([
      ["01", undefined],
      ["03", undefined],
    ]);
  });

  it("is withheld in the popup an ARIA 1.1 combobox around a sensitive field controls or owns", () => {
    // The wrapper carries the relation; the field inside has none of its own.
    for (const relation of ["aria-controls", "aria-owns"]) {
      expect(
        selectedOf(
          `<div role="combobox" ${relation}="lb" aria-expanded="true">` +
            `<input aria-label="Expiry month" autocomplete="cc-exp-month"></div>` +
            `<ul role="listbox" id="lb" aria-label="Months">` +
            `<li role="option" aria-selected="true">03</li></ul>`,
        ),
        relation,
      ).toEqual([["03", undefined]]);
    }
    // …and an ordinary field in the same wrapper keeps the popup's choice.
    expect(
      selectedOf(
        `<div role="combobox" aria-controls="lb" aria-expanded="true">` +
          `<input aria-label="Color"></div>` +
          `<ul role="listbox" id="lb" aria-label="Colors">` +
          `<li role="option" aria-selected="true">Red</li></ul>`,
      ),
    ).toEqual([["Red", true]]);
  });

  it("is kept in an ordinary combobox's popup", () => {
    expect(selectedOf(months('aria-controls="lb"'))).toEqual([
      ["01", false],
      ["03", true],
    ]);
  });

  it("is kept when only an ordinary field controls the popup", () => {
    // A sensitive field elsewhere on the page names nothing here.
    expect(
      selectedOf(
        `<input type="password" aria-label="PIN" aria-controls="elsewhere">` +
          months('aria-controls="lb"'),
      ),
    ).toEqual([
      ["01", false],
      ["03", true],
    ]);
  });

  it("is withheld on a sensitive select's option even with an authored aria-selected", () => {
    // aria-selected wins over selectedness, as in Chromium, so the select's
    // own rule never saw it; the shared one does.
    expect(
      selectedOf(
        `<select autocomplete="cc-exp-month" aria-label="Month">` +
          `<option aria-selected="true">11</option><option selected>12</option></select>`,
      ),
    ).toEqual([
      ["11", undefined],
      ["12", undefined],
    ]);
  });

  it("is withheld inside a shadow root, where the combobox and its popup share an id scope", () => {
    document.body.innerHTML = `<div id="host"></div>`;
    const root = document.getElementById("host")!.attachShadow({
      mode: "open",
    });
    root.innerHTML = months('autocomplete="cc-exp-month" aria-controls="lb"');
    const states = [...extractDomTree(document.body).nodes.values()]
      .filter((n) => n.a11y.role === "option")
      .map((n) => n.a11y.states["selected"]);
    expect(states).toEqual([undefined, undefined]);
  });

  it("follows aria-controls only within its id scope", () => {
    // The combobox sits in a shadow root and names an id only the light DOM
    // has: an IDREF doesn't cross the boundary, in Chromium or here.
    document.body.innerHTML =
      `<div id="host"></div><ul role="listbox" id="lb" aria-label="Months">` +
      `<li role="option" aria-selected="true">03</li></ul>`;
    const root = document.getElementById("host")!.attachShadow({
      mode: "open",
    });
    root.innerHTML = `<input role="combobox" aria-label="Month" autocomplete="cc-exp-month" aria-controls="lb">`;
    const states = [...extractDomTree(document.body).nodes.values()]
      .filter((n) => n.a11y.role === "option")
      .map((n) => n.a11y.states["selected"]);
    expect(states).toEqual([true]);
  });

  it("leaves the field's own value and the popup's names as they were", () => {
    document.body.innerHTML = months(
      'autocomplete="cc-exp-month" aria-controls="lb" value="03"',
    );
    const nodes = [...extractDomTree(document.body).nodes.values()];
    expect(nodes.find((n) => n.a11y.role === "combobox")?.a11y.value).toBe(
      "[redacted]",
    );
    expect(
      nodes.filter((n) => n.a11y.role === "option").map((n) => n.a11y.name),
    ).toEqual(["01", "03"]);
  });

  describe("in a name built around the popup", () => {
    /** Each node's role and name, for the roles given, in document order. */
    const namesOf = (
      html: string,
      roles: string[],
    ): Array<[string, string]> => {
      document.body.innerHTML = html;
      return [...extractDomTree(document.body).nodes.values()]
        .filter((n) => roles.includes(n.a11y.role))
        .map((n) => [n.a11y.role, n.a11y.name]);
    };

    const labelled = (attrs: string, selected: string) =>
      `<label>Expiry month <input role="combobox" aria-expanded="true" ${attrs}>` +
      `<ul role="listbox" id="lb"><li role="option" aria-selected="${selected}">03</li></ul></label>`;

    it("is withheld from a label around the field and its popup", () => {
      expect(
        namesOf(
          labelled('autocomplete="cc-exp-month" aria-controls="lb"', "true"),
          ["combobox"],
        ),
      ).toEqual([["combobox", "[redacted]"]]);
    });

    it("is withheld from a name that references the popup", () => {
      expect(
        namesOf(
          `<span id="lab">Card</span>` +
            `<ul role="listbox" id="lb"><li role="option" aria-selected="true">Visa 1111</li></ul>` +
            `<input role="combobox" autocomplete="cc-number" aria-controls="lb" aria-labelledby="lab lb">`,
          ["combobox"],
        ),
      ).toEqual([["combobox", "[redacted]"]]);
    });

    it("is withheld from a cell around an ARIA 1.1 wrapper's popup", () => {
      expect(
        namesOf(
          `<div role="combobox" aria-controls="lb" aria-expanded="true" aria-label="Wrapper">` +
            `<input aria-label="Card" autocomplete="cc-number"></div>` +
            `<table><tr><td><ul role="listbox" id="lb" aria-label="Cards">` +
            `<li role="option" aria-selected="true">Visa 1111</li></ul></td></tr></table>`,
          ["cell"],
        ),
      ).toEqual([["cell", "[redacted]"]]);
    });

    it("is kept when nothing is chosen, or the field is ordinary", () => {
      expect(
        namesOf(
          labelled('autocomplete="cc-exp-month" aria-controls="lb"', "false"),
          ["combobox"],
        ),
      ).toEqual([["combobox", "Expiry month"]]);
      expect(
        namesOf(labelled('aria-controls="lb"', "true"), ["combobox"]),
      ).toEqual([["combobox", "Expiry month 03"]]);
    });
  });
});
