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

/**
 * The violation messages, not just "did it fail".
 *
 * `.not.toBeValidA11yTree()` passes on ANY error, so a fixture that also emits
 * an unrelated one cannot tell the nesting rule from a missing name — mutation
 * testing showed this file surviving the nesting rule being deleted, widened,
 * and losing its `implicitRole` guard, all while staying green.
 */
function violations(root: Element): string[] {
  try {
    expect(root).toBeValidA11yTree();
    return [];
  } catch (error) {
    return (error as Error).message
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("✖"))
      .map((l) => l.replace(/^✖\s*/, ""));
  }
}

describe("native HTML is valid without author-supplied ARIA", () => {
  it("a table named by its caption", () => {
    expect(
      mount(
        `<table><caption>Q3 results</caption><tbody><tr><td>NW-1</td></tr></tbody></table>`,
      ),
    ).toBeValidA11yTree();
  });

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

  it("an <input type=range>", () => {
    expect(
      mount(`<label>Volume <input type="range" min="0" max="10"></label>`),
    ).toBeValidA11yTree();
  });

  it("a REDUNDANT authored role does not bring the wall back", () => {
    // Design systems spread `role` through props, so this shape is common and
    // nothing about the user agent changed. Keying on the attribute reported
    // three violations here while the identical markup without it passed.
    expect(
      mount(
        `<label>S <select role="combobox"><option>A</option></select></label>`,
      ),
    ).toBeValidA11yTree();
    expect(
      mount(`<label><input type="checkbox" role="checkbox"> W</label>`),
    ).toBeValidA11yTree();
  });

  it("role=switch on a native checkbox — the case with no remedy", () => {
    // ARIA-APG's canonical switch. The role is authored and NOT redundant, so
    // it cannot be deleted, and the browser still supplies checkedness.
    expect(
      mount(`<label><input type="checkbox" role="switch"> Weekends</label>`),
    ).toBeValidA11yTree();
    expect(
      mount(
        `<label><input type="checkbox" role="switch" checked> Weekends</label>`,
      ),
    ).toBeValidA11yTree();
  });

  it("a realistic form — the shape that produced the original wall", () => {
    expect(
      mount(`
        <label>Status <select><option>All</option><option>Open</option></select></label>
        <label><input type="checkbox"> Only unassigned</label>
      `),
    ).toBeValidA11yTree();
  });
});

describe("an authored role can actually be satisfied", () => {
  // Required props were read only from `a11y.states`/`properties`, a fixed set
  // that can never contain aria-controls or aria-valuenow — so correct
  // authored markup could not go green no matter what the author wrote.
  it("a fully-specified authored combobox passes", () => {
    expect(
      mount(
        `<div role="combobox" aria-label="Status" aria-expanded="false" aria-controls="lb"></div><ul id="lb" role="listbox" aria-label="Options"></ul>`,
      ),
    ).toBeValidA11yTree();
  });

  it("a fully-specified authored slider passes", () => {
    expect(
      mount(
        `<div role="slider" aria-label="Vol" aria-valuenow="3" aria-valuemin="0" aria-valuemax="10" tabindex="0"></div>`,
      ),
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
    // Named, not just "some error" — the fixture also emits a real
    // `aria-selected` violation, so `.not` alone proves nothing about nesting.
    expect(violations(root)).toContain(
      'option "A" — interactive "option" is nested inside "combobox" — nested controls aren\'t operable by assistive tech',
    );
  });
});

describe("the nesting rule and its exemption, asserted by message", () => {
  it("a native <select><option> emits NO nesting violation", () => {
    const root = mount(
      `<label>Status <select><option>Open</option></select></label>`,
    );
    expect(violations(root).filter((v) => v.includes("nested inside"))).toEqual(
      [],
    );
  });

  it("a link inside a button emits one, by name", () => {
    const root = mount(`<button>Save <a href="/help">Help</a></button>`);
    expect(violations(root)).toContain(
      'link "Help" — interactive "link" is nested inside "button" — nested controls aren\'t operable by assistive tech',
    );
  });

  it("an exempt pair does not hide a real ancestor violation", () => {
    // The `break`-vs-`continue` case: the option is legitimately inside its
    // select and illegitimately inside the button wrapping it.
    const root = mount(
      `<div role="button" tabindex="0" aria-label="Wrap"><label>Status <select><option>Open</option></select></label></div>`,
    );
    expect(violations(root)).toContain(
      'option "Open" — interactive "option" is nested inside "button" — nested controls aren\'t operable by assistive tech',
    );
  });
});

describe("engine vocabulary is not reported as invalid ARIA", () => {
  it("a <video controls> page can use the matcher at all", () => {
    // `video` is not an ARIA role. Reporting it returned early, so no other
    // rule ran on the node — a page with a <video> was unusable.
    expect(
      mount(`<video controls src="x.mp4" aria-label="Clip"></video>`),
    ).toBeValidA11yTree();
  });

  it("an authored bogus role is still reported", () => {
    // Each line is `role "name" — message`, so match the message within it.
    expect(
      violations(mount(`<div role="combobocks">x</div>`)).join("\n"),
    ).toContain('"combobocks" is not a valid ARIA role');
  });
});

describe("real problems are still caught in native markup", () => {
  it("an unnamed native select", () => {
    expect(
      mount(`<select><option>Open</option></select>`),
    ).not.toBeValidA11yTree();
  });

  it("an unnamed table", () => {
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
