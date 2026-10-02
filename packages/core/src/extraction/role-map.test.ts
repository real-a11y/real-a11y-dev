import { afterEach, describe, it, expect } from "vitest";

import { clobber, shadow } from "../test-support/clobber.js";

import {
  getExplicitRole,
  getImplicitRole,
  isHiddenFromAT,
  isSubtreeHidden,
  getHeadingLevel,
} from "./role-map.js";

function el(html: string): Element {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.firstElementChild!;
}

/** The role of `#t` inside `html`, parsed into a detached container. */
function roleOf(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return getImplicitRole(div.querySelector("#t")!);
}

/** The same, with `html` in the document — for `aria-owns`, which needs ids. */
function roleInDocument(html: string): string {
  document.body.innerHTML = html;
  try {
    return getImplicitRole(document.getElementById("t")!);
  } finally {
    document.body.innerHTML = "";
  }
}

describe("getImplicitRole", () => {
  it("returns link for <a> with href", () => {
    expect(getImplicitRole(el('<a href="/about">About</a>'))).toBe("link");
  });

  it("returns generic for <a> without href", () => {
    expect(getImplicitRole(el("<a>Not a link</a>"))).toBe("generic");
  });

  it("returns button for <button>", () => {
    expect(getImplicitRole(el("<button>Click</button>"))).toBe("button");
  });

  it("returns navigation for <nav>", () => {
    expect(getImplicitRole(el("<nav>Nav</nav>"))).toBe("navigation");
  });

  it("returns main for <main>", () => {
    expect(getImplicitRole(el("<main>Content</main>"))).toBe("main");
  });

  it("returns heading for h1-h6", () => {
    expect(getImplicitRole(el("<h1>Title</h1>"))).toBe("heading");
    expect(getImplicitRole(el("<h2>Subtitle</h2>"))).toBe("heading");
    expect(getImplicitRole(el("<h3>Section</h3>"))).toBe("heading");
  });

  it("returns list for <ul> and <ol>", () => {
    expect(getImplicitRole(el("<ul><li>A</li></ul>"))).toBe("list");
    expect(getImplicitRole(el("<ol><li>A</li></ol>"))).toBe("list");
  });

  it("returns listitem for <li>", () => {
    expect(getImplicitRole(el("<li>Item</li>"))).toBe("listitem");
  });

  it("returns textbox for <input type=text>", () => {
    expect(getImplicitRole(el('<input type="text">'))).toBe("textbox");
  });

  it("returns checkbox for <input type=checkbox>", () => {
    expect(getImplicitRole(el('<input type="checkbox">'))).toBe("checkbox");
  });

  it("returns radio for <input type=radio>", () => {
    expect(getImplicitRole(el('<input type="radio">'))).toBe("radio");
  });

  it("returns button for <input type=submit>", () => {
    expect(getImplicitRole(el('<input type="submit">'))).toBe("button");
  });

  it("returns textbox for <textarea>", () => {
    expect(getImplicitRole(el("<textarea></textarea>"))).toBe("textbox");
  });

  it("returns table for <table>", () => {
    expect(getImplicitRole(el("<table></table>"))).toBe("table");
  });

  it("returns form for <form>", () => {
    expect(getImplicitRole(el("<form></form>"))).toBe("form");
  });

  it("returns img for <img> with alt", () => {
    expect(getImplicitRole(el('<img alt="photo">'))).toBe("img");
  });

  it("returns presentation for <img> with empty alt", () => {
    expect(getImplicitRole(el('<img alt="">'))).toBe("presentation");
  });

  it("returns presentation for explicit role=presentation", () => {
    expect(getImplicitRole(el('<div role="presentation">Decor</div>'))).toBe(
      "presentation",
    );
  });

  it("returns presentation for explicit role=none (synonym)", () => {
    expect(getImplicitRole(el('<span role="none">Decor</span>'))).toBe(
      "presentation",
    );
  });

  // ARIA 1.3 adds `image` as a synonym of `img`, and Chromium exposes both as
  // the same role. Everything downstream — the image-alt rule, role queries,
  // the native producer — speaks `img`, so the synonym is folded here.
  it("returns img for explicit role=image (synonym)", () => {
    expect(getImplicitRole(el('<span role="image">🎉</span>'))).toBe("img");
  });

  // Not a role, so not resolved — and the lookup must not find
  // `Object.prototype`'s member under that name either.
  it("does not resolve a token named like an Object.prototype member", () => {
    for (const token of ["constructor", "toString", "__proto__"]) {
      expect(getImplicitRole(el(`<div role="${token}">x</div>`))).toBe(
        "generic",
      );
    }
  });

  it("folds role=image when it leads a role list", () => {
    expect(
      getImplicitRole(el('<div role="image graphics-symbol">x</div>')),
    ).toBe("img");
  });

  // ARIA "Presentational Roles Conflict Resolution": role=presentation/none
  // is IGNORED when the element is focusable or carries global ARIA
  // states/properties. The element is then exposed with its implicit role —
  // not kept as a "presentation" node, which is what a consumer reading
  // `role` would otherwise see for a perfectly ordinary link.
  describe("presentational roles conflict resolution", () => {
    it("ignores role=presentation on a focusable element", () => {
      expect(
        getImplicitRole(el('<a href="/about" role="presentation">A</a>')),
      ).toBe("link");
    });

    it("ignores role=none on a focusable element", () => {
      expect(getImplicitRole(el('<button role="none">Go</button>'))).toBe(
        "button",
      );
    });

    it("ignores role=presentation on an element made focusable by tabindex", () => {
      expect(
        getImplicitRole(el('<h2 role="presentation" tabindex="0">T</h2>')),
      ).toBe("heading");
    });

    it("ignores role=presentation when a global ARIA attribute is present", () => {
      expect(
        getImplicitRole(el('<h2 role="presentation" aria-label="x">T</h2>')),
      ).toBe("heading");
    });

    it("ignores role=presentation when aria-live is present", () => {
      expect(
        getImplicitRole(el('<div role="none" aria-live="polite">S</div>')),
      ).toBe("generic");
    });

    // aria-hidden is global but removes the element from the tree entirely,
    // so it must not be the thing that resurrects a presentational role.
    it("does not let aria-hidden void presentation", () => {
      expect(
        getImplicitRole(
          el('<div role="presentation" aria-hidden="true">D</div>'),
        ),
      ).toBe("presentation");
    });

    it("still returns presentation for a plain decorative element", () => {
      expect(getImplicitRole(el("<div role='presentation'>Decor</div>"))).toBe(
        "presentation",
      );
    });

    // HTML-AAM: alt="" is only presentational absent any other naming.
    it("returns img for <img alt=''> with aria-label", () => {
      expect(getImplicitRole(el('<img alt="" aria-label="Photo">'))).toBe(
        "img",
      );
    });

    it("returns img for <img alt=''> with a title", () => {
      expect(getImplicitRole(el('<img alt="" title="Photo">'))).toBe("img");
    });

    it("still returns presentation for a bare <img alt=''>", () => {
      expect(getImplicitRole(el('<img alt="" src="/d.png">'))).toBe(
        "presentation",
      );
    });

    // A non-naming global would expose a permanently nameless <img>, which
    // every "image has no accessible name" audit would then flag for markup
    // that is correctly marked decorative.
    it("does not expose <img alt=''> for a non-naming global ARIA property", () => {
      expect(getImplicitRole(el('<img alt="" aria-describedby="hint">'))).toBe(
        "presentation",
      );
    });

    // Blank values state nothing, so they must not resurrect a role.
    it("ignores a blank title on <img alt=''>", () => {
      expect(getImplicitRole(el('<img alt="" title="   ">'))).toBe(
        "presentation",
      );
    });

    it("ignores a blank aria-label", () => {
      expect(getImplicitRole(el('<img alt="" aria-label="">'))).toBe(
        "presentation",
      );
      expect(
        getImplicitRole(el('<h2 role="presentation" aria-label="">T</h2>')),
      ).toBe("presentation");
    });

    // Focusability here is stricter than the interaction.isFocusable facet:
    // these elements are NOT tab stops, so the decorative role stands.
    it("does not treat <a> without href as focusable", () => {
      expect(getImplicitRole(el('<a role="presentation">Decorative</a>'))).toBe(
        "presentation",
      );
    });

    it("does not treat a disabled control as focusable", () => {
      expect(
        getImplicitRole(el('<button role="none" disabled>Go</button>')),
      ).toBe("presentation");
    });

    it("does not treat <input type=hidden> as focusable", () => {
      expect(
        getImplicitRole(el('<input type="hidden" role="presentation">')),
      ).toBe("presentation");
    });

    it("treats a negative tabindex as focusable", () => {
      expect(
        getImplicitRole(el('<h2 role="presentation" tabindex="-1">T</h2>')),
      ).toBe("heading");
    });

    it("ignores a non-numeric tabindex", () => {
      expect(
        getImplicitRole(el('<div role="presentation" tabindex="yes">D</div>')),
      ).toBe("presentation");
    });

    // HTML's integer parse, which Chromium applies: leading ASCII whitespace
    // and trailing junk are allowed, so "1abc" is 1 and a real tab stop.
    it("reads tabindex the way HTML parses an integer", () => {
      expect(
        getImplicitRole(el('<h2 role="presentation" tabindex="1abc">T</h2>')),
      ).toBe("heading");
      expect(
        getImplicitRole(el('<h2 role="presentation" tabindex=" 0">T</h2>')),
      ).toBe("heading");
      expect(
        getImplicitRole(
          el('<h2 role="presentation" tabindex="&#160;0">T</h2>'),
        ),
      ).toBe("presentation");
    });

    it("does not treat a control in a disabled fieldset as focusable", () => {
      const fieldset = el(
        "<fieldset disabled>" +
          '<legend><button role="none">Unlock</button></legend>' +
          '<button role="none">Save</button>' +
          "</fieldset>",
      );
      const [inLegend, inFieldset] = fieldset.querySelectorAll("button");
      // The first legend is exempt, so its button stays focusable.
      expect(getImplicitRole(inLegend)).toBe("button");
      expect(getImplicitRole(inFieldset)).toBe("presentation");
    });

    // Checked over CDP in Chromium 151: a details' summary is focusable, so
    // it ignores role="none"; a summary outside any details is not.
    it("keeps a details' summary despite role=none, but not a stray one", () => {
      const details = el(
        '<details><summary role="none">Shipping</summary>' +
          '<summary role="none">Second</summary></details>',
      );
      const [summary, second] = details.querySelectorAll("summary");
      expect(getImplicitRole(summary)).toBe("generic");
      expect(getImplicitRole(second)).toBe("presentation");
      expect(getImplicitRole(el('<summary role="none">Stray</summary>'))).toBe(
        "presentation",
      );
    });

    // A tabindex does NOT put a disabled control or a hidden input into the
    // focus order, so the exclusions have to be checked before tabindex is.
    it("keeps a disabled control presentational despite a tabindex", () => {
      expect(
        getImplicitRole(
          el('<button role="none" disabled tabindex="0">S</button>'),
        ),
      ).toBe("presentation");
      expect(
        getImplicitRole(
          el('<textarea role="none" disabled tabindex="-1"></textarea>'),
        ),
      ).toBe("presentation");
    });

    it("keeps <input type=hidden> presentational despite a tabindex", () => {
      expect(
        getImplicitRole(
          el('<input type="hidden" role="presentation" tabindex="0">'),
        ),
      ).toBe("presentation");
    });

    // contenteditable hosts are focusable with no tabindex at all.
    it("treats a contenteditable host as focusable", () => {
      expect(
        getImplicitRole(el('<div role="presentation" contenteditable>D</div>')),
      ).toBe("generic");
      expect(
        getImplicitRole(el('<h2 role="none" contenteditable="true">T</h2>')),
      ).toBe("heading");
    });

    it("does not treat contenteditable=false as focusable", () => {
      expect(
        getImplicitRole(
          el('<div role="presentation" contenteditable="false">D</div>'),
        ),
      ).toBe("presentation");
    });

    it("treats a plaintext-only or upper-case host as focusable", () => {
      expect(
        getImplicitRole(
          el('<h2 role="none" contenteditable="plaintext-only">T</h2>'),
        ),
      ).toBe("heading");
      expect(
        getImplicitRole(el('<h2 role="none" contenteditable="TRUE">T</h2>')),
      ).toBe("heading");
    });

    it("does not treat an invalid contenteditable value as a host", () => {
      expect(
        getImplicitRole(el('<h2 role="none" contenteditable="bogus">T</h2>')),
      ).toBe("presentation");
    });

    // Only the root of an editable region is focusable. A contenteditable
    // nested inside one, and a link inside one, are not tab stops in Chromium,
    // so their decorative role stands.
    it("does not treat a contenteditable nested in a host as focusable", () => {
      const nested = el(
        '<div contenteditable="true"><h2 role="none" contenteditable="true">T</h2></div>',
      ).firstElementChild!;
      expect(getImplicitRole(nested)).toBe("presentation");
    });

    it("does not treat a link inside an editor as focusable, except in an island", () => {
      const host = el(
        '<div contenteditable="true">' +
          '<a role="none" href="/in">In</a>' +
          '<a role="none" href="/island" contenteditable="false">Island</a>' +
          "</div>",
      );
      const [inside, island] = Array.from(host.children);
      expect(getImplicitRole(inside)).toBe("presentation");
      expect(getImplicitRole(island)).toBe("link");
    });

    // ARIA 1.2 promoted these four to global; they void presentation too.
    it("voids presentation for aria-disabled / aria-invalid / aria-errormessage / aria-haspopup", () => {
      expect(
        getImplicitRole(el('<h2 role="none" aria-invalid="true">P</h2>')),
      ).toBe("heading");
      expect(
        getImplicitRole(el('<h2 role="none" aria-disabled="true">P</h2>')),
      ).toBe("heading");
      expect(
        getImplicitRole(el('<h2 role="none" aria-errormessage="e">P</h2>')),
      ).toBe("heading");
      expect(
        getImplicitRole(el('<h2 role="none" aria-haspopup="menu">P</h2>')),
      ).toBe("heading");
    });
  });

  it("returns generic for <div>", () => {
    expect(getImplicitRole(el("<div>Content</div>"))).toBe("generic");
  });

  describe("<header>/<footer>", () => {
    it("maps to banner/contentinfo when scoped to body", () => {
      expect(getImplicitRole(el("<header>Site</header>"))).toBe("banner");
      expect(getImplicitRole(el("<footer>Site</footer>"))).toBe("contentinfo");
    });

    it.each(["main", "article", "aside", "nav", "section"])(
      "maps to sectionheader/sectionfooter inside <%s>",
      (container) => {
        const root = el(
          `<${container}><div><header>H</header><footer>F</footer></div></${container}>`,
        );
        expect(getImplicitRole(root.querySelector("header")!)).toBe(
          "sectionheader",
        );
        expect(getImplicitRole(root.querySelector("footer")!)).toBe(
          "sectionfooter",
        );
      },
    );
  });

  describe("<th>", () => {
    function th(tableHtml: string, selector = "th"): Element {
      return el(tableHtml).querySelector(selector)!;
    }

    it("returns columnheader for scope=col", () => {
      expect(
        getImplicitRole(
          th('<table><tr><th scope="col">Name</th></tr></table>'),
        ),
      ).toBe("columnheader");
    });

    it("returns columnheader for scope=colgroup", () => {
      expect(
        getImplicitRole(
          th('<table><tr><th scope="colgroup">Name</th></tr></table>'),
        ),
      ).toBe("columnheader");
    });

    it("returns rowheader for scope=row", () => {
      expect(
        getImplicitRole(
          th('<table><tr><th scope="row">Name</th></tr></table>'),
        ),
      ).toBe("rowheader");
    });

    it("returns rowheader for scope=rowgroup", () => {
      expect(
        getImplicitRole(
          th('<table><tr><th scope="rowgroup">Name</th></tr></table>'),
        ),
      ).toBe("rowheader");
    });

    it("returns columnheader for an unscoped <th> in <thead>", () => {
      expect(
        getImplicitRole(
          th(
            "<table><thead><tr><th>Name</th></tr></thead>" +
              "<tbody><tr><td>Ada</td></tr></tbody></table>",
          ),
        ),
      ).toBe("columnheader");
    });

    it("returns columnheader for an unscoped <th> in the table's first row", () => {
      expect(
        getImplicitRole(
          th(
            "<table><tr><th>Name</th></tr><tr><td>Ada</td></tr></table>",
            "tr:first-child th",
          ),
        ),
      ).toBe("columnheader");
    });

    it("returns rowheader for an unscoped <th> leading a body row", () => {
      expect(
        getImplicitRole(
          th(
            "<table><thead><tr><th>Name</th></tr></thead>" +
              "<tbody><tr><th>Ada</th><td>1815</td></tr></tbody></table>",
            "tbody th",
          ),
        ),
      ).toBe("rowheader");
    });

    it("returns rowheader for an unscoped <th> in a later row of a headless table", () => {
      expect(
        getImplicitRole(
          th(
            "<table><tr><th>Name</th><th>Born</th></tr>" +
              "<tr><th>Ada</th><td>1815</td></tr></table>",
            "tr:nth-child(2) th",
          ),
        ),
      ).toBe("rowheader");
    });
  });

  // Each row measured against Chromium 151 and 153's own tree. A `list` that
  // names a <datalist> in the input's own tree makes a text-entry input a
  // combobox: HTML-AAM names text, search, email, tel and url, and Chromium
  // does the same for a number and the date and time types.
  describe("<input list>", () => {
    const DATALIST = `<datalist id="dl"><option value="a"></datalist>`;

    function input(html: string): Element {
      document.body.innerHTML = `${DATALIST}${html}<div id="adiv">x</div>`;
      return document.body.querySelector("input")!;
    }

    afterEach(() => {
      document.body.innerHTML = "";
    });

    it.each([
      'type="text"',
      'type="search"',
      'type="email"',
      'type="tel"',
      'type="url"',
      'type="number"',
      'type="date"',
      'type="datetime-local"',
      'type="month"',
      'type="week"',
      'type="time"',
      // An unknown type, in any case, is a text input.
      'type="bogus"',
      'type="TEXT"',
    ])("<input %s list> is a combobox", (type) => {
      expect(getImplicitRole(input(`<input ${type} list="dl">`))).toBe(
        "combobox",
      );
    });

    // `list` doesn't apply to most of these, and a range or color input uses
    // its suggestions inside its own widget.
    it.each([
      "password",
      "range",
      "color",
      "checkbox",
      "radio",
      "button",
      "submit",
      "reset",
      "image",
      "file",
      "hidden",
    ])("<input type=%s list> keeps its own role", (type) => {
      const without = getImplicitRole(input(`<input type="${type}">`));
      expect(getImplicitRole(input(`<input type="${type}" list="dl">`))).toBe(
        without,
      );
    });

    it.each([
      ["a missing id", `list="nope"`],
      ["an element that isn't a datalist", `list="adiv"`],
      ["nothing", `list=""`],
      ["the id in another case", `list="DL"`],
    ])("stays a textbox when the list names %s", (_label, list) => {
      expect(getImplicitRole(input(`<input ${list}>`))).toBe("textbox");
    });

    it("keeps a search input a searchbox when its list names nothing", () => {
      expect(getImplicitRole(input(`<input type="search" list="nope">`))).toBe(
        "searchbox",
      );
    });

    it("counts a datalist with no options, a hidden one, or one after the input", () => {
      document.body.innerHTML = `
        <input aria-label="empty" list="empty"><datalist id="empty"></datalist>
        <input aria-label="hidden" list="hid"><datalist id="hid" hidden><option value="a"></datalist>
        <input aria-label="after" list="later">
        <p>text</p>
        <datalist id="later"><option value="a"></datalist>`;
      for (const field of document.body.querySelectorAll("input")) {
        expect(getImplicitRole(field)).toBe("combobox");
      }
    });

    it("keeps an authored role over its list", () => {
      expect(getImplicitRole(input(`<input list="dl" role="textbox">`))).toBe(
        "textbox",
      );
      expect(
        getImplicitRole(
          input(`<input type="search" list="dl" role="searchbox">`),
        ),
      ).toBe("searchbox");
    });

    it("resolves the list in the input's own tree, not across a shadow boundary", () => {
      document.body.innerHTML = `${DATALIST}<div id="host"></div>`;
      const shadow = document
        .getElementById("host")!
        .attachShadow({ mode: "open" });
      shadow.innerHTML = `<input id="outer" list="dl"><input id="inner" list="own"><datalist id="own"><option value="b"></datalist>`;

      expect(getImplicitRole(shadow.getElementById("outer")!)).toBe("textbox");
      expect(getImplicitRole(shadow.getElementById("inner")!)).toBe("combobox");
    });

    it("stays a textbox, without throwing, outside any document", () => {
      // Chromium finds no datalist for a detached input; jsdom throws instead.
      expect(
        getImplicitRole(
          el(`<div><input list="dl">${DATALIST}</div>`).firstElementChild!,
        ),
      ).toBe("textbox");
    });
  });

  // Each row measured against Chromium 151 and 153's own tree. A select is a
  // list box when it shows more than one row: its `size`, parsed the way HTML
  // parses a non-negative integer, or 4 rows for a `multiple` select without
  // one. `multiple size="1"` is the drop-down HTML allows for it.
  describe("<select>", () => {
    const SIZES: [attrs: string, role: string][] = [
      ["", "combobox"],
      ['size="1"', "combobox"],
      ['size="0"', "combobox"],
      ['size="-0"', "combobox"],
      ['size="-1"', "combobox"],
      ['size="abc"', "combobox"],
      ['size=""', "combobox"],
      ['size="1.9"', "combobox"],
      ['size="&#160;3"', "combobox"],
      ['size="4294967296"', "combobox"],
      ['size="99999999999"', "combobox"],
      ['size="2"', "listbox"],
      ['size="3"', "listbox"],
      ['size=" 3"', "listbox"],
      ['size="&#9;3"', "listbox"],
      ['size="+3"', "listbox"],
      ['size="3.5"', "listbox"],
      ['size="2abc"', "listbox"],
      // The `size` property reads 0 here; Chromium still counts the rows.
      ['size="2147483648"', "listbox"],
      ['size="4294967295"', "listbox"],
      ["multiple", "listbox"],
      ['multiple size="0"', "listbox"],
      ['multiple size="abc"', "listbox"],
      ['multiple size="2"', "listbox"],
      ['multiple size="1"', "combobox"],
      ['multiple size="1.5"', "combobox"],
    ];

    it.each(SIZES)("<select %s> is a %s", (attrs, role) => {
      expect(
        getImplicitRole(el(`<select ${attrs}><option>o</option></select>`)),
      ).toBe(role);
    });

    it("keeps an authored role over its size", () => {
      expect(
        getImplicitRole(
          el('<select size="3" role="combobox"><option>o</option></select>'),
        ),
      ).toBe("combobox");
      expect(
        getImplicitRole(
          el(
            '<select multiple size="1" role="listbox"><option>o</option></select>',
          ),
        ),
      ).toBe("listbox");
    });
  });

  it("returns generic for <span>", () => {
    expect(getImplicitRole(el("<span>Text</span>"))).toBe("generic");
  });

  it("returns region for <section> with accessible name", () => {
    expect(
      getImplicitRole(el('<section aria-label="Main content"></section>')),
    ).toBe("region");
  });

  it("returns generic for <section> without accessible name", () => {
    expect(getImplicitRole(el("<section></section>"))).toBe("generic");
  });

  it("uses explicit role attribute when present", () => {
    expect(getImplicitRole(el('<div role="alert">Warning</div>'))).toBe(
      "alert",
    );
  });

  it("returns article for <article>", () => {
    expect(getImplicitRole(el("<article>Post</article>"))).toBe("article");
  });

  it("returns complementary for <aside>", () => {
    expect(getImplicitRole(el("<aside>Sidebar</aside>"))).toBe("complementary");
  });

  it("returns dialog for <dialog>", () => {
    expect(getImplicitRole(el("<dialog>Modal</dialog>"))).toBe("dialog");
  });

  it("returns separator for <hr>", () => {
    expect(getImplicitRole(el("<hr>"))).toBe("separator");
  });

  it("returns figure for <figure>", () => {
    expect(getImplicitRole(el("<figure>Chart</figure>"))).toBe("figure");
  });

  it("returns search for <search>", () => {
    expect(getImplicitRole(el("<search>Form</search>"))).toBe("search");
  });

  // ARIA has no media roles, but Chromium's native accessibility tree
  // exposes internal Video/Audio roles (what DevTools shows). Mirroring
  // that beats "generic", which made a captioned player indistinguishable
  // from a <div>.
  it("returns video for <video> and audio for <audio>", () => {
    expect(getImplicitRole(el("<video></video>"))).toBe("video");
    expect(getImplicitRole(el("<video controls></video>"))).toBe("video");
    expect(getImplicitRole(el("<audio></audio>"))).toBe("audio");
  });

  it("explicit role still wins on media elements", () => {
    expect(getImplicitRole(el('<video role="application"></video>'))).toBe(
      "application",
    );
  });

  // `<form>` has [LegacyOverrideBuiltIns]: `<input name="tagName">` makes
  // `form.tagName` that input. A role read on the form, or one that climbs to
  // it, must still answer rather than throw — the live extractor asks it of
  // every ancestor of a change, with nothing to catch the throw.
  describe("with a form whose control shadows tagName", () => {
    function shadowedForm(): HTMLFormElement {
      const form = el(`<form><input name="tagName"></form>`) as HTMLFormElement;
      shadow(form, "tagName");
      return form;
    }

    it("resolves the form's own role", () => {
      const form = shadowedForm();
      expect(getImplicitRole(form)).toBe("form");
      expect(isHiddenFromAT(form)).toBe(false);
    });

    // The parser never puts a <th> or a <tr> straight into a form; a script
    // can, and the header algorithm reads the cell's row and the row's parent.
    it("resolves a header cell whose row, or whose row's parent, is the form", () => {
      const form = shadowedForm();
      const looseCell = document.createElement("th");
      form.append(looseCell);
      expect(getImplicitRole(looseCell)).toBe("rowheader");

      const row = document.createElement("tr");
      const cell = document.createElement("th");
      row.append(cell);
      form.append(row);
      expect(getImplicitRole(cell)).toBe("rowheader");
    });

    it("resolves a header inside the form as a banner", () => {
      const form = shadowedForm();
      const header = document.createElement("header");
      form.append(header);
      expect(getImplicitRole(header)).toBe("banner");
    });
  });
});

