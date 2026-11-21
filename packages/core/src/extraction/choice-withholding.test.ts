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

  it("is withheld in a listbox an ARIA 1.1 wrapper holds, with no relation", () => {
    // ARIA 1.1 lets a combobox own its listbox as a child. The native
    // producers withhold this one too: Chromium gives the textbox inside such
    // a wrapper a `controls` relation to the listbox of its own (measured,
    // Chrome 153), pinned by the CLI e2e suite.
    expect(
      selectedOf(
        `<div role="combobox" aria-expanded="true">` +
          `<input aria-label="Expiry month" autocomplete="cc-exp-month">` +
          `<ul role="listbox" aria-label="Months">` +
          `<li role="option" aria-selected="true">03</li></ul></div>`,
      ),
    ).toEqual([["03", undefined]]);
  });

  it("is withheld for a wrapper whose sensitive field sits in its shadow root", () => {
    document.body.innerHTML =
      `<x-combo role="combobox" aria-controls="lb" aria-expanded="true"></x-combo>` +
      `<ul role="listbox" id="lb" aria-label="Cards">` +
      `<li role="option" aria-selected="true">Visa 1111</li></ul>`;
    document
      .querySelector("x-combo")!
      .attachShadow({ mode: "open" }).innerHTML =
      `<input aria-label="Card" autocomplete="cc-number">`;
    const states = [...extractDomTree(document.body).nodes.values()]
      .filter((n) => n.a11y.role === "option")
      .map((n) => n.a11y.states["selected"]);
    expect(states).toEqual([undefined]);
  });

  it("reads a wrapper's role as the tree does, past an unknown token", () => {
    expect(
      selectedOf(
        `<div role="x-combo combobox" aria-controls="lb" aria-expanded="true">` +
          `<input aria-label="Year" autocomplete="cc-exp-year"></div>` +
          `<ul role="listbox" id="lb" aria-label="Years">` +
          `<li role="option" aria-selected="true">2029</li></ul>`,
      ),
    ).toEqual([["2029", undefined]]);
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

    it("is the popup's alone: a field in a panel the sensitive field controls lends its own", () => {
      // As in the native producers, only a choice container lends the
      // sensitive choice; the country here is the page's to show.
      expect(
        namesOf(
          `<input aria-label="Card" autocomplete="cc-number" aria-controls="p">` +
            `<div id="p"><label><input type="checkbox"> Ship to ` +
            `<select aria-label="Country"><option selected>Spain</option></select></label></div>`,
          ["checkbox"],
        ),
      ).toEqual([["checkbox", "Ship to Spain"]]);
    });

    /** Each option's name and description, in document order. */
    const optionsOf = (html: string): Array<[string, string | undefined]> => {
      document.body.innerHTML = html;
      return [...extractDomTree(document.body).nodes.values()]
        .filter((n) => n.a11y.role === "option")
        .map((n) => [n.a11y.name, n.a11y.description || undefined]);
    };
    const field = (attrs: string) =>
      `<span id="lab">Expiry</span>` +
      `<input role="combobox" aria-expanded="true" aria-controls="lb" ${attrs}>`;

    it("is withheld from a description the chosen option takes from inside the popup", () => {
      // A hidden "selected" span only the chosen option carries.
      const popup =
        `<ul role="listbox" id="lb" aria-label="Months">` +
        `<li role="option" aria-selected="false">01</li>` +
        `<li role="option" aria-selected="true" aria-describedby="d3">03` +
        `<span id="d3" hidden>selected</span></li></ul>`;
      expect(
        optionsOf(
          field('autocomplete="cc-exp-month" aria-label="Month"') + popup,
        ),
      ).toEqual([
        ["01", undefined],
        ["03", undefined],
      ]);
      expect(optionsOf(field('aria-label="Color"') + popup)).toEqual([
        ["01", undefined],
        ["03", "selected"],
      ]);
    });

    it("is withheld from a name read from the chosen option outside the popup", () => {
      const popup =
        `<ul role="listbox" id="lb" aria-label="Months">` +
        `<li role="option" id="o3" aria-selected="true">03</li></ul>`;
      expect(
        namesOf(
          field('autocomplete="cc-exp-month" aria-labelledby="lab o3"') + popup,
          ["combobox"],
        ),
      ).toEqual([["combobox", "[redacted]"]]);
      expect(
        namesOf(field('aria-labelledby="lab o3"') + popup, ["combobox"]),
      ).toEqual([["combobox", "Expiry 03"]]);
    });

    it("keeps an option's name from its own span, but not from a popup inside it", () => {
      // React Aria labels each option by a span inside it. The last span
      // holds a second sensitive field's popup (the field is outside), whose
      // choice it would read.
      expect(
        optionsOf(
          field('autocomplete="cc-exp-month" aria-label="Month"') +
            `<ul role="listbox" id="lb" aria-label="Months">` +
            `<li role="option" aria-selected="false" aria-labelledby="s1"><span id="s1">January</span></li>` +
            `<li role="option" aria-selected="true" aria-labelledby="s3"><span id="s3">March</span></li>` +
            `<li role="option" aria-selected="false" aria-labelledby="s9"><span id="s9">` +
            `<span role="listbox" id="lb2" aria-label="Cards">` +
            `<span role="option" aria-selected="true">Visa 1111</span></span></span></li></ul>` +
            `<input role="combobox" aria-label="Card" autocomplete="cc-number" aria-controls="lb2">`,
        ).map(([name]) => name),
      ).toEqual(["January", "March", "[redacted]", "Visa 1111"]);
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

  describe("where the tree places it", () => {
    /** Each node's role, name and description, for the roles given. */
    const readOf = (
      roles: string[],
      root: Element = document.body,
    ): Array<[string, string, string | undefined]> =>
      [...extractDomTree(root).nodes.values()]
        .filter((n) => roles.includes(n.a11y.role))
        .map((n) => [
          n.a11y.role,
          n.a11y.name,
          n.a11y.description || undefined,
        ]);

    it("is withheld for a wrapper whose sensitive field is slotted into it", () => {
      // The field is the host's light child; the slot renders it inside the
      // combobox, as Chromium's flat tree reads it.
      for (const [autocomplete, selected] of [
        ["cc-exp-month", undefined],
        ["off", true],
      ] as const) {
        document.body.innerHTML = `<x-field><input aria-label="Month" autocomplete="${autocomplete}"></x-field>`;
        document.body.firstElementChild!.attachShadow({
          mode: "open",
        }).innerHTML =
          `<div role="combobox" aria-controls="lb" aria-expanded="true"><slot></slot></div>` +
          `<ul role="listbox" id="lb" aria-label="Months"><li role="option" aria-selected="true">03</li></ul>`;
        expect(
          [...extractDomTree(document.body).nodes.values()]
            .filter((n) => n.a11y.role === "option")
            .map((n) => n.a11y.states["selected"]),
          autocomplete,
        ).toEqual([selected]);
      }
    });

    it("is withheld in the popup a sensitive field's aria-activedescendant sits in", () => {
      const page = (attrs: string) =>
        `<input role="combobox" aria-label="Month" aria-expanded="true" aria-activedescendant="o3" ${attrs}>` +
        `<ul role="listbox" id="lb" aria-label="Months">` +
        `<li role="option" aria-selected="false">01</li>` +
        `<li role="option" id="o3" aria-selected="true">03</li></ul>` +
        `<button aria-labelledby="lb"></button>`;
      expect(selectedOf(page('autocomplete="cc-exp-month"'))).toEqual([
        ["01", undefined],
        ["03", undefined],
      ]);
      expect(readOf(["button"])).toEqual([["button", "[redacted]", undefined]]);
      expect(selectedOf(page(""))).toEqual([
        ["01", false],
        ["03", true],
      ]);
      // AccName reads a listbox referenced directly as an embedded control.
      expect(readOf(["button"])).toEqual([["button", "03", undefined]]);
    });

    it("finds the popup aria-activedescendant reaches in another tree scope, whatever asks first", () => {
      // The listbox is the host; its shadow root holds the field and the
      // options. The option's description is read before anything asks
      // about the shadow root's field.
      for (const [autocomplete, description] of [
        ["cc-exp-month", undefined],
        ["off", "chosen"],
      ]) {
        document.body.innerHTML = `<x-list id="xl" role="listbox" aria-label="Months"></x-list>`;
        document
          .getElementById("xl")!
          .attachShadow({ mode: "open" }).innerHTML =
          `<input role="combobox" aria-label="Month" autocomplete="${autocomplete}" aria-activedescendant="o3">` +
          `<div role="option" id="o3" aria-selected="true" aria-description="chosen">03</div>`;
        expect(readOf(["option"]), autocomplete).toEqual([
          ["option", "03", description],
        ]);
      }
    });

    it("is withheld in every popup that carries the id a sensitive field names", () => {
      // A responsive page renders the form twice, a hidden copy first; the
      // page resolves the id to the hidden one, but the visible popup holds
      // the same choice.
      const copy =
        `<input role="combobox" aria-label="Month" autocomplete="cc-exp-month" aria-controls="lb">` +
        `<ul role="listbox" id="lb" aria-label="Months"><li role="option" aria-selected="true">07</li></ul>`;
      expect(
        selectedOf(`<div aria-hidden="true">${copy}</div><div>${copy}</div>`),
      ).toEqual([
        ["07", undefined],
        ["07", undefined],
      ]);
    });

    it("is withheld on an option a sensitive field controls itself", () => {
      // Only that option: what it points at is all that is reached.
      expect(
        selectedOf(
          `<input role="combobox" aria-label="Month" autocomplete="cc-exp-month" aria-controls="o3">` +
            `<ul role="listbox" aria-label="Months">` +
            `<li role="option" aria-selected="false">01</li>` +
            `<li role="option" id="o3" aria-selected="true">03</li></ul>`,
        ),
      ).toEqual([
        ["01", false],
        ["03", undefined],
      ]);
    });

    it("is withheld from a name or description that reads a sensitive drop-down's option", () => {
      // Its role is combobox, not a choice container: the option is inside
      // the field, whose value its text is.
      const page = (autocomplete: string) =>
        `<select aria-label="Year" autocomplete="${autocomplete}">` +
        `<option>2027</option><option id="o" selected>2031</option></select>` +
        `<button aria-labelledby="o"></button><button aria-describedby="o">Pay</button>`;
      document.body.innerHTML = page("cc-exp-year");
      expect(readOf(["button"])).toEqual([
        ["button", "[redacted]", undefined],
        ["button", "Pay", undefined],
      ]);
      document.body.innerHTML = page("off");
      expect(readOf(["button"])).toEqual([
        ["button", "2031", undefined],
        ["button", "Pay", "2031"],
      ]);
    });

    it("is withheld from a name that reads an option the popup owns", () => {
      const page = (autocomplete: string) =>
        `<input role="combobox" aria-label="Month" autocomplete="${autocomplete}" aria-controls="lb" aria-expanded="true">` +
        `<div role="listbox" id="lb" aria-label="Months" aria-owns="o1 o3"></div>` +
        `<div><div role="option" id="o1" aria-selected="false">01</div>` +
        `<div role="option" id="o3" aria-selected="true">03</div></div>` +
        `<button aria-labelledby="o3"></button>`;
      document.body.innerHTML = page("cc-exp-month");
      expect(readOf(["button"])).toEqual([["button", "[redacted]", undefined]]);
      document.body.innerHTML = page("off");
      expect(readOf(["button"])).toEqual([["button", "03", undefined]]);
    });

    it("keeps a name that reads an option a sensitive input owns, while nothing is chosen", () => {
      // Chromium leaves what an <input> owns where it is: the listbox is its
      // popup, not its value, so with no choice made it lends nothing.
      const page = (selected: string) =>
        `<input role="combobox" aria-label="Month" autocomplete="cc-exp-month" aria-owns="lb" aria-expanded="true">` +
        `<ul role="listbox" id="lb" aria-label="Months">` +
        `<li role="option" id="o1" aria-selected="${selected}">01</li></ul>` +
        `<button aria-labelledby="o1"></button>`;
      document.body.innerHTML = page("false");
      expect(readOf(["button"])).toEqual([["button", "01", undefined]]);
      document.body.innerHTML = page("true");
      expect(readOf(["button"])).toEqual([["button", "[redacted]", undefined]]);
    });

    it("drops every description in a sensitive popup with a choice, whatever it is built from", () => {
      // A span after the list, aria-description and title each say which
      // option is the chosen one as well as a span inside it would.
      const page = (autocomplete: string, selected: string) =>
        `<input role="combobox" aria-label="Month" autocomplete="${autocomplete}" aria-controls="lb" aria-expanded="true">` +
        `<ul role="listbox" id="lb" aria-label="Months" aria-describedby="hint">` +
        `<li role="option" aria-selected="false">01</li>` +
        `<li role="option" aria-selected="${selected}" aria-describedby="d">02</li>` +
        `<li role="option" aria-selected="false" aria-description="selected">03</li>` +
        `<li role="option" aria-selected="false" title="current choice">04</li></ul>` +
        `<span id="d" hidden>selected</span><span id="hint" hidden>Pick one</span>`;
      document.body.innerHTML = page("cc-exp-month", "true");
      expect(readOf(["listbox", "option"]).map(([, , d]) => d)).toEqual([
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ]);
      // Nothing chosen gives nothing away, and an ordinary field's popup
      // keeps them.
      for (const [autocomplete, selected] of [
        ["cc-exp-month", "false"],
        ["off", "true"],
      ]) {
        document.body.innerHTML = page(autocomplete!, selected!);
        expect(readOf(["listbox", "option"]).map(([, , d]) => d)).toEqual([
          "Pick one",
          undefined,
          "selected",
          "selected",
          "current choice",
        ]);
      }
    });

    it("is withheld in a read that starts inside a closed shadow root", () => {
      // The page's query for sensitive fields can't enter a closed root, so
      // it must not decide for a read that starts in one.
      document.body.innerHTML = `<x-card></x-card>`;
      const root = document.body.firstElementChild!.attachShadow({
        mode: "closed",
      });
      root.innerHTML =
        `<div id="start"><input role="combobox" aria-label="Month" autocomplete="cc-exp-month" aria-controls="lb">` +
        `<ul role="listbox" id="lb" aria-label="Months"><li role="option" aria-selected="true">03</li></ul></div>`;
      expect(
        [...extractDomTree(root.getElementById("start")!).nodes.values()]
          .filter((n) => n.a11y.role === "option")
          .map((n) => n.a11y.states["selected"]),
      ).toEqual([undefined]);
    });

    it("reads an ordinary list nested in a sensitive popup as the popup's", () => {
      // The grid holds the choice; the list inside it holds none. As in the
      // native producers, what is in it is the grid's: no description, and a
      // reference into it reads the grid's choice.
      const page = (autocomplete: string) =>
        `<input role="combobox" aria-label="Date" autocomplete="${autocomplete}" aria-controls="g" aria-expanded="true">` +
        `<div role="grid" id="g" aria-label="Dates"><div role="row" aria-selected="true">` +
        `<div role="gridcell"><ul role="listbox" aria-label="Slots">` +
        `<li role="option" id="s1" aria-selected="false" aria-description="morning">9:00</li>` +
        `</ul></div></div></div><button aria-labelledby="s1"></button>`;
      document.body.innerHTML = page("cc-exp");
      expect(readOf(["option", "button"])).toEqual([
        ["option", "9:00", undefined],
        ["button", "[redacted]", undefined],
      ]);
      document.body.innerHTML = page("off");
      expect(readOf(["option", "button"])).toEqual([
        ["option", "9:00", "morning"],
        ["button", "9:00", undefined],
      ]);
    });

    it("is withheld in a subtree that is not in a document", () => {
      // The page-wide shortcut has no page to ask, so the climbs decide. (An
      // id reference can't resolve there, so the wrapper holds the listbox.)
      const root = document.createElement("div");
      root.innerHTML =
        `<div role="combobox" aria-expanded="true"><input aria-label="Month" autocomplete="cc-exp-month">` +
        `<ul role="listbox" aria-label="Months"><li role="option" aria-selected="true">03</li></ul></div>`;
      expect(
        [...extractDomTree(root).nodes.values()]
          .filter((n) => n.a11y.role === "option")
          .map((n) => n.a11y.states["selected"]),
      ).toEqual([undefined]);
    });
  });
});
