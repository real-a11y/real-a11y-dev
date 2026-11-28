import { describe, it, expect, beforeAll } from "vitest";

import {
  registerA11yMatchers,
  boxedOutlineSnapshot,
  boxedTabSequenceSnapshot,
  boxedTreeSnapshot,
} from "./matchers.js";

import { a11ySnapshotSerializer } from "./matchers.js";

import { outlineSnapshot, tabSequenceSnapshot } from "./index.js";

beforeAll(() => {
  registerA11yMatchers(expect);
});

function mount(html: string): HTMLElement {
  document.body.innerHTML = "";
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

describe("assertion matchers", () => {
  it("toHaveNoUnlabeledInteractive passes / fails / negates", () => {
    expect(mount(`<button>Go</button>`)).toHaveNoUnlabeledInteractive();
    expect(mount(`<button></button>`)).not.toHaveNoUnlabeledInteractive();

    expect(() =>
      expect(mount(`<button></button>`)).toHaveNoUnlabeledInteractive(),
    ).toThrow(/unlabeled interactive/i);
  });

  it("toHaveValidHeadingOrder catches a skipped level", () => {
    expect(mount(`<h1>A</h1><h2>B</h2>`)).toHaveValidHeadingOrder();
    expect(mount(`<h1>A</h1><h3>B</h3>`)).not.toHaveValidHeadingOrder();
  });

  it("toHaveLabeledDialogs requires accessible names", () => {
    expect(
      mount(`<div role="dialog" aria-label="Confirm">x</div>`),
    ).toHaveLabeledDialogs();
    expect(mount(`<div role="dialog"></div>`)).not.toHaveLabeledDialogs();
  });

  it("toHaveValidLandmarks requires exactly one main", () => {
    expect(mount(`<main>only</main>`)).toHaveValidLandmarks();
    expect(mount(`<main>a</main><main>b</main>`)).not.toHaveValidLandmarks();
  });

  it("toHaveUniqueInteractiveNames fails on two controls of one name", () => {
    expect(
      mount(`<button>Accept Ana</button><button>Accept Luis</button>`),
    ).toHaveUniqueInteractiveNames();
    expect(
      mount(`<button>Accept</button><button>Accept</button>`),
    ).not.toHaveUniqueInteractiveNames();
    expect(() =>
      expect(
        mount(`<button>Accept</button><button>Accept</button>`),
      ).toHaveUniqueInteractiveNames(),
    ).toThrow(/another button is also named "Accept"/);
  });

  it("reports a clear error when given a non-Element", () => {
    expect(() => expect("nope").toHaveValidLandmarks()).toThrow(
      /expected a DOM Element/,
    );
  });

  it("still fails under .not when given a non-Element", () => {
    // The guard must THROW, not return `{ pass: false }` — `.not` inverts a
    // returned failure, so a wrong-typed value would report success while
    // running no audit at all. The canonical trap: `container.firstChild` is
    // null, and the negated expectation "passes".
    expect(() => expect(null).not.toHaveNoUnlabeledInteractive()).toThrow(
      /expected a DOM Element/,
    );

    expect(() => expect(undefined).not.toHaveValidHeadingOrder()).toThrow(
      /expected a DOM Element/,
    );

    expect(() => expect(null).not.toHaveTabSequence([])).toThrow(
      /expected a DOM Element/,
    );

    expect(() => expect(null).not.toBeValidA11yTree()).toThrow(
      /expected a DOM Element/,
    );

    expect(() => expect(42).not.toMatchA11yContract("main")).toThrow(
      /expected a DOM Element or a serialized tree string/,
    );
  });
});

describe("toBeValidA11yTree", () => {
  it("passes a valid tree and fails on an ARIA error", () => {
    expect(
      mount(`<main><h1>Dashboard</h1><button>Save</button></main>`),
    ).toBeValidA11yTree();
    // an unnamed button — role "button" requires an accessible name
    expect(mount(`<button></button>`)).not.toBeValidA11yTree();
  });

  it("reports a role=heading with no aria-level", () => {
    // heading-order compares it at level 2; this is where the missing
    // attribute itself is reported.
    expect(
      mount(`<main><h1>t</h1><div role="heading">x</div></main>`),
    ).not.toBeValidA11yTree();
    expect(
      mount(
        `<main><h1>t</h1><div role="heading" aria-level="2">x</div></main>`,
      ),
    ).toBeValidA11yTree();
  });

  it("raises nothing for an invalid field", () => {
    const root = mount(
      `<main>
        <input aria-invalid="true" aria-label="a">
        <div role="textbox" aria-invalid="grammar" aria-label="b"></div>
        <input pattern="[0-9]+" value="abc" aria-label="c">
        <input type="email" value="nope" aria-label="d">
        <input id="custom" aria-label="e">
        <input required aria-label="f">
      </main>`,
    );
    root
      .querySelector<HTMLInputElement>("#custom")!
      .setCustomValidity("Not like that");
    expect(root).toBeValidA11yTree();
  });

  it("asks nothing of the aria-selected a sensitive popup's options carry, which the tree withholds", () => {
    const popup = (first: string, autocomplete = "cc-exp-month") =>
      mount(
        `<input role="combobox" aria-label="Month" aria-expanded="true" aria-controls="lb" autocomplete="${autocomplete}">` +
          `<ul role="listbox" id="lb" aria-label="Months">` +
          `<li role="option" ${first}>01</li><li role="option" aria-selected="true">03</li></ul>`,
      );
    expect(popup('aria-selected="false"')).toBeValidA11yTree();
    // Written on the chosen option only: asking which option lacks it would
    // say which one is chosen.
    expect(popup("")).toBeValidA11yTree();
    // An ordinary popup's option still needs it.
    expect(popup("", "off")).not.toBeValidA11yTree();
  });

  it("asks nothing of the aria-checked a sensitive menu's radio items carry, which the tree withholds", () => {
    const popup = (first: string, autocomplete = "cc-exp") =>
      mount(
        `<input role="combobox" aria-label="Expiry" aria-haspopup="menu" aria-expanded="true" aria-controls="m" autocomplete="${autocomplete}">` +
          `<div role="menu" id="m" aria-label="Dates">` +
          `<div role="menuitemradio" tabindex="-1" ${first}>01/30</div>` +
          `<div role="menuitemradio" tabindex="-1" aria-checked="true">03/31</div></div>`,
      );
    expect(popup('aria-checked="false"')).toBeValidA11yTree();
    // Written on the chosen item only: asking which item lacks it would say
    // which one is chosen.
    expect(popup("")).toBeValidA11yTree();
    // An ordinary popup's item still needs it.
    expect(popup("", "off")).not.toBeValidA11yTree();
  });

  it("accepts DPUB-ARIA and Graphics-ARIA roles", () => {
    expect(
      mount(
        `<nav role="doc-toc" aria-label="Contents"><a href="#c1">One</a></nav>` +
          `<hr role="doc-pagebreak" aria-label="12">` +
          `<div role="graphics-document" aria-label="Chart">x</div>`,
      ),
    ).toBeValidA11yTree();
    expect(mount(`<div role="video">x</div>`)).not.toBeValidA11yTree();
  });

  it("passes realistic valid markup (landmarks, nav, list, links)", () => {
    expect(
      mount(`
        <header>
          <nav aria-label="Primary">
            <ul>
              <li><a href="/">Home</a></li>
              <li><a href="/about">About</a></li>
            </ul>
          </nav>
        </header>
        <main>
          <h1>Dashboard</h1>
          <button>Save</button>
        </main>
      `),
    ).toBeValidA11yTree();
  });

  it("reports the violation in the failure message", () => {
    expect(() =>
      expect(mount(`<button></button>`)).toBeValidA11yTree(),
    ).toThrow(/ARIA violation/i);
  });

  it("owes no aria-expanded on a combobox that invokes a popover", () => {
    // The browser supplies the state: whether the popover is showing.
    expect(
      mount(`
        <button role="combobox" popovertarget="list" aria-controls="list" aria-label="Size"></button>
        <div id="list" popover role="listbox" aria-label="Sizes"></div>
      `),
    ).toBeValidA11yTree();
    expect(() =>
      expect(
        mount(`
          <button role="combobox" popovertarget="nowhere" aria-controls="list" aria-label="Size"></button>
          <div id="list" role="listbox" aria-label="Sizes"></div>
        `),
      ).toBeValidA11yTree(),
    ).toThrow(/missing required aria-expanded/);
  });
});

describe("toHaveTabSequence", () => {
  it("matches the computed Tab order (positive tabindex first)", () => {
    const root = mount(`
      <button>Zero</button>
      <button tabindex="1">First</button>
    `);
    expect(root).toHaveTabSequence(['button "First"', 'button "Zero"']);
    expect(root).not.toHaveTabSequence(['button "Zero"', 'button "First"']);
  });

  it("fails with both sequences in the message", () => {
    const root = mount(`<a href="#">Home</a>`);
    expect(() => expect(root).toHaveTabSequence(['link "Away"'])).toThrow(
      /Tab sequence mismatch[\s\S]*expected[\s\S]*actual/,
    );
  });

  it("reads a stop in a sensitive field's popup as [redacted], as the snapshot does", () => {
    const root = mount(`
      <input role="combobox" aria-label="Month" autocomplete="cc-exp-month" aria-expanded="true" aria-controls="lb">
      <ul role="listbox" id="lb" aria-label="Months"><li role="option" tabindex="0">03</li></ul>
    `);
    expect(root).toHaveTabSequence(['combobox "Month"', 'option "[redacted]"']);
    // A failure message can't say it either: its actual line has no "03".
    let message = "";
    try {
      expect(root).toHaveTabSequence(['option "03"']);
    } catch (error) {
      message = (error as Error).message;
    }
    const actual = message.split("\n").find((l) => l.includes("actual:"));
    expect(actual).toContain("[redacted]");
    expect(actual).not.toContain("03");
  });

  it("matches a straight-quote token against a rendered curly apostrophe", () => {
    // The rendered label uses a curly apostrophe (U+2019); the test author
    // types a plain one. They should still match.
    const root = mount(`<button aria-label="Don’t save">x</button>`);
    expect(root).toHaveTabSequence([`button "Don't save"`]);
  });
});

describe("boxedTreeSnapshot serializer", () => {
  it("renders the deterministic tree via the native snapshot path", () => {
    const root = mount(`<main><h1>Hi</h1><button>Go</button></main>`);
    expect(boxedTreeSnapshot(root)).toMatchInlineSnapshot(`
      main
        heading "Hi" (level 1)
        button "Go"
    `);
  });

  it("forwards serialize options (redaction)", () => {
    const root = mount(`<h1>Order #12345</h1>`);
    const out = boxedTreeSnapshot(root, { redact: [/#\d+/g] });
    expect(a11ySnapshotSerializerText(out)).not.toContain("#12345");
  });
});

describe("boxedTabSequenceSnapshot and boxedOutlineSnapshot", () => {
  const page = `
    <h1>Book a table</h1>
    <h2>When</h2>
    <label>Date <input type="text" value="2030-11-18"></label>
    <h2>Who</h2>
    <a href="/terms">Terms</a>
    <button aria-pressed="true">Window seat</button>`;

  it("print what tabSequenceSnapshot and outlineSnapshot print, byte for byte", () => {
    const root = mount(page);
    root.querySelector("input")!.focus();
    for (const options of [
      undefined,
      { values: true },
      { states: false },
      { markFocus: false },
      { redact: [/Window/] },
    ]) {
      expect(boxedTabSequenceSnapshot(root, options).text).toBe(
        tabSequenceSnapshot(root, options),
      );
      expect(boxedOutlineSnapshot(root, options).text).toBe(
        outlineSnapshot(root, options),
      );
    }
  });

  it("render unquoted through the serializer", () => {
    const root = mount(page);
    expect(boxedTabSequenceSnapshot(root)).toMatchInlineSnapshot(`
      textbox "Date"
      link "Terms"
      button "Window seat" {pressed}
    `);
    expect(boxedOutlineSnapshot(root)).toMatchInlineSnapshot(`
      h1 Book a table
        h2 When
        h2 Who
    `);
  });

  it("throw on a root that is neither an element nor a tree, as the strings do", () => {
    expect(() => boxedTabSequenceSnapshot(null as never)).toThrow(
      /serializeTabSequence/,
    );
    expect(() => boxedOutlineSnapshot(42 as never)).toThrow(/serializeOutline/);
  });
});

// Small helper so the redaction test doesn't depend on snapshot internals.
function a11ySnapshotSerializerText(box: unknown): string {
  return a11ySnapshotSerializer.test(box)
    ? a11ySnapshotSerializer.serialize(box)
    : "";
}