// Chromium resolves `role` to the first token it RECOGNISES, not the first
// token. Every expectation in the next three blocks was measured over CDP
// (`Accessibility.getFullAXTree`) in Chromium 151 and 153, which agree.
describe("role tokens Chromium does not recognise", () => {
  it("falls back to the element's own role for an unknown token", () => {
    expect(getImplicitRole(el('<div role="foo">x</div>'))).toBe("generic");
    expect(getImplicitRole(el('<div role="foo bar">x</div>'))).toBe("generic");
    expect(getImplicitRole(el('<button role="foo">Go</button>'))).toBe(
      "button",
    );
    expect(getImplicitRole(el('<a href="/" role="foo">Home</a>'))).toBe("link");
    expect(getImplicitRole(el('<input role="foo">'))).toBe("textbox");
    expect(getImplicitRole(el('<h2 role="widget">T</h2>'))).toBe("heading");
    expect(roleOf('<ul><li id="t" role="foo">A</li></ul>')).toBe("listitem");
  });

  // Abstract roles organise the ARIA taxonomy; an author can't use one, and
  // Chromium skips them like any unknown token.
  it("skips every abstract role", () => {
    for (const role of [
      "command",
      "composite",
      "input",
      "landmark",
      "range",
      "roletype",
      "section",
      "sectionhead",
      "select",
      "structure",
      "widget",
      "window",
    ]) {
      expect(getImplicitRole(el(`<div role="${role}">x</div>`)), role).toBe(
        "generic",
      );
    }
  });

  it("falls through to the next token it recognises", () => {
    expect(
      getImplicitRole(el('<div role="foo button" tabindex="0">x</div>')),
    ).toBe("button");
    expect(getImplicitRole(el('<div role="widget link">x</div>'))).toBe("link");
    expect(getImplicitRole(el('<div role="foo none">x</div>'))).toBe(
      "presentation",
    );
  });

  // A summary's own role is what it falls back to. (Chromium's own role for a
  // details' summary is DisclosureTriangle, which this producer doesn't model
  // yet — it reads `generic` with or without the bogus token.)
  it("keeps a details' summary on its own role", () => {
    expect(
      roleOf('<details><summary id="t" role="foo">S</summary>x</details>'),
    ).toBe(roleOf('<details><summary id="t">S</summary>x</details>'));
  });

  it("reads tokens ASCII-case-insensitively", () => {
    expect(getImplicitRole(el('<div role="BUTTON">x</div>'))).toBe("button");
    expect(getImplicitRole(el('<div role="Navigation">x</div>'))).toBe(
      "navigation",
    );
    expect(getImplicitRole(el('<div role="IMAGE">x</div>'))).toBe("img");
    expect(getImplicitRole(el('<div role="NONE">x</div>'))).toBe(
      "presentation",
    );
    expect(getImplicitRole(el('<div role="Doc-Chapter">x</div>'))).toBe(
      "doc-chapter",
    );
    // ASCII only: the Kelvin sign lowercases to "k" in Unicode, not in ASCII.
    expect(getImplicitRole(el('<div role="LINK">x</div>'))).toBe("generic");
  });

  it("folds directory, deprecated in ARIA 1.2, into list", () => {
    expect(getImplicitRole(el('<div role="directory">x</div>'))).toBe("list");
  });

  it("recognises the DPUB and Graphics module roles", () => {
    for (const role of [
      "doc-abstract",
      "doc-endnotes",
      "doc-noteref",
      "doc-toc",
      "graphics-document",
      "graphics-object",
      "graphics-symbol",
    ]) {
      expect(getImplicitRole(el(`<div role="${role}">x</div>`)), role).toBe(
        role,
      );
    }
  });

  it("does not recognise Chromium's internal role names", () => {
    for (const role of ["disclosuretriangle", "labeltext", "video", "frame"]) {
      expect(getImplicitRole(el(`<div role="${role}">x</div>`)), role).toBe(
        "generic",
      );
    }
  });

  it("getExplicitRole reports the role that applies, or nothing", () => {
    expect(getExplicitRole(el('<div role="foo">x</div>'))).toBeUndefined();
    expect(getExplicitRole(el('<div role="foo Tab">x</div>'))).toBe("tab");
    expect(getExplicitRole(el('<div role="   ">x</div>'))).toBeUndefined();
  });
});

