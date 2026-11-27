import {
  extractA11yTree,
  type ExtractionResult,
  type SemanticNode,
} from "@real-a11y-dev/core";
import { describe, it, expect } from "vitest";

import {
  A11yAssertionError,
  ALL_RULES,
  assertUniqueInteractiveNames,
  collectFindings,
  type Finding,
} from "./index.js";

function mount(html: string): HTMLElement {
  document.body.innerHTML = "";
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

const unique = (root: Element | ExtractionResult): Finding[] =>
  collectFindings(root, ["unique-interactive-names"]);

/** `role "name"` per finding, the shape these tests compare. */
const named = (findings: Finding[]): string[] =>
  findings.map((f) => `${f.role} "${f.name}"`);

describe("unique-interactive-names — the reported markup", () => {
  const html = `
    <main>
      <section aria-label="Requests">
        <h2>Requests</h2>
        <p>Ana</p><button>Accept</button>
        <p>Luis</p><button>Accept</button>
      </section>
      <section aria-label="Menu">
        <button aria-expanded="false">Options</button>
        <button aria-expanded="true">Options</button>
      </section>
    </main>`;

  it("flags both Accept buttons and both Options buttons, whatever their states", () => {
    const findings = unique(mount(html));
    expect(named(findings)).toEqual([
      'button "Accept"',
      'button "Accept"',
      'button "Options"',
      'button "Options"',
    ]);
    for (const f of findings) {
      expect(f).toMatchObject({
        rule: "unique-interactive-names",
        severity: "warning",
        tagName: "button",
      });
    }
  });

  it("gives each finding its own locator and names the region it is in", () => {
    const findings = unique(mount(html));
    expect(new Set(findings.map((f) => f.locator)).size).toBe(4);
    expect(findings.map((f) => f.context)).toEqual([
      'in <region "Requests">',
      'in <region "Requests">',
      'in <region "Menu">',
      'in <region "Menu">',
    ]);
  });

  it("says what is wrong, and that it is best practice", () => {
    const [first] = unique(mount(html));
    expect(first!.message).toBe(
      `Duplicate accessible name: another button is also named "Accept". A screen-reader user who hears only the name can't tell them apart; give each a name of its own (best practice, WCAG 2.4.6 and 2.4.9).`,
    );
  });

  it("runs by default, in ALL_RULES", () => {
    expect(ALL_RULES).toContain("unique-interactive-names");
    const rules = collectFindings(mount(html)).map((f) => f.rule);
    expect(rules.filter((r) => r === "unique-interactive-names")).toHaveLength(
      4,
    );
  });

  it("keeps counts out of the message, so a third copy leaves the first two as they were", () => {
    // A snapshot's fingerprint and its changed/new diff read these messages:
    // "2 buttons share…" turning into "3 buttons share…" would report every
    // existing finding as changed when a row is added.
    const two = unique(mount(`<button>Accept</button><button>Accept</button>`));
    const three = unique(
      mount(
        `<button>Accept</button><button>Accept</button><button>Accept</button>`,
      ),
    );
    expect(three.slice(0, 2).map((f) => f.message)).toEqual(
      two.map((f) => f.message),
    );
  });
});

describe("unique-interactive-names — what makes two names the same", () => {
  it("passes controls whose names differ", () => {
    const root = mount(
      `<button>Accept Ana</button><button>Accept Luis</button><a href="/a">Docs</a>`,
    );
    expect(unique(root)).toEqual([]);
  });

  it("ignores case and runs of whitespace, as speech does", () => {
    const root = mount(`<button>Accept</button><button>  accept\n</button>`);
    expect(unique(root)).toHaveLength(2);
  });

  it("does not let a description tell two names apart", () => {
    const root = mount(`
      <p id="ana">Ana's request</p><p id="luis">Luis's request</p>
      <button aria-describedby="ana">Accept</button>
      <button aria-describedby="luis">Accept</button>`);
    expect(named(unique(root))).toEqual(['button "Accept"', 'button "Accept"']);
  });

  it("compares within one role only", () => {
    const root = mount(`<button>Delete</button><a href="/delete">Delete</a>`);
    expect(unique(root)).toEqual([]);
  });

  it("compares across the whole page, not per region", () => {
    const root = mount(`
      <section aria-label="Billing"><button>Edit</button></section>
      <section aria-label="Shipping"><button>Edit</button></section>`);
    expect(unique(root).map((f) => f.context)).toEqual([
      'in <region "Billing">',
      'in <region "Shipping">',
    ]);
  });

  it("covers checkboxes and switches", () => {
    const root = mount(`
      <input type="checkbox" aria-label="Select"><input type="checkbox" aria-label="Select">
      <button role="switch" aria-checked="true">Wi-Fi</button>
      <button role="switch" aria-checked="false">Wi-Fi</button>`);
    expect(named(unique(root))).toEqual([
      'checkbox "Select"',
      'checkbox "Select"',
      'switch "Wi-Fi"',
      'switch "Wi-Fi"',
    ]);
  });

  it("leaves unnamed controls to no-unlabeled-interactive", () => {
    expect(unique(mount(`<button></button><button></button>`))).toEqual([]);
  });

  it("leaves text fields out: billing and shipping both have a City", () => {
    const root = mount(`
      <fieldset><legend>Billing</legend><label>City <input></label></fieldset>
      <fieldset><legend>Shipping</legend><label>City <input></label></fieldset>`);
    expect(unique(root)).toEqual([]);
  });

  it("counts only what assistive technology reaches", () => {
    const root = mount(`
      <button>Accept</button>
      <button hidden>Accept</button>
      <div aria-hidden="true"><button>Accept</button></div>`);
    expect(unique(root)).toEqual([]);
  });
});

describe("unique-interactive-names — links", () => {
  it("passes links with one name that go to one place", () => {
    const root = mount(
      `<a href="/product/1">Blue mug</a><a href="/product/1">Blue mug</a>`,
    );
    expect(unique(root)).toEqual([]);
  });

  it("flags links with one name that go to different places, with their hrefs", () => {
    const root = mount(`
      <main>
        <a href="/posts/1">Read more</a>
        <a href="/posts/2">Read more</a>
      </main>`);
    const findings = unique(root);
    expect(findings.map((f) => f.context)).toEqual([
      'href="/posts/1" · in <main>',
      'href="/posts/2" · in <main>',
    ]);
    expect(findings[0]!.message).toMatch(
      /^Duplicate accessible name: another link named "Read more" goes somewhere else\./,
    );
  });

  it("flags every link of a name that has more than one destination", () => {
    const root = mount(`
      <a href="/a">Read more</a><a href="/a">Read more</a><a href="/b">Read more</a>`);
    expect(unique(root)).toHaveLength(3);
  });

  it("takes a path and an absolute URL with that path as one destination", () => {
    // W3C's home page links one news item as `/WAI/…/wcag-em/` and another as
    // `https://www.w3.org/WAI/…/wcag-em/`: the same page, spelled two ways.
    const root = mount(`
      <a href="/WAI/wcag-em/">WCAG-EM Overview</a>
      <a href="https://www.w3.org/WAI/wcag-em/">WCAG-EM Overview</a>`);
    expect(unique(root)).toEqual([]);
  });

  it("still tells two origins with one path apart", () => {
    const root = mount(`
      <a href="https://a.example/docs">Docs</a>
      <a href="https://b.example/docs">Docs</a>
      <a href="/docs">Docs</a>`);
    expect(unique(root)).toHaveLength(3);
  });

  it("counts # and javascript: links as going nowhere in particular", () => {
    // Scripted links act as buttons: one `href="#"` says nothing about what
    // each one does.
    const root = mount(`
      <a href="#">Delete</a><a href="#">Delete</a>
      <a href="javascript:void(0)">Edit</a><a href="javascript:void(0)">Edit</a>`);
    expect(named(unique(root))).toEqual([
      'link "Delete"',
      'link "Delete"',
      'link "Edit"',
      'link "Edit"',
    ]);
  });

  it("prints an href without its query or fragment, where a token would be", () => {
    const root = mount(`
      <a href="/reset?token=abc123">Reset</a>
      <a href="/reset?token=def456#top">Reset</a>`);
    const findings = unique(root);
    expect(findings.map((f) => f.context)).toEqual([
      'href="/reset"',
      'href="/reset"',
    ]);
    expect(JSON.stringify(findings)).not.toMatch(/abc123|def456/);
  });

  it("takes /docs and /./docs as one destination", () => {
    const root = mount(`<a href="/docs">Docs</a><a href="/./docs">Docs</a>`);
    expect(unique(root)).toEqual([]);
  });

  it("tells a tel: and an sms: link to one number apart", () => {
    const root = mount(`
      <a href="tel:+15550100">Contact</a><a href="sms:+15550100">Contact</a>`);
    expect(unique(root)).toHaveLength(2);
  });

  it("prints no credentials however the href spells them", () => {
    const root = mount(`
      <a href="  https://ann:s3cret@a.example/x">Files</a>
      <a href="https:\\\\bob:hunter2@b.example/y">Files</a>
      <a href="https://cat:p@ss@c.example/z">Files</a>`);
    const contexts = unique(root).map((f) => f.context);
    expect(contexts).toEqual([
      'href="https://a.example/x"',
      'href="https://b.example/y"',
      'href="https://c.example/z"',
    ]);
    expect(JSON.stringify(contexts)).not.toMatch(/s3cret|hunter2|ss@/);
  });

  it("prints an href without the credentials in it", () => {
    const root = mount(`
      <a href="https://ann:s3cret@a.example/x">Files</a>
      <a href="https://b.example/x">Files</a>`);
    expect(unique(root).map((f) => f.context)).toEqual([
      'href="https://a.example/x"',
      'href="https://b.example/x"',
    ]);
  });

  it("counts a link with no href as a destination of its own", () => {
    const root = mount(
      `<span role="link" tabindex="0">Next</span><span role="link" tabindex="0">Next</span>`,
    );
    expect(unique(root)).toHaveLength(2);
  });
});

describe("unique-interactive-names — items compared within their container", () => {
  it("passes the same Yes and No under two questions", () => {
    const root = mount(`
      <fieldset><legend>Do you smoke?</legend>
        <label><input type="radio" name="a">Yes</label>
        <label><input type="radio" name="a">No</label></fieldset>
      <div role="radiogroup" aria-label="Do you drink?">
        <label><input type="radio" name="b">Yes</label>
        <label><input type="radio" name="b">No</label></div>`);
    expect(unique(root)).toEqual([]);
  });

  it("flags two radios of one name in one group, and names the group", () => {
    const root = mount(`
      <fieldset><legend>Size</legend>
        <label><input type="radio" name="s">Large</label>
        <label><input type="radio" name="s">Large</label></fieldset>`);
    const findings = unique(root);
    expect(named(findings)).toEqual(['radio "Large"', 'radio "Large"']);
    expect(findings[0]!.message).toMatch(
      /^Duplicate accessible name: another radio in this group is also named "Large"\./,
    );
  });

  it("compares radios in unnamed fieldsets as one group: nothing is announced", () => {
    const root = mount(`
      <fieldset><label><input type="radio" name="a">Yes</label></fieldset>
      <fieldset><label><input type="radio" name="b">Yes</label></fieldset>`);
    expect(named(unique(root))).toEqual(['radio "Yes"', 'radio "Yes"']);
  });

  it("compares one menu's items across its unnamed groups", () => {
    const root = mount(`
      <div role="menu" aria-label="Actions">
        <div role="group"><div role="menuitem" tabindex="-1">Rename</div></div>
        <div role="group"><div role="menuitem" tabindex="-1">Rename</div></div>
      </div>`);
    const findings = unique(root);
    expect(named(findings)).toEqual(['menuitem "Rename"', 'menuitem "Rename"']);
    expect(findings[0]!.message).toContain("in this menu");
  });

  it("passes one item name in two named groups of a menu", () => {
    const root = mount(`
      <div role="menu" aria-label="Actions">
        <div role="group" aria-label="File"><div role="menuitem" tabindex="-1">Rename</div></div>
        <div role="group" aria-label="Folder"><div role="menuitem" tabindex="-1">Rename</div></div>
      </div>`);
    expect(unique(root)).toEqual([]);
  });

  it("scopes an option by the list box that owns it with aria-owns", () => {
    // Both options sit in "Spare" in the markup; each is owned elsewhere.
    const markup = (owns: boolean) => `
      <div role="listbox" aria-label="Arrival"${owns ? ' aria-owns="a-none"' : ""}></div>
      <div role="listbox" aria-label="Departure"${owns ? ' aria-owns="d-none"' : ""}></div>
      <div role="listbox" aria-label="Spare">
        <div role="option" id="a-none" tabindex="-1">None</div>
        <div role="option" id="d-none" tabindex="-1">None</div>
      </div>`;
    expect(unique(mount(markup(true)))).toEqual([]);
    expect(named(unique(mount(markup(false))))).toEqual([
      'option "None"',
      'option "None"',
    ]);
  });

  it("follows an aria-owns that names a wrapper the tree flattens", () => {
    // `aria-owns` points at a role-less `<div>` around the option, which has
    // no node of its own: the option is still the owner's.
    const markup = (owns: boolean) => `
      <div role="listbox" aria-label="Arrival"${owns ? ' aria-owns="a-wrap"' : ""}></div>
      <div role="listbox" aria-label="Departure"${owns ? ' aria-owns="d-wrap"' : ""}></div>
      <div role="listbox" aria-label="Spare">
        <div id="a-wrap"><div role="option" tabindex="-1">None</div></div>
        <div id="d-wrap"><div role="option" tabindex="-1">None</div></div>
      </div>`;
    expect(unique(mount(markup(true)))).toEqual([]);
    expect(unique(mount(markup(false)))).toHaveLength(2);
  });

  it("reads ownership through clobber-safe accessors", () => {
    // In Chromium a form's named controls shadow its methods; jsdom doesn't
    // model that, so own properties stand in for them (the e2e suite has
    // the real thing).
    const root = mount(`
      <div role="listbox" aria-label="Arrival" aria-owns="a"></div>
      <form aria-label="Book"><input name="getAttribute" aria-label="Seat">
        <div role="listbox" aria-label="Spare"><div role="option" id="a" tabindex="-1">None</div></div>
        <button>Send</button><button>Send</button>
      </form>`);
    const form = root.querySelector("form")!;
    const input = form.querySelector("input")!;
    for (const key of ["getAttribute", "parentElement", "id"]) {
      Object.defineProperty(form, key, { value: input, configurable: true });
    }
    expect(named(unique(root))).toEqual(['button "Send"', 'button "Send"']);
  });

  it("resolves an aria-owns id in the owner's own shadow root", () => {
    // Two instances of one widget reuse the internal id "opt": each list
    // box owns its own option, not the first instance's.
    const root = mount(`<div id="one"></div><div id="two"></div>`);
    for (const host of root.querySelectorAll("div")) {
      host.attachShadow({ mode: "open" }).innerHTML = `
        <div role="listbox" aria-label="Pick" aria-owns="opt"></div>
        <div role="option" id="opt" tabindex="-1">None</div>`;
    }
    const options = [...extractA11yTree(root).nodes.values()].filter(
      (n) => n.a11y.role === "option" && n.a11y.isExposedToAT,
    );
    expect(options).toHaveLength(2);
    expect(unique(root)).toEqual([]);
  });

  it("leaves an option where it is when aria-owns names the slot it renders in", () => {
    // Owning a slot moves nothing assigned to it, in Chromium's tree too: both
    // options are still the "Pick" list box's, and share a name. The owner
    // sits in the slot's own shadow root, where its id resolves.
    const root = mount(`
      <div id="host">
        <div role="option" tabindex="-1">None</div>
        <div role="option" tabindex="-1" slot="other">None</div>
      </div>`);
    root.querySelector("#host")!.attachShadow({ mode: "open" }).innerHTML = `
      <div role="listbox" aria-label="Elsewhere" aria-owns="s"></div>
      <div role="listbox" aria-label="Pick"><slot id="s"></slot><slot name="other"></slot></div>`;
    expect(named(unique(root))).toEqual(['option "None"', 'option "None"']);
  });

  it("climbs from a slotted option to its slot, not its host", () => {
    // Each option renders in its component's own list box. The hosts are
    // owned by an outer list box, which must not pull the options out.
    const root = mount(`
      <div role="listbox" aria-label="Outer" aria-owns="h1 h2"></div>
      <div id="h1"><div role="option" tabindex="-1">None</div></div>
      <div id="h2"><div role="option" tabindex="-1">None</div></div>`);
    for (const id of ["h1", "h2"]) {
      root.querySelector(`#${id}`)!.attachShadow({ mode: "open" }).innerHTML =
        `<div role="listbox" aria-label="Inner"><slot></slot></div>`;
    }
    const options = [...extractA11yTree(root).nodes.values()].filter(
      (n) => n.a11y.role === "option",
    );
    expect(options).toHaveLength(2);
    expect(unique(root)).toEqual([]);
  });

  it("follows an aria-owns cycle without looping", () => {
    const root = mount(`
      <div role="listbox" id="x" aria-label="X" aria-owns="y"></div>
      <div role="listbox" id="y" aria-label="Y" aria-owns="x"></div>
      <div role="option" tabindex="-1">One</div>`);
    expect(unique(root)).toEqual([]);
  });

  it("compares radios with no group across the page", () => {
    const root = mount(`
      <label><input type="radio" name="a">Yes</label>
      <label><input type="radio" name="b">Yes</label>`);
    expect(named(unique(root))).toEqual(['radio "Yes"', 'radio "Yes"']);
  });

  it("passes the same options in two selects", () => {
    const root = mount(`
      <label>From <select><option>Choose…</option><option>Lima</option></select></label>
      <label>To <select><option>Choose…</option><option>Lima</option></select></label>`);
    expect(unique(root)).toEqual([]);
  });

  it("passes tabs of one name in two tab lists, and flags them in one", () => {
    const two = mount(`
      <div role="tablist" aria-label="Orders"><button role="tab">Details</button></div>
      <div role="tablist" aria-label="Returns"><button role="tab">Details</button></div>`);
    expect(unique(two)).toEqual([]);
    const one = mount(`
      <div role="tablist" aria-label="Orders">
        <button role="tab">Details</button><button role="tab">Details</button></div>`);
    expect(named(unique(one))).toEqual(['tab "Details"', 'tab "Details"']);
  });

  it("passes one file name in two folders of a tree", () => {
    const root = mount(`
      <ul role="tree" aria-label="Files">
        <li role="treeitem" aria-expanded="true">src
          <ul role="group"><li role="treeitem">README</li></ul></li>
        <li role="treeitem" aria-expanded="true">docs
          <ul role="group"><li role="treeitem">README</li></ul></li>
      </ul>`);
    expect(unique(root)).toEqual([]);
  });
});

describe("unique-interactive-names — a native tree", () => {
  // No live element stands behind a native node: the locator is the one the
  // producer computed, and the landmark and href come from the tree itself.
  const built = new Map<string, SemanticNode>();

  /** A native node, with `children` parented under it. */
  function n(
    id: string,
    role: string,
    name: string,
    over: { attributes?: Record<string, string>; locator?: string } = {},
    children: SemanticNode[] = [],
  ): SemanticNode {
    const node: SemanticNode = {
      id,
      parentId: null,
      childIds: children.map((c) => c.id),
      depth: 0,
      a11y: {
        role,
        name,
        description: "",
        states: {},
        properties: {},
        isExposedToAT: true,
      },
      ...(over.attributes || over.locator
        ? {
            dom: {
              tagName: role === "link" ? "a" : "button",
              attributes: over.attributes ?? {},
              textContent: null,
              descendantText: "",
              isHidden: false,
              ...(over.locator ? { locator: over.locator } : {}),
            },
          }
        : {}),
    };
    for (const child of children) child.parentId = id;
    built.set(id, node);
    return node;
  }

  function tree(children: SemanticNode[]): ExtractionResult {
    const root = n("ax-1", "document", "", {}, children);
    const nodes = new Map<string, SemanticNode>();
    const walk = (node: SemanticNode) => {
      nodes.set(node.id, node);
      for (const id of node.childIds) walk(built.get(id)!);
    };
    walk(root);
    built.clear();
    return { rootId: "ax-1", nodes, source: { producer: "native" } };
  }

  it("flags duplicates with the producer's locators and the tree's landmark", () => {
    const findings = unique(
      tree([
        n("m", "main", "", {}, [
          n("r", "region", "Requests", {}, [
            n("b1", "button", "Accept", { locator: "#a1" }),
            n("b2", "button", "Accept", { locator: "#a2" }),
          ]),
        ]),
      ]),
    );
    expect(findings.map((f) => [f.locator, f.context])).toEqual([
      ["#a1", 'in <region "Requests">'],
      ["#a2", 'in <region "Requests">'],
    ]);
  });

  it("reads a link's href from the dom facet", () => {
    const same = tree([
      n("l1", "link", "Home", { attributes: { href: "/" } }),
      n("l2", "link", "Home", { attributes: { href: "/" } }),
    ]);
    expect(unique(same)).toEqual([]);
    const different = tree([
      n("l1", "link", "Home", { attributes: { href: "/" } }),
      n("l2", "link", "Home", { attributes: { href: "/shop" } }),
    ]);
    expect(unique(different).map((f) => f.context)).toEqual([
      'href="/"',
      'href="/shop"',
    ]);
  });

  it("compares each frame's controls on their own", () => {
    const embeds = tree([
      n("p", "button", "Play"),
      n("f1", "Iframe", "Video one", {}, [n("f1p", "button", "Play")]),
      n("f2", "Iframe", "Video two", {}, [n("f2p", "button", "Play")]),
    ]);
    expect(unique(embeds)).toEqual([]);
    const inOne = tree([
      n("f1", "Iframe", "Player", {}, [
        n("a", "button", "Play"),
        n("b", "button", "Play"),
      ]),
    ]);
    expect(named(unique(inOne))).toEqual(['button "Play"', 'button "Play"']);
  });

  it("leaves the controls a player or a field draws to themselves", () => {
    // What Chromium 14x exposes for two `<video controls>` and two date
    // inputs: each brings its own "play" and "Show date picker", in a
    // user-agent shadow root no author can rename.
    const findings = unique(
      tree([
        n("v1", "video", "One", {}, [
          n("v1p", "button", "play"),
          n("v1m", "button", "mute"),
        ]),
        n("v2", "video", "Two", {}, [
          n("v2p", "button", "play"),
          n("v2m", "button", "mute"),
        ]),
        n("d1", "Date", "Start", {}, [n("d1b", "button", "Show date picker")]),
        n("d2", "Date", "End", {}, [n("d2b", "button", "Show date picker")]),
        n("t1", "InputTime", "From", {}, [
          n("t1b", "button", "Show time picker"),
        ]),
        n("t2", "InputTime", "To", {}, [
          n("t2b", "button", "Show time picker"),
        ]),
      ]),
    );
    expect(findings).toEqual([]);
  });

  it("still compares a page's own buttons beside a player", () => {
    const findings = unique(
      tree([
        n("v", "video", "Intro", {}, [n("vp", "button", "Play")]),
        n("a", "button", "Play", { locator: "#a" }),
        n("b", "button", "Play", { locator: "#b" }),
      ]),
    );
    expect(findings.map((f) => f.locator)).toEqual(["#a", "#b"]);
  });

  it("names no Chromium role when one field draws two of a name", () => {
    const findings = unique(
      tree([
        n("t", "InputTime", "From", {}, [
          n("a", "button", "Pick"),
          n("b", "button", "Pick"),
        ]),
      ]),
    );
    expect(findings[0]!.message).toMatch(
      /^Duplicate accessible name: another button in the same field or player is also named "Pick"\./,
    );
    expect(findings[0]!.message).not.toContain("InputTime");
  });

  it("prints a native link's href without its query", () => {
    const findings = unique(
      tree([
        n("l1", "link", "Reset", { attributes: { href: "/r?token=abc" } }),
        n("l2", "link", "Reset", { attributes: { href: "/r?token=def" } }),
      ]),
    );
    // Two tokens, one path: the rule still sees two destinations.
    expect(findings.map((f) => f.context)).toEqual(['href="/r"', 'href="/r"']);
  });

  it("does not describe a frame's control by the page's landmark", () => {
    const findings = unique(
      tree([
        n("m", "main", "", {}, [
          n("f", "Iframe", "Player", {}, [
            n("a", "button", "Play"),
            n("b", "button", "Play"),
          ]),
        ]),
      ]),
    );
    expect(findings.map((f) => f.context)).toEqual([undefined, undefined]);
  });
});

describe("unique-interactive-names — strict mode", () => {
  it("doesn't compare names strict mode withheld", () => {
    // Each button is named by a field's value; strict mode withholds both as
    // the same marker, which says nothing about whether the names match.
    const root = mount(`
      <input id="a" value="Ana" aria-label="First"><button aria-labelledby="a">x</button>
      <input id="b" value="Luis" aria-label="Second"><button aria-labelledby="b">x</button>`);
    const strict = extractA11yTree(root, { redactInput: true });
    const names = [...strict.nodes.values()]
      .filter((n) => n.a11y.role === "button")
      .map((n) => n.a11y.name);
    expect(names).toEqual(["[redacted]", "[redacted]"]);
    expect(unique(strict)).toEqual([]);
    expect(unique(extractA11yTree(root))).toEqual([]);
  });
});

describe("assertUniqueInteractiveNames", () => {
  it("throws an A11yAssertionError listing each control", () => {
    const root = mount(`<button>Accept</button><button>Accept</button>`);
    expect(() => assertUniqueInteractiveNames(root)).toThrow(
      A11yAssertionError,
    );
    expect(() => assertUniqueInteractiveNames(root)).toThrow(
      /Found 2 accessibility issues:\n {2}- Duplicate accessible name: another button is also named "Accept"/,
    );
  });

  it("passes when every name is unique", () => {
    const root = mount(
      `<button>Accept Ana</button><button>Accept Luis</button>`,
    );
    expect(() => assertUniqueInteractiveNames(root)).not.toThrow();
  });
});
