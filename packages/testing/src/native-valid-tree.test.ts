/**
 * `toBeValidA11yTree` against NATIVE markup carrying no ARIA at all.
 *
 * Every case below was reported as an ARIA violation before implicit roles
 * were distinguished from authored ones — a bare `<select>` produced six.
 * Found running the published package from npm (scenario R34).
 */
import { expect, describe, it, beforeAll } from "vitest";

import { registerA11yMatchers } from "./matchers.js";

beforeAll(() => registerA11yMatchers(expect));

function mount(html: string): HTMLElement {
  document.body.innerHTML = `<main><h1>Page</h1>${html}</main>`;
  return document.querySelector("main")!;
}

describe("native HTML is valid without author-supplied ARIA", () => {
  it("a bare <select> with options", () => {
    expect(
      mount(
        `<label>Status <select><option>Open</option><option>Done</option></select></label>`,
      ),
    ).toBeValidA11yTree();
  });

  it("checkboxes, checked and unchecked", () => {
    expect(
      mount(`<label><input type="checkbox"> Weekends</label>`),
    ).toBeValidA11yTree();
    expect(
      mount(`<label><input type="checkbox" checked> Weekends</label>`),
    ).toBeValidA11yTree();
  });

  it("a radio group", () => {
    expect(
      mount(`<label><input type="radio" name="p"> Normal</label>`),
    ).toBeValidA11yTree();
  });

  it("a table named by its caption", () => {
    expect(
      mount(
        `<table><caption>Open tickets</caption><tbody><tr><td>NW-1</td></tr></tbody></table>`,
      ),
    ).toBeValidA11yTree();
  });

  it("a realistic form — the shape that produced the original wall", () => {
    expect(
      mount(`
        <label>Status <select><option>All</option><option>Open</option></select></label>
        <label><input type="checkbox"> Only unassigned</label>
        <table><caption>Open tickets</caption><tbody><tr><td>NW-1</td></tr></tbody></table>
      `),
    ).toBeValidA11yTree();
  });
});

describe("authored ARIA still owes the contract", () => {
  it("role=combobox without aria-expanded / aria-controls is reported", () => {
    const root = mount(`<div role="combobox" aria-label="Status"></div>`);
    expect(root).not.toBeValidA11yTree();
  });

  it("role=checkbox without aria-checked is reported", () => {
    const root = mount(
      `<div role="checkbox" tabindex="0" aria-label="Weekends"></div>`,
    );
    expect(root).not.toBeValidA11yTree();
  });

  it("an authored combobox owning an authored option is still a nesting error", () => {
    const root = mount(
      `<div role="combobox" aria-label="S" aria-expanded="false" aria-controls="x"><div role="option">A</div></div>`,
    );
    expect(root).not.toBeValidA11yTree();
  });
});

describe("real problems are still caught in native markup", () => {
  it("an unnamed native select", () => {
    expect(
      mount(`<select><option>Open</option></select>`),
    ).not.toBeValidA11yTree();
  });

  it("a table with no caption and no label", () => {
    expect(
      mount(`<table><tbody><tr><td>NW-1</td></tr></tbody></table>`),
    ).not.toBeValidA11yTree();
  });

  it("a link nested inside a button", () => {
    expect(
      mount(`<button>Save <a href="/help">Help</a></button>`),
    ).not.toBeValidA11yTree();
  });
});