// Chromium discards `listitem`, `option` and `treeitem` outside their required
// context — and moves on to the next token, or the element's own role. Its
// context walk climbs only through role-less div/span/slot/custom-element
// wrappers and presentational elements; anything else ends it. No other role
// with a required context in ARIA (menuitem, tab, row, cell, …) is discarded.
describe("required context: listitem, option, treeitem", () => {
  it("discards each one standalone", () => {
    for (const role of ["listitem", "option", "treeitem"]) {
      expect(roleOf(`<div id="t" role="${role}">x</div>`), role).toBe(
        "generic",
      );
      expect(
        roleOf(
          `<div id="t" role="${role}" tabindex="0" aria-label="n">x</div>`,
        ),
        `${role}, focusable and named`,
      ).toBe("generic");
    }
  });

  it("keeps a listitem in a list or a group", () => {
    for (const parent of [
      '<div role="list">',
      '<div role="directory">',
      '<div role="group">',
      '<div role="LIST">',
      '<div role="foo list">',
      "<ul>",
      "<ol>",
      "<menu>",
    ]) {
      const tag = parent.match(/^<(\w+)/)![1];
      expect(
        roleOf(`${parent}<div id="t" role="listitem">x</div></${tag}>`),
        parent,
      ).toBe("listitem");
    }
  });

  // The tag decides before the role does: a <ul> with any role still lists.
  it("counts a native list whatever role it carries", () => {
    for (const role of ["none", "navigation", "foo"]) {
      expect(
        roleOf(`<ul role="${role}"><div id="t" role="listitem">x</div></ul>`),
        role,
      ).toBe("listitem");
    }
  });

  it("climbs through role-less generic wrappers", () => {
    for (const [open, close] of [
      ["<div>", "</div>"],
      ["<span>", "</span>"],
      ["<x-wrap>", "</x-wrap>"],
      ['<div role="">', "</div>"],
      ['<div aria-label="w" tabindex="0">', "</div>"],
      ['<div style="display:contents">', "</div>"],
    ]) {
      expect(
        roleOf(
          `<div role="list">${open}<div id="t" role="listitem">x</div>${close}</div>`,
        ),
        open,
      ).toBe("listitem");
    }
  });

  it("climbs through presentational elements, whatever their tag", () => {
    for (const [open, close] of [
      ['<div role="none">', "</div>"],
      ['<section role="presentation">', "</section>"],
      ['<span role="NONE">', "</span>"],
      ['<div role="foo none">', "</div>"],
      // The wrapper's own conflict resolution doesn't enter into it.
      ['<div role="none" tabindex="0">', "</div>"],
    ]) {
      expect(
        roleOf(
          `<div role="list">${open}<div id="t" role="listitem">x</div>${close}</div>`,
        ),
        open,
      ).toBe("listitem");
    }
  });

  it("stops at anything else between it and the list", () => {
    for (const [open, close] of [
      ["<section>", "</section>"],
      ['<section aria-label="r">', "</section>"],
      ["<article>", "</article>"],
      ["<b>", "</b>"],
      ["<a>", "</a>"],
      ["<form>", "</form>"],
      ["<xwrap>", "</xwrap>"],
      ['<div role="generic">', "</div>"],
      ['<div role="foo">', "</div>"],
      ['<div role="listitem">', "</div>"],
      // An implicit group is not a group here: only an authored one counts.
      ["<fieldset>", "</fieldset>"],
    ]) {
      expect(
        roleOf(
          `<div role="list">${open}<div id="t" role="listitem">x</div>${close}</div>`,
        ),
        open,
      ).toBe("generic");
    }
    expect(
      roleOf('<ul><li><div id="t" role="listitem">x</div></li></ul>'),
      "a list item between",
    ).toBe("generic");
  });

  it("keeps an option in a listbox, a group or a select", () => {
    expect(
      roleOf('<div role="listbox"><div id="t" role="option">x</div></div>'),
    ).toBe("option");
    expect(
      roleOf(
        '<div role="listbox"><div role="group"><span><div id="t" role="option">x</div></span></div></div>',
      ),
    ).toBe("option");
    expect(
      roleOf('<div role="group"><div id="t" role="option">x</div></div>'),
    ).toBe("option");
    expect(
      roleOf('<select role="none"><option id="t" role="option">x</option>'),
    ).toBe("option");
  });

  it("discards an option anywhere else", () => {
    for (const parent of ["combobox", "menu", "list", "tree", "grid"]) {
      expect(
        roleOf(`<div role="${parent}"><div id="t" role="option">x</div></div>`),
        parent,
      ).toBe("generic");
    }
  });

  it("keeps a treeitem in a tree or a group, through parent treeitems", () => {
    expect(
      roleOf('<div role="tree"><div id="t" role="treeitem">x</div></div>'),
    ).toBe("treeitem");
    expect(
      roleOf(
        '<ul role="tree"><li role="treeitem">a<ul role="group"><li id="t" role="treeitem">x</li></ul></li></ul>',
      ),
    ).toBe("treeitem");
    expect(
      roleOf(
        '<div role="tree"><div role="TREEITEM">a<div id="t" role="treeitem">x</div></div></div>',
      ),
    ).toBe("treeitem");
    expect(
      roleOf('<div role="group"><div id="t" role="treeitem">x</div></div>'),
    ).toBe("treeitem");
  });

  it("discards a treeitem anywhere else", () => {
    expect(
      roleOf('<div role="treegrid"><div id="t" role="treeitem">x</div></div>'),
    ).toBe("generic");
    expect(
      roleOf('<div role="treeitem">a<div id="t" role="treeitem">x</div></div>'),
      "a treeitem alone is no context",
    ).toBe("generic");
    expect(
      roleOf(
        '<div role="tree"><ul><li><div id="t" role="treeitem">x</div></li></ul></div>',
      ),
      "a role-less list between",
    ).toBe("generic");
  });

  it("falls through to the next token", () => {
    expect(roleOf('<div id="t" role="listitem button">x</div>')).toBe("button");
    expect(
      roleOf(
        '<div role="list"><div id="t" role="option listitem">x</div></div>',
      ),
    ).toBe("listitem");
  });

  it("falls back to a native element's own role", () => {
    expect(
      roleOf('<details id="t" role="listitem"><summary>S</summary>x</details>'),
    ).toBe("group");
    expect(
      roleOf('<details id="t" role="treeitem"><summary>S</summary>x</details>'),
    ).toBe("group");
    expect(roleOf('<button id="t" role="option">x</button>')).toBe("button");
    expect(roleOf('<a id="t" href="/" role="treeitem">x</a>')).toBe("link");
    expect(roleOf('<h2 id="t" role="listitem">x</h2>')).toBe("heading");
    expect(roleOf('<ul><li id="t" role="option">x</li></ul>')).toBe("listitem");
    expect(roleOf('<input id="t" type="checkbox" role="option">')).toBe(
      "checkbox",
    );
    expect(
      roleOf('<details><summary id="t" role="option">S</summary>x</details>'),
    ).toBe(roleOf('<details><summary id="t">S</summary>x</details>'));
  });

  it("leaves every other context-bound role alone", () => {
    for (const role of [
      "menuitem",
      "menuitemcheckbox",
      "menuitemradio",
      "tab",
      "row",
      "cell",
      "gridcell",
      "columnheader",
      "rowheader",
      "rowgroup",
      "caption",
    ]) {
      expect(roleOf(`<div id="t" role="${role}">x</div>`), role).toBe(role);
    }
  });

  it("accepts a context from an aria-owns owner", () => {
    expect(
      roleInDocument(
        '<div role="list" aria-owns="t"></div><div id="t" role="listitem">x</div>',
      ),
    ).toBe("listitem");
    expect(
      roleInDocument(
        '<div role="listbox" aria-owns="a t b"></div><div id="t" role="option">x</div>',
      ),
    ).toBe("option");
    expect(
      roleInDocument(
        '<ul aria-owns="t"></ul><div id="t" role="listitem">x</div>',
      ),
      "a native list owns",
    ).toBe("listitem");
    expect(
      roleInDocument(
        '<div role="menu" aria-owns="t"></div><div id="t" role="option">x</div>',
      ),
    ).toBe("generic");
    expect(
      roleInDocument(
        '<div aria-owns="t"></div><div id="t" role="option">x</div>',
      ),
    ).toBe("generic");
  });

  // Two orphans owning each other must not recurse forever.
  it("survives an aria-owns cycle", () => {
    expect(
      roleInDocument(
        '<div id="a" role="listitem" aria-owns="t">a</div><div id="t" role="listitem" aria-owns="a">x</div>',
      ),
    ).toBe("generic");
  });

  it("walks the flat tree", () => {
    const slotted = document.createElement("div");
    slotted.innerHTML =
      '<div id="t" role="listitem" slot="s">x</div><span id="u" role="listitem">y</span>';
    slotted.attachShadow({ mode: "open" }).innerHTML =
      '<ul><slot name="s"></slot></ul><section><slot></slot></section>';
    expect(getImplicitRole(slotted.querySelector("#t")!)).toBe("listitem");
    expect(getImplicitRole(slotted.querySelector("#u")!)).toBe("generic");

    const host = document.createElement("div");
    host.setAttribute("role", "list");
    host.attachShadow({ mode: "open" }).innerHTML =
      '<div id="t" role="listitem">x</div>';
    expect(getImplicitRole(host.shadowRoot!.querySelector("#t")!)).toBe(
      "listitem",
    );
  });
});

