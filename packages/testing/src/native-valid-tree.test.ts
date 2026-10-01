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

  it("a <select> showing more than one row — a listbox", () => {
    expect(
      mount(
        `<label>Status <select size="3"><option>Open</option><option>Done</option></select></label>`,
      ),
    ).toBeValidA11yTree();
  });

  it("a <select multiple size=1> — the drop-down HTML allows for it", () => {
    expect(
      mount(
        `<label>Tags <select multiple size="1"><option>Bug</option><option>UI</option></select></label>`,
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

  it("an input whose list names a <datalist> — the browser's own combobox", () => {
    expect(
      mount(
        `<label>Fruit <input list="fruits"></label><datalist id="fruits"><option value="Apple"></datalist>`,
      ),
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
    expect(
      mount(
        `<label>F <input list="fruits" role="combobox"></label><datalist id="fruits"></datalist>`,
      ),
    ).toBeValidA11yTree();
  });

  it("a redundant role follows a select's size, not only its tag", () => {
    expect(
      mount(
        `<label>S <select size="3" role="listbox"><option>A</option></select></label>`,
      ),
    ).toBeValidA11yTree();
    expect(
      mount(
        `<label>S <select multiple size="1" role="combobox"><option>A</option></select></label>`,
      ),
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

  it.each([
    ["no list", `<input role="combobox" aria-label="Fruit">`],
    [
      "a list naming no datalist",
      `<input role="combobox" aria-label="Fruit" list="nope">`,
    ],
  ])("role=combobox on an input with %s owes its popup's ARIA", (_l, html) => {
    // No datalist, so no browser popup: the author built one, and its state
    // and relationship are theirs to expose.
    expect(violations(mount(html))).toEqual([
      'combobox "Fruit" — missing required aria-controls',
      'combobox "Fruit" — missing required aria-expanded',
    ]);
  });

  it("role=checkbox without aria-checked is reported", () => {
    const root = mount(
      `<div role="checkbox" tabindex="0" aria-label="Weekends"></div>`,
    );
    expect(root).not.toBeValidA11yTree();
  });

  it("an authored combobox owning an authored option is still a nesting error", () => {
    // The option sits in a listbox, the context Chromium requires before it
    // exposes an option at all; the nesting rule climbs past the listbox to
    // the combobox, and only a NATIVE pair is exempt.
    const root = mount(
      `<div role="combobox" aria-label="S" aria-expanded="false" aria-controls="x"><div role="listbox"><div role="option">A</div></div></div>`,
    );
    // Named, not just "some error" — the fixture also emits a real
    // `aria-selected` violation, so `.not` alone proves nothing about nesting.
    expect(violations(root)).toContain(
      'option "A" — interactive "option" is nested inside "combobox" — nested controls aren\'t operable by assistive tech',
    );
  });

  it.each([
    ["size", `size="3"`],
    ["multiple", "multiple"],
  ])(
    "role=combobox on a list-box select (%s) is authored, not redundant",
    (_label, attrs) => {
      // More than one row shows, so the select is a listbox and the author
      // changed its role. Chromium exposes the combobox, whose options are
      // nested controls.
      const root = mount(
        `<label>S <select ${attrs} role="combobox"><option>A</option></select></label>`,
      );
      expect(violations(root)).toContain(
        'option "A" — interactive "option" is nested inside "combobox" — nested controls aren\'t operable by assistive tech',
      );
    },
  );

  it("an authored option directly in a combobox is no option at all", () => {
    // Chromium discards the role outside a listbox or group, so there is no
    // nested control to report — the discarded role is the error.
    const root = mount(
      `<div role="combobox" aria-label="S" aria-expanded="false" aria-controls="x"><div role="option">A</div></div>`,
    );
    expect(violations(root)).toEqual([
      'generic "A" — role "option" is discarded outside its required context',
    ]);
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

// ARIA 1.3's `image` is a synonym of `img`. The schema predates it, so an
// authored `role="image"` used to be reported as invalid ARIA — and named by
// its own text, which Chromium never does.
describe("the img synonym role=image", () => {
  it("is valid ARIA once named", () => {
    expect(
      mount(`<span role="image" aria-label="Party">🎉</span>`),
    ).toBeValidA11yTree();
  });

  it("is checked as the img it is, not as an unknown role", () => {
    expect(violations(mount(`<span role="image">🎉</span>`))).toEqual([
      'img — role "img" requires an accessible name',
    ]);
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

// The DOM producer resolves `role` the way Chromium does: an unknown token is
// skipped, and a listitem, option or treeitem outside its required context is
// dropped for the next token or the element's own role. The tree is right to
// show the fallback — it is what assistive tech gets — but the role the author
// wrote is still a mistake, and the matcher must still say so. Several of
// these fold out of the a11y view entirely, as the generic they now are.
describe("a role the browser discards is still reported", () => {
  it("an unknown token that leaves a plain generic", () => {
    expect(violations(mount(`<div role="foo">x</div>`))).toEqual([
      'generic "x" — "foo" is not a valid ARIA role',
    ]);
    expect(violations(mount(`<div role="widget">x</div>`))).toEqual([
      'generic "x" — "widget" is not a valid ARIA role',
    ]);
  });

  it("an unknown token the browser skipped for the next one", () => {
    expect(
      violations(mount(`<div role="foo button" tabindex="0">Save</div>`)),
    ).toEqual(['button "Save" — "foo" is not a valid ARIA role']);
  });

  it("a listitem outside any list", () => {
    expect(violations(mount(`<div role="listitem">Item</div>`))).toEqual([
      'generic "Item" — role "listitem" is discarded outside its required context (directory / list)',
    ]);
  });

  it("an option with something between it and its listbox", () => {
    expect(
      violations(
        mount(
          `<div role="listbox" aria-label="Fruit"><section><div role="option" aria-selected="false">Apple</div></section></div>`,
        ),
      ),
    ).toEqual([
      'generic "Apple" — role "option" is discarded outside its required context',
    ]);
  });

  it("a treeitem that fell back to the element's own role", () => {
    expect(
      violations(
        mount(
          `<details role="treeitem" open><summary>Docs</summary>x</details>`,
        ),
      ).join("\n"),
    ).toContain(
      'role "treeitem" is discarded outside its required context (group / tree)',
    );
  });

  it("but not a role the browser keeps", () => {
    expect(
      mount(
        `<div role="list"><div role="listitem">x</div></div>` +
          `<div role="listbox" aria-label="Fruit"><div role="option" aria-selected="false">Apple</div></div>` +
          `<div role="BUTTON" tabindex="0">Save</div>`,
      ),
    ).toBeValidA11yTree();
  });

  // `<ul role="none">` makes its items presentational too, which is what its
  // author meant — there is no list item left to be out of context.
  it("nor the items of a list stripped with role=none", () => {
    expect(
      mount(`<ul role="none"><li><a href="/">Home</a></li></ul>`),
    ).toBeValidA11yTree();
  });

  it("nor anything assistive tech can't reach", () => {
    expect(
      mount(`<div aria-hidden="true"><div role="foo">x</div></div>`),
    ).toBeValidA11yTree();
  });
});