// The context climb reads OTHER elements — ancestors, an owner — and a
// <form> among them can shadow `getAttribute`, `tagName` and `localName` with
// a control named after one. A plain read returns that control (or throws on
// the tripwire), and the item would drop from the tree with its subtree.
describe("required context through a clobbered <form>", () => {
  for (const prop of ["getAttribute", "tagName"]) {
    it(`climbs past a form whose ${prop} is shadowed`, () => {
      const div = document.createElement("div");
      div.innerHTML = `<div role="list"><form><input name="${prop}"><div id="t" role="listitem">x</div></form></div>`;
      clobber(div.querySelector("form")!, prop);
      // A form is no wrapper, so the climb stops there — without throwing.
      expect(getImplicitRole(div.querySelector("#t")!)).toBe("generic");
    });
  }

  it("reads a clobbered form's role when it is the context", () => {
    const div = document.createElement("div");
    div.innerHTML = `<form role="list"><input name="getAttribute"><div id="t" role="listitem">x</div></form>`;
    clobber(div.querySelector("form")!, "getAttribute");
    expect(getImplicitRole(div.querySelector("#t")!)).toBe("listitem");
  });

  it("reads a clobbered form as an aria-owns owner", () => {
    document.body.innerHTML = `<form role="list" aria-owns="t"><input name="getAttribute"></form><div id="t" role="listitem">x</div>`;
    try {
      clobber(document.querySelector("form")!, "getAttribute");
      expect(getImplicitRole(document.getElementById("t")!)).toBe("listitem");
    } finally {
      document.body.innerHTML = "";
    }
  });
});

// Chromium's native <li> role: an <li> whose parent <ul>/<ol>/<menu> carries
// any role other than exactly "list" or "directory" is presentational. That
// is how `<ul role="none">` strips list semantics from its items — and it
// compares the raw attribute, so `role="LIST"` strips them too.
describe("an <li> in a native list that carries a role", () => {
  it("is presentational under a presentational list", () => {
    expect(roleOf('<ul role="none"><li id="t">x</li></ul>')).toBe(
      "presentation",
    );
    expect(roleOf('<ol role="presentation"><li id="t">x</li></ol>')).toBe(
      "presentation",
    );
    expect(roleOf('<menu role="none"><li id="t">x</li></menu>')).toBe(
      "presentation",
    );
  });

  // Native semantics, not an authored role=none: no conflict resolution.
  it("stays presentational focusable or named", () => {
    expect(roleOf('<ul role="none"><li id="t" tabindex="0">x</li></ul>')).toBe(
      "presentation",
    );
    expect(
      roleOf('<ul role="none"><li id="t" aria-label="n">x</li></ul>'),
    ).toBe("presentation");
    expect(
      roleOf('<ul role="none" aria-label="l"><li id="t">x</li></ul>'),
      "the list's own role voided",
    ).toBe("presentation");
  });

  it("is presentational under any role but list or directory", () => {
    for (const role of [
      "navigation",
      "group",
      "menu",
      "foo",
      "LIST",
      " list ",
      "  ",
    ]) {
      expect(
        roleOf(`<ul role="${role}"><li id="t">x</li></ul>`),
        JSON.stringify(role),
      ).toBe("presentation");
    }
    for (const role of ["list", "directory", ""]) {
      expect(
        roleOf(`<ul role="${role}"><li id="t">x</li></ul>`),
        JSON.stringify(role),
      ).toBe("listitem");
    }
  });

  it("keeps an authored role", () => {
    expect(
      roleOf('<ul role="none"><li id="t" role="listitem">x</li></ul>'),
    ).toBe("listitem");
    expect(roleOf('<ul role="none"><li id="t" role="button">x</li></ul>')).toBe(
      "button",
    );
    expect(roleOf('<ul role="none"><li id="t" role="foo">x</li></ul>')).toBe(
      "presentation",
    );
  });

  it("looks at the direct flat-tree parent only", () => {
    expect(roleOf('<ul role="none"><div><li id="t">x</li></div></ul>')).toBe(
      "listitem",
    );
    expect(roleOf('<div><li id="t">x</li></div>')).toBe("listitem");

    const host = document.createElement("div");
    host.innerHTML = '<li id="t" slot="s">x</li>';
    host.attachShadow({ mode: "open" }).innerHTML =
      '<ul role="none"><slot name="s"></slot></ul>';
    expect(getImplicitRole(host.querySelector("#t")!), "slotted").toBe(
      "listitem",
    );
  });
});

describe("isHiddenFromAT", () => {
  it("hides script elements", () => {
    expect(isHiddenFromAT(el("<script>code</script>"))).toBe(true);
  });

  it("hides style elements", () => {
    expect(isHiddenFromAT(el("<style>.x{}</style>"))).toBe(true);
  });

  it("hides aria-hidden=true elements", () => {
    expect(isHiddenFromAT(el('<div aria-hidden="true">Hidden</div>'))).toBe(
      true,
    );
  });

  // role="presentation" / role="none" are NOT hidden — getImplicitRole maps
  // them to the "presentation" role and the a11y extractor flattens the
  // element from the tree (children are promoted to the parent).
  it("does not hide role=presentation elements (children are kept)", () => {
    expect(isHiddenFromAT(el('<div role="presentation">Decor</div>'))).toBe(
      false,
    );
  });

  it("does not hide role=none elements (children are kept)", () => {
    expect(isHiddenFromAT(el('<div role="none">None</div>'))).toBe(false);
  });

  it("does not hide normal elements", () => {
    expect(isHiddenFromAT(el("<div>Visible</div>"))).toBe(false);
  });

  it("does not hide aria-hidden=false elements", () => {
    expect(isHiddenFromAT(el('<div aria-hidden="false">Shown</div>'))).toBe(
      false,
    );
  });

  it("shares subtree-hidden checks with isSubtreeHidden (display:none)", () => {
    // Drift guard: isHiddenFromAT must keep calling isSubtreeHidden for the
    // overlapping conditions rather than re-implementing them. display:none
    // is the shared CSS path both predicates must agree on.
    const node = el('<div style="display:none">Gone</div>');
    document.body.appendChild(node);
    try {
      expect(isSubtreeHidden(node)).toBe(true);
      expect(isHiddenFromAT(node)).toBe(true);
    } finally {
      node.remove();
    }
  });

  it("treats visibility:hidden as AT-hidden but not subtree-hidden", () => {
    // visibility:hidden is NOT subtree-hiding (a child can override to
    // visible), so the walk still descends — but AT must not see the node.
    const node = el('<div style="visibility:hidden">Ghost</div>');
    document.body.appendChild(node);
    try {
      expect(isSubtreeHidden(node)).toBe(false);
      expect(isHiddenFromAT(node)).toBe(true);
    } finally {
      node.remove();
    }
  });

  // With no computed style (a DOM-less runtime), the extractor's visual check
  // falls back to the inline `visibility`. This check must do the same, or an
  // inline `visibility:hidden` element would read as "not visible, but
  // exposed to AT" — the sr-only signature — and queries would keep it.
  it("falls back to inline visibility:hidden when there is no computed style", () => {
    const node = el('<div style="visibility:hidden">Ghost</div>');
    expect(isHiddenFromAT(node, null)).toBe(true);
  });
});

describe("getHeadingLevel", () => {
  it("returns correct level for h1-h6", () => {
    expect(getHeadingLevel(el("<h1>Title</h1>"))).toBe(1);
    expect(getHeadingLevel(el("<h2>Subtitle</h2>"))).toBe(2);
    expect(getHeadingLevel(el("<h3>Section</h3>"))).toBe(3);
    expect(getHeadingLevel(el("<h4>Sub</h4>"))).toBe(4);
    expect(getHeadingLevel(el("<h5>Minor</h5>"))).toBe(5);
    expect(getHeadingLevel(el("<h6>Tiny</h6>"))).toBe(6);
  });

  it("returns null for non-heading elements", () => {
    expect(getHeadingLevel(el("<div>Not heading</div>"))).toBe(null);
    expect(getHeadingLevel(el("<p>Paragraph</p>"))).toBe(null);
  });

  it("returns aria-level for role=heading", () => {
    expect(
      getHeadingLevel(el('<div role="heading" aria-level="3">Heading</div>')),
    ).toBe(3);
  });

  // Chromium 151 and 153 give both of these their aria-level (CDP).
  it("returns aria-level for a heading role the browser resolves", () => {
    expect(
      getHeadingLevel(el('<div role="foo heading" aria-level="3">N</div>')),
    ).toBe(3);
    expect(
      getHeadingLevel(el('<div role="HEADING" aria-level="4">N</div>')),
    ).toBe(4);
  });
});
