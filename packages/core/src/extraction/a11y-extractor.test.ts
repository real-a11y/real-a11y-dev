import { afterEach, describe, it, expect, beforeEach } from "vitest";

import { resetIdCounter } from "../utils/id-generator.js";

import { extractA11yTree } from "./a11y-extractor.js";
import { extractDomTree } from "./dom-extractor.js";

beforeEach(() => {
  resetIdCounter();
});

function createPage(html: string): Element {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

describe("extractA11yTree", () => {
  // aria-hidden hides the whole subtree, and no descendant can override it.
  // The DOM view records exposure per element, so a descendant still reads
  // `isExposedToAT: true` there; the projection must drop it with its
  // ancestor rather than flatten it back up into the tree.
  it("drops every descendant of an aria-hidden element, not just the element", () => {
    const root = createPage(`
      <div aria-hidden="true">
        <h2>Behind a modal</h2>
        <div><button>Hidden action</button></div>
      </div>
      <h2>Shown</h2>
    `);
    const names = [...extractA11yTree(root).nodes.values()].map(
      (n) => n.a11y.name,
    );
    expect(names).toContain("Shown");
    expect(names).not.toContain("Behind a modal");
    expect(names).not.toContain("Hidden action");
  });

  it("keeps interactive nodes with meaningful roles", () => {
    const root = createPage(`
      <main>
        <h1>Title</h1>
        <button>Submit</button>
      </main>
    `);

    const { nodes } = extractA11yTree(root);
    const roles = Array.from(nodes.values()).map((n) => n.a11y.role);

    expect(roles).toContain("main");
    expect(roles).toContain("heading");
    expect(roles).toContain("button");
  });

  it("flattens unnamed generic nodes (div/span wrappers)", () => {
    const root = createPage(`
      <main>
        <div>
          <button>Go</button>
        </div>
      </main>
    `);

    const { nodes } = extractA11yTree(root);
    const allNodes = Array.from(nodes.values());

    // The unnamed inner div (wrapper inside <main>) must not appear.
    // The root div from createPage IS kept (it's the root), so we check
    // that the button is a DIRECT child of <main> — the wrapper was flattened.
    const mainNode = allNodes.find((n) => n.a11y.role === "main")!;
    expect(mainNode).toBeDefined();

    const btn = allNodes.find((n) => n.a11y.role === "button");
    expect(btn).toBeDefined();
    expect(btn!.a11y.name).toBe("Go");

    // Button is a direct child of main (no intermediate div node)
    expect(mainNode.childIds).toContain(btn!.id);
  });

  describe("sectionheader / sectionfooter (header/footer in sectioning content)", () => {
    function roleOf(html: string, predicate: (role: string) => boolean) {
      const { nodes } = extractA11yTree(createPage(html));
      return Array.from(nodes.values()).filter((n) => predicate(n.a11y.role));
    }

    it("flattens a bare one — the heading lands directly under main", () => {
      const { nodes } = extractA11yTree(
        createPage(`
          <main>
            <header><h1>Title</h1></header>
            <footer><p><a href="/x">More</a></p></footer>
          </main>
        `),
      );
      const all = Array.from(nodes.values());
      expect(all.map((n) => n.a11y.role)).not.toContain("sectionheader");
      expect(all.map((n) => n.a11y.role)).not.toContain("sectionfooter");
      const main = all.find((n) => n.a11y.role === "main")!;
      const heading = all.find((n) => n.a11y.role === "heading")!;
      expect(main.childIds).toContain(heading.id);
    });

    it("does not name one from its loose text (name from author only)", () => {
      const { nodes } = extractA11yTree(
        createPage(
          `<article><header>By Ada · <time>May 1</time></header><p>Body</p></article>`,
        ),
      );
      const roles = Array.from(nodes.values()).map((n) => n.a11y.role);
      expect(roles).not.toContain("sectionheader");
    });

    it("keeps a named one", () => {
      expect(
        roleOf(
          `<article><header title="Post meta"><p>x</p></header></article>`,
          (r) => r === "sectionheader",
        ),
      ).toHaveLength(1);
    });

    it("keeps a focusable one", () => {
      expect(
        roleOf(
          `<section><footer tabindex="0"><p>x</p></footer></section>`,
          (r) => r === "sectionfooter",
        ),
      ).toHaveLength(1);
    });

    it("keeps one carrying another global ARIA attribute", () => {
      expect(
        roleOf(
          `<main><header aria-controls="p"><h2>T</h2></header><p id="p">x</p></main>`,
          (r) => r === "sectionheader",
        ),
      ).toHaveLength(1);
    });

    it("does not count aria-hidden as another global ARIA attribute", () => {
      expect(
        roleOf(
          `<main><header aria-hidden="false"><h2>T</h2></header></main>`,
          (r) => r === "sectionheader",
        ),
      ).toHaveLength(0);
    });

    it("keeps a busy one (aria-busy)", () => {
      expect(
        roleOf(
          `<main><header aria-busy="true"><h2>T</h2></header></main>`,
          (r) => r === "sectionheader",
        ),
      ).toHaveLength(1);
    });

    it("keeps one with a description (aria-describedby)", () => {
      // Attached: describedby resolves its target through the document.
      const page = createPage(
        `<main><header aria-describedby="d"><h2>T</h2></header><p id="d">desc</p></main>`,
      );
      document.body.appendChild(page);
      try {
        const { nodes } = extractA11yTree(page);
        const kept = Array.from(nodes.values()).filter(
          (n) => n.a11y.role === "sectionheader",
        );
        expect(kept).toHaveLength(1);
      } finally {
        page.remove();
      }
    });

    it("leaves body-scoped banner/contentinfo landmarks alone", () => {
      const roles = roleOf(
        `<header><p>Site</p></header><footer><p>Legal</p></footer>`,
        () => true,
      ).map((n) => n.a11y.role);
      expect(roles).toContain("banner");
      expect(roles).toContain("contentinfo");
    });
  });

  it("suppresses label element but promotes wrapped form controls", () => {
    const root = createPage(`
      <form aria-label="Contact form">
        <label>Full name<input type="text" /></label>
        <label>Email address<input type="email" /></label>
        <label>Message<textarea></textarea></label>
        <button>Send</button>
      </form>
    `);

    const { nodes } = extractA11yTree(root);
    const allNodes = Array.from(nodes.values());

    // label elements must NOT appear in the a11y tree
    expect(allNodes.find((n) => n.dom?.tagName === "label")).toBeUndefined();

    // The form controls inside the labels MUST appear with correct names
    const textInput = allNodes.find(
      (n) => n.dom?.tagName === "input" && n.dom?.attributes["type"] === "text",
    );
    expect(textInput).toBeDefined();
    expect(textInput!.a11y.name).toBe("Full name");

    const emailInput = allNodes.find(
      (n) =>
        n.dom?.tagName === "input" && n.dom?.attributes["type"] === "email",
    );
    expect(emailInput).toBeDefined();
    expect(emailInput!.a11y.name).toBe("Email address");

    const textarea = allNodes.find((n) => n.dom?.tagName === "textarea");
    expect(textarea).toBeDefined();
    expect(textarea!.a11y.name).toBe("Message");

    // Button still present
    const btn = allNodes.find((n) => n.a11y.role === "button");
    expect(btn).toBeDefined();
    expect(btn!.a11y.name).toBe("Send");
  });

  it("suppresses a legend, but keeps a details' summary as its toggle", () => {
    const root = createPage(`
      <fieldset>
        <legend>Credentials</legend>
        <input type="text" aria-label="Username" />
      </fieldset>
      <details>
        <summary>More options</summary>
        <p>Hidden content</p>
      </details>
    `);

    const { nodes } = extractA11yTree(root);
    const allNodes = Array.from(nodes.values());

    // The legend only names its fieldset, so it must not appear
    expect(allNodes.find((n) => n.dom?.tagName === "legend")).toBeUndefined();

    // fieldset keeps its accessible name from the legend text
    const fieldset = allNodes.find(
      (n) => n.a11y.role === "group" && n.dom?.tagName === "fieldset",
    );
    expect(fieldset).toBeDefined();
    expect(fieldset!.a11y.name).toBe("Credentials");

    // The summary names its details too, but it is also the toggle Chromium
    // tabs to, so it stays: a tab stop and a focus marker need a node.
    const details = allNodes.find((n) => n.dom?.tagName === "details");
    const summary = allNodes.find((n) => n.dom?.tagName === "summary");
    expect(details!.a11y.name).toBe("More options");
    expect(summary).toBeDefined();
    expect(summary!.a11y.name).toBe("More options");
    expect(summary!.parentId).toBe(details!.id);
    expect(summary!.childIds).toEqual([]);
  });

  it("keeps only the first summary of a details, the one Chromium focuses", () => {
    const root = createPage(`
      <details open>
        <summary>First</summary>
        <summary>Second</summary>
        <div><summary>Nested</summary></div>
      </details>
      <fieldset>
        <legend tabindex="0">Focusable legend</legend>
      </fieldset>
    `);

    const { nodes } = extractA11yTree(root);
    const summaries = Array.from(nodes.values()).filter(
      (n) => n.dom?.tagName === "summary",
    );
    expect(summaries.map((n) => n.a11y.name)).toEqual(["First"]);
    // Any name source Chromium can focus stays, not only a summary.
    const legend = Array.from(nodes.values()).find(
      (n) => n.dom?.tagName === "legend",
    );
    expect(legend?.a11y.name).toBe("Focusable legend");
  });

  it("preserves interactive descendants inside a legend or summary", () => {
    // The legend/summary text is consumed as the fieldset/details accessible
    // name, so the text carriers are dropped — but a link or button nested
    // inside is keyboard-reachable and must stay in the tree.
    const root = createPage(`
      <fieldset>
        <legend>Payment <a href="/help">(help)</a></legend>
        <input type="text" aria-label="Card number" />
      </fieldset>
      <details>
        <summary>Details <button>Copy</button></summary>
        <p>Hidden content</p>
      </details>
    `);

    const { nodes } = extractA11yTree(root);
    const allNodes = Array.from(nodes.values());

    // The legend itself is still suppressed. The summary stays, because it
    // is its details' toggle and a tab stop of its own.
    expect(allNodes.find((n) => n.dom?.tagName === "legend")).toBeUndefined();
    const summary = allNodes.find((n) => n.dom?.tagName === "summary");
    expect(summary).toBeDefined();

    // ...and their interactive descendants survive
    const helpLink = allNodes.find((n) => n.a11y.role === "link");
    expect(helpLink).toBeDefined();
    expect(helpLink!.a11y.name).toBe("(help)");

    const copyButton = allNodes.find((n) => n.a11y.role === "button");
    expect(copyButton).toBeDefined();
    expect(copyButton!.a11y.name).toBe("Copy");
    expect(summary!.childIds).toEqual([copyButton!.id]);

    // The plain text in the legend/summary is not re-surfaced as a generic
    const generics = allNodes.filter((n) => n.a11y.role === "generic");
    expect(generics.find((n) => n.a11y.name === "Payment")).toBeUndefined();
    expect(generics.find((n) => n.a11y.name === "Details")).toBeUndefined();

    // The fieldset still takes its accessible name from the legend
    const fieldset = allNodes.find((n) => n.a11y.role === "group");
    expect(fieldset).toBeDefined();
    expect(fieldset!.a11y.name).toContain("Payment");
  });

  it("leaves a closed details' body out, and brings it back once open", () => {
    // Chromium 151's tree for the closed shape holds the group and its
    // disclosure alone: no heading, image or link from the body.
    const body = `<summary>S</summary><h2>Body heading</h2><img alt="Body img" src="x.gif"><a href="/x">Body link</a>`;
    const names = (open: boolean) =>
      [
        ...extractA11yTree(
          createPage(`<details${open ? " open" : ""}>${body}</details>`),
        ).nodes.values(),
      ].map((n) => n.a11y.name);

    for (const name of ["Body heading", "Body img", "Body link"]) {
      expect(names(false)).not.toContain(name);
      expect(names(true)).toContain(name);
    }
  });

  it("does not duplicate label-for associated inputs", () => {
    // label[for] name lookup requires document context (uses querySelector on
    // ownerDocument). Attach to document.body for this test.
    document.body.innerHTML = `
      <label for="q">Search</label>
      <input id="q" type="search" />
    `;

    const { nodes } = extractA11yTree(document.body);
    const allNodes = Array.from(nodes.values());

    // label suppressed, input promoted
    expect(allNodes.find((n) => n.dom?.tagName === "label")).toBeUndefined();
    const inputs = allNodes.filter((n) => n.dom?.tagName === "input");
    expect(inputs).toHaveLength(1);
    expect(inputs[0].a11y.name).toBe("Search");

    document.body.innerHTML = ""; // cleanup
  });

  it("does not surface a text-only <span> inside a <label> as a standalone node", () => {
    // This is the pattern many frameworks emit
    // (<label><span>Email</span><input /></label>) — the span text is already
    // consumed as the input's accessible name and must not appear twice.
    const root = createPage(`
      <form aria-label="Signup">
        <label><span>Email</span><input type="email" /></label>
        <label><span>Role</span>
          <select>
            <option value="">Select one</option>
            <option value="dev">Developer</option>
          </select>
        </label>
      </form>
    `);

    const { nodes } = extractA11yTree(root);
    const allNodes = Array.from(nodes.values());

    // No stray generics for the label text
    const generics = allNodes.filter((n) => n.a11y.role === "generic");
    expect(generics.find((n) => n.a11y.name === "Email")).toBeUndefined();
    expect(generics.find((n) => n.a11y.name === "Role")).toBeUndefined();

    // Controls are present with their name computed from the label
    const email = allNodes.find(
      (n) => n.dom?.tagName === "input" && n.a11y.name === "Email",
    );
    const role = allNodes.find(
      (n) => n.dom?.tagName === "select" && n.a11y.name === "Role",
    );
    expect(email).toBeDefined();
    expect(role).toBeDefined();
  });

  it("preserves interactive descendants inside a label (e.g. a help link)", () => {
    const root = createPage(`
      <form aria-label="Signup">
        <label>
          Password
          <a href="/help/password">(?)</a>
          <input type="password" />
        </label>
      </form>
    `);

    const { nodes } = extractA11yTree(root);
    const allNodes = Array.from(nodes.values());

    // The help link must still appear — it's interactive, not redundant decoration.
    const helpLink = allNodes.find((n) => n.a11y.role === "link");
    expect(helpLink).toBeDefined();

    // And the input is still there with its computed name.
    const pw = allNodes.find((n) => n.dom?.tagName === "input");
    expect(pw).toBeDefined();
  });

  it("names a table from its caption and keeps the caption node", () => {
    const root = createPage(`
      <table>
        <caption>Q3 results</caption>
        <tbody><tr><td>NW-1</td></tr></tbody>
      </table>
    `);
    const { nodes } = extractA11yTree(root);
    const allNodes = Array.from(nodes.values());
    const table = allNodes.find((n) => n.a11y.role === "table");
    expect(table?.a11y.name).toBe("Q3 results");
    const caption = allNodes.find((n) => n.dom?.tagName === "caption");
    expect(caption?.a11y.role).toBe("caption");
    expect(caption?.parentId).toBe(table?.id);
  });

  it("keeps a non-interactive child of a naming caption", () => {
    const { nodes } = extractA11yTree(
      createPage(
        `<table><caption><h2>Sales</h2></caption><tbody><tr><td>x</td></tr></tbody></table>`,
      ),
    );
    const all = Array.from(nodes.values());
    expect(all.find((n) => n.a11y.role === "table")?.a11y.name).toBe("Sales");
    expect(all.some((n) => n.a11y.role === "caption")).toBe(true);
    expect(all.some((n) => n.a11y.role === "heading")).toBe(true);
  });

  it("promotes an interactive child of a presentational table's caption", () => {
    const { nodes } = extractA11yTree(
      createPage(
        `<table role="presentation"><caption>Cap <a href="#x">more</a></caption><tbody><tr><td>x</td></tr></tbody></table>`,
      ),
    );
    const all = Array.from(nodes.values());
    expect(all.some((n) => n.a11y.role === "caption")).toBe(false);
    expect(all.some((n) => n.a11y.role === "link")).toBe(true);
  });

  it("does not expose a caption under a presentational table", () => {
    for (const role of ["none", "presentation"]) {
      const { nodes } = extractA11yTree(
        createPage(
          `<table role="${role}"><caption>Cap</caption><tbody><tr><td>x</td></tr></tbody></table>`,
        ),
      );
      const roles = Array.from(nodes.values()).map((n) => n.a11y.role);
      expect(roles).not.toContain("caption");
    }
  });

  it("keeps the table name's edge non-breaking spaces from its caption", () => {
    // The table's name keeps U+00A0 (AccName trims ASCII whitespace only), so
    // the comparison that decides "the caption supplied the name" must too.
    for (const caption of ["&nbsp;Sales", "Sales&nbsp;", "&nbsp;Sales&nbsp;"]) {
      const root = createPage(
        `<table><caption>${caption}</caption><tbody><tr><td>NW-1</td></tr></tbody></table>`,
      );
      const allNodes = Array.from(extractA11yTree(root).nodes.values());
      const table = allNodes.find((n) => n.a11y.role === "table");
      expect(table?.a11y.name).toBe(caption.replaceAll("&nbsp;", "\u00a0"));
      expect(allNodes.some((n) => n.a11y.role === "caption")).toBe(true);
    }
  });

  it("does not name a table from a hidden caption", () => {
    for (const caption of [
      `<caption hidden>Ghost</caption>`,
      `<caption style="display:none">Hidden</caption>`,
      `<caption aria-hidden="true">Ghost</caption>`,
    ]) {
      const root = createPage(
        `<table>${caption}<tbody><tr><td>NW-1</td></tr></tbody></table>`,
      );
      const table = Array.from(extractA11yTree(root).nodes.values()).find(
        (n) => n.a11y.role === "table",
      );
      expect(table?.a11y.name).toBe("");
    }
  });

  it("falls through an empty caption so title can still name the table", () => {
    const named = createPage(`
      <table title="Quarterly"><tbody><tr><td>x</td></tr></tbody></table>
    `);
    const emptyCaption = createPage(`
      <table title="Quarterly"><caption></caption><tbody><tr><td>x</td></tr></tbody></table>
    `);
    const nameOf = (root: Element) =>
      Array.from(extractA11yTree(root).nodes.values()).find(
        (n) => n.a11y.role === "table",
      )?.a11y.name;
    expect(nameOf(named)).toBe("Quarterly");
    expect(nameOf(emptyCaption)).toBe("Quarterly");
  });

  it("keeps the caption's words when a higher-precedence name wins", () => {
    const cases: { html: string; tableName: string }[] = [
      {
        tableName: "Escalations",
        html: `<table aria-label="Escalations">
          <caption><h2>Open support tickets</h2></caption>
          <tbody><tr><td>NW-1</td></tr></tbody>
        </table>`,
      },
      // labelledby is not on `dom.attributes` (not a KEY_ATTRIBUTE). The
      // names match on purpose: without reading the live element, this
      // looks like "caption supplied the name" and the heading vanishes.
      {
        tableName: "Open support tickets",
        html: `<span id="tbl">Open support tickets</span>
          <table aria-labelledby="tbl">
            <caption><h2>Open support tickets</h2></caption>
            <tbody><tr><td>NW-1</td></tr></tbody>
          </table>`,
      },
    ];
    for (const { html, tableName } of cases) {
      const { nodes } = extractA11yTree(createPage(html));
      const allNodes = Array.from(nodes.values());
      const table = allNodes.find((n) => n.a11y.role === "table");
      expect(table?.a11y.name).toBe(tableName);
      expect(allNodes.some((n) => n.a11y.name === "Open support tickets")).toBe(
        true,
      );
      expect(allNodes.some((n) => n.a11y.role === "caption")).toBe(true);
    }
  });

  // role="presentation" / role="none" / <img alt=""> — the element drops out
  // of the a11y tree per ARIA spec, even when it has text content that would
  // otherwise count as an accessible name. Regression test for the panel
  // showing every Shiki syntax token as a separate `generic` row even though
  // the spans were marked `role="presentation"`.
  describe('presentational elements (role=presentation/none/img alt="")', () => {
    it("flattens role=presentation spans with text content (Shiki syntax tokens)", () => {
      const root = createPage(`
        <pre tabindex="0">
          <code>
            <span role="presentation">const</span>
            <span role="presentation">sn</span>
            <span role="presentation">=</span>
            <span role="presentation">createInspector</span>
          </code>
        </pre>
      `);

      const { nodes } = extractA11yTree(root);
      const allNodes = Array.from(nodes.values());

      // No "presentation" or token-text generic node leaks through.
      expect(
        allNodes.find((n) => n.a11y.role === "presentation"),
      ).toBeUndefined();
      expect(
        allNodes.find(
          (n) => n.a11y.role === "generic" && n.a11y.name === "createInspector",
        ),
      ).toBeUndefined();

      // The <code> element is still in the tree — it has the meaningful "code" role.
      const code = allNodes.find((n) => n.a11y.role === "code");
      expect(code).toBeDefined();
    });

    it("treats role=none identically to role=presentation", () => {
      const root = createPage(`
        <div>
          <span role="none">Decor</span>
          <button>Real action</button>
        </div>
      `);

      const { nodes } = extractA11yTree(root);
      const allNodes = Array.from(nodes.values());

      expect(
        allNodes.find((n) => n.a11y.role === "presentation"),
      ).toBeUndefined();
      // The decorative span's text must not surface as a standalone generic row.
      expect(
        allNodes.find(
          (n) => n.a11y.role === "generic" && n.a11y.name === "Decor",
        ),
      ).toBeUndefined();
      // The button is unaffected.
      expect(allNodes.find((n) => n.a11y.role === "button")).toBeDefined();
    });

    it('flattens <img alt=""> from the tree (decorative image)', () => {
      const root = createPage(`
        <main>
          <img alt="" src="decor.png" />
          <h1>Real heading</h1>
        </main>
      `);

      const { nodes } = extractA11yTree(root);
      const allNodes = Array.from(nodes.values());

      // No img and no leftover "presentation" node.
      expect(allNodes.find((n) => n.dom?.tagName === "img")).toBeUndefined();
      expect(
        allNodes.find((n) => n.a11y.role === "presentation"),
      ).toBeUndefined();

      // Real heading still present.
      expect(allNodes.find((n) => n.a11y.role === "heading")).toBeDefined();
    });

    it("exposes focusable role=presentation elements with their implicit role", () => {
      // ARIA Presentational Roles Conflict Resolution: role=presentation is
      // ignored when the element is focusable — presenting a real interactive
      // control as decorative would lose keyboard access. The element is
      // exposed with its IMPLICIT role, so an <a href> reads as a link, not
      // as a "presentation" node an audit or matcher would have to special-case.
      const root = createPage(`
        <nav aria-label="Main">
          <a href="/about" role="presentation">About</a>
        </nav>
      `);

      const { nodes } = extractA11yTree(root);
      const allNodes = Array.from(nodes.values());

      const link = allNodes.find((n) => n.dom?.tagName === "a");
      expect(link).toBeDefined();
      expect(link!.a11y.role).toBe("link");
      expect(link!.interaction?.isInteractive).toBe(true);
    });

    it("leaves a genuinely decorative role=presentation flattened", () => {
      // The conflict-resolution check is deliberately stricter than the
      // interaction.isFocusable facet: an <a> without href is not a tab stop,
      // so its decorative role stands and it flattens as before.
      const root = createPage(`
        <main>
          <a role="presentation">Decorative</a>
        </main>
      `);

      const { nodes } = extractA11yTree(root);
      const allNodes = Array.from(nodes.values());

      expect(allNodes.find((n) => n.dom?.tagName === "a")).toBeUndefined();
    });

    it("keeps a role=presentation heading that carries a global ARIA property", () => {
      // aria-label voids presentation, so the heading stays a heading —
      // otherwise it silently vanished from heading-order audits.
      const root = createPage(`
        <main>
          <h2 role="presentation" aria-label="Quarterly results">Q3</h2>
        </main>
      `);

      const { nodes } = extractA11yTree(root);
      const heading = Array.from(nodes.values()).find(
        (n) => n.dom?.tagName === "h2",
      );

      expect(heading).toBeDefined();
      expect(heading!.a11y.role).toBe("heading");
      expect(heading!.a11y.name).toBe("Quarterly results");
    });

    it("keeps <img alt=''> that is named by a title", () => {
      // HTML-AAM: alt="" is presentational only absent other naming. With a
      // title the image is exposed AND named from it — the name has to land
      // too, or the tree gains an exposed but nameless image.
      const root = createPage(`
        <main>
          <img alt="" title="Company logo" src="/logo.png">
          <img alt="" src="/spacer.gif">
        </main>
      `);

      const { nodes } = extractA11yTree(root);
      const images = Array.from(nodes.values()).filter(
        (n) => n.dom?.tagName === "img",
      );

      // Only the titled one survives; the bare spacer is still decorative.
      expect(images).toHaveLength(1);
      expect(images[0].a11y.role).toBe("img");
      expect(images[0].a11y.name).toBe("Company logo");
    });
  });

  describe("visibility:hidden", () => {
    function paragraphs(html: string) {
      const { nodes } = extractA11yTree(createPage(html));
      // The wrapper div createPage adds is the tree's root; it is not under test.
      return Array.from(nodes.values()).filter(
        (n) =>
          n.parentId !== null &&
          (n.dom?.tagName === "p" || n.dom?.tagName === "div"),
      );
    }

    it("keeps a child that sets visibility:visible and drops the hidden parent", () => {
      const kept = paragraphs(
        `<div style="visibility:hidden"><p style="visibility:visible">x</p></div>`,
      );
      expect(kept.map((n) => n.dom?.tagName)).not.toContain("div");
      const p = kept.find((n) => n.dom?.tagName === "p");
      expect(p?.a11y.role).toBe("paragraph");
    });

    it("drops a child that inherits visibility:hidden", () => {
      const kept = paragraphs(`<div style="visibility:hidden"><p>x</p></div>`);
      expect(kept).toHaveLength(0);
    });

    it("leaves an extraction root hidden by visibility:hidden empty, as before", () => {
      const root = createPage(`<p style="visibility:visible">x</p>`);
      root.setAttribute("style", "visibility:hidden");
      const { nodes } = extractA11yTree(root);
      expect(nodes.size).toBe(0);
    });

    it("does not surface the unrendered fallback of a hidden <video>", () => {
      const kept = paragraphs(
        `<video style="visibility:hidden"><p style="visibility:visible">fallback</p></video>`,
      );
      expect(kept).toHaveLength(0);
    });

    it("still prunes an aria-hidden subtree whole", () => {
      const kept = paragraphs(
        `<div aria-hidden="true"><p aria-hidden="false" style="visibility:visible">x</p></div>`,
      );
      expect(kept).toHaveLength(0);
    });
  });
});

describe("presentational tables", () => {
  const rolesOf = (html: string) =>
    [...extractA11yTree(createPage(html)).nodes.values()].map((n) => ({
      role: n.a11y.role,
      name: n.a11y.name,
    }));

  const repro =
    "<thead><tr><th>H</th></tr></thead><tbody><tr><td>C</td></tr></tbody>";

  it("exposes no table-part nodes and keeps the text", () => {
    const nodes = rolesOf(`<table role="presentation">${repro}</table>`);
    const roles = nodes.map((n) => n.role);
    for (const r of ["rowgroup", "row", "columnheader", "cell"]) {
      expect(roles).not.toContain(r);
    }
    const root = extractA11yTree(
      createPage(`<table role="presentation">${repro}</table>`),
    )
      .nodes.values()
      .next().value;
    expect(root?.dom?.descendantText).toBe("HC");
  });

  it("keeps table, row and cell when the table is labelled", () => {
    const roles = rolesOf(
      `<table role="presentation" aria-label="L">${repro}</table>`,
    ).map((n) => n.role);
    expect(roles).toEqual(expect.arrayContaining(["table", "row", "cell"]));
  });
});

// A prose element that mixes its own text with children that have a node of
// their own prints the text as `text` rows between them, in reading order —
// Chromium's `StaticText, link, StaticText`. Folded into a name it read
// `paragraph "You accept our and have read our ."`: no sentence, and no way to
// tell where a link sits.
describe("text runs beside kept children", () => {
  // In the document: a wrapper is a run only where it has an inline box, and a
  // detached element has no computed display to read.
  const treeOf = (html: string, options?: { redactInput?: boolean }) => {
    document.body.innerHTML = `<main>${html}</main>`;
    return extractA11yTree(document.body.firstElementChild!, options);
  };
  const print = (html: string, options?: { redactInput?: boolean }) => {
    const tree = treeOf(html, options);
    const lines: string[] = [];
    const visit = (id: string, depth: number) => {
      const node = tree.nodes.get(id)!;
      const name = node.a11y.name ? ` "${node.a11y.name}"` : "";
      lines.push(`${"  ".repeat(depth)}${node.a11y.role}${name}`);
      for (const childId of node.childIds) visit(childId, depth + 1);
    };
    for (const childId of tree.nodes.get(tree.rootId)!.childIds) {
      visit(childId, 0);
    }
    return lines;
  };

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps each run where it reads, between the links", () => {
    expect(
      print(
        `<p>You accept our <a href="/terms">terms</a> and have read our <a href="/privacy">privacy policy</a>.</p>`,
      ),
    ).toEqual([
      "paragraph",
      '  text "You accept our"',
      '  link "terms"',
      '  text "and have read our"',
      '  link "privacy policy"',
      '  text "."',
    ]);
  });

  it.each([
    ["listitem", `<ul><li>Buy <a href="#">milk</a> now</li></ul>`],
    ["blockquote", `<blockquote>Buy <a href="#">milk</a> now</blockquote>`],
    ["definition", `<dl><dt>t</dt><dd>Buy <a href="#">milk</a> now</dd></dl>`],
    ["code", `<code>Buy <a href="#">milk</a> now</code>`],
    ["strong", `<strong>Buy <a href="#">milk</a> now</strong>`],
    ["time", `<time>Buy <a href="#">milk</a> now</time>`],
  ])("does the same for a %s", (role, html) => {
    const lines = print(html).map((line) => line.trim());
    const at = lines.indexOf(role);
    expect(lines.slice(at, at + 4)).toEqual([
      role,
      'text "Buy"',
      'link "milk"',
      'text "now"',
    ]);
  });

  it("covers the native producer's prose roles", async () => {
    const { mapNativeAXRole, NATIVE_AX_OWN_TEXT_ROLES } =
      await import("../native/ax-vocabulary.js");
    const { TEXT_RUN_HOST_ROLES } = await import("./text-runs.js");
    // A `<figcaption>` is a `generic` in this producer, so it has no entry.
    const native = [...NATIVE_AX_OWN_TEXT_ROLES]
      .filter((role) => role !== "Figcaption")
      .map(mapNativeAXRole);
    expect([...TEXT_RUN_HOST_ROLES].sort()).toEqual(native.sort());
  });

  it("leaves text with no such child as the name it was", () => {
    expect(print(`<p>Sent</p>`)).toEqual(['paragraph "Sent"']);
    // A `<b>` is part of the run, and Chromium gives it no node.
    expect(print(`<p>Pure <b>bold</b> text.</p>`)).toEqual([
      'paragraph "Pure bold text."',
      '  generic "bold"',
    ]);
    // A `generic` named from its own text is no child to read around either.
    expect(print(`<p>Hello <span id="w">world</span> end</p>`)).toEqual([
      'paragraph "Hello end"',
      '  generic "world"',
    ]);
  });

  it("leaves a role named from its content alone", () => {
    expect(print(`<h2>Read the <a href="#">docs</a></h2>`)).toEqual([
      'heading "Read the docs"',
      '  link "docs"',
    ]);
  });

  it.each([
    ["an aria-label", `<p aria-label="A B">A <a href="#">x</a> B</p>`, "A B"],
    [
      "aria-labelledby",
      `<p aria-labelledby="h">A <a href="#">x</a> B</p><h2 id="h">Head</h2>`,
      "Head",
    ],
  ])("leaves a paragraph named by %s alone", (_, html, name) => {
    expect(print(html).slice(0, 2)).toEqual([
      `paragraph "${name}"`,
      '  link "x"',
    ]);
  });

  it("reads a role-less inline wrapper as part of the run around it", () => {
    // The `<span>` and the `<b>` get no node; what they hold moves up.
    expect(
      print(
        `<p>A <span>s1 <em>em</em> <a href="#">L</a> s2</span> <b>bold</b> B</p>`,
      ),
    ).toEqual([
      "paragraph",
      '  text "A s1"',
      '  emphasis "em"',
      '  link "L"',
      '  text "s2 bold B"',
    ]);
  });

  it("carries a run on through a child that leaves nothing in the tree", () => {
    expect(
      print(`<p>A <span hidden>h</span> B<br>C <a href="#">x</a> <i></i></p>`),
    ).toEqual(["paragraph", '  text "A B C"', '  link "x"']);
  });

  it("prints no row for a run of white space", () => {
    expect(print(`<p><a href="#">a</a> <a href="#">b</a> end</p>`)).toEqual([
      "paragraph",
      '  link "a"',
      '  link "b"',
      '  text "end"',
    ]);
  });

  it("makes a row a leaf with nothing to act on, under the element it reads", () => {
    const tree = treeOf(`<p>See <a href="#">this</a></p>`);
    const paragraph = [...tree.nodes.values()].find(
      (n) => n.a11y.role === "paragraph",
    )!;
    const row = tree.nodes.get(paragraph.childIds[0])!;
    expect(row).toMatchObject({
      parentId: paragraph.id,
      childIds: [],
      depth: paragraph.depth + 1,
      a11y: { role: "text", name: "See", isExposedToAT: true },
      interaction: { isInteractive: false, actions: [], isFocusable: false },
    });
  });

  it("keeps a row's id from one read to the next", () => {
    document.body.innerHTML = `<main><p>See <a href="#">this</a> now</p></main>`;
    const rowIds = () =>
      [...extractA11yTree(document.body).nodes.values()]
        .filter((n) => n.a11y.role === "text")
        .map((n) => n.id);
    const first = rowIds();
    expect(first).toHaveLength(2);
    expect(rowIds()).toEqual(first);
  });

  it("adds no row to the DOM view", () => {
    document.body.innerHTML = `<main><p>See <a href="#">this</a> now</p></main>`;
    const nodes = [...extractDomTree(document.body).nodes.values()];
    expect(nodes.some((n) => n.a11y.role === "text")).toBe(false);
    expect(nodes.find((n) => n.a11y.role === "paragraph")!.a11y.name).toBe(
      "See now",
    );
  });

  it("shows no typed text in strict mode", () => {
    // What a user typed is withheld from the name, so there is none to divide.
    const lines = print(
      `<p contenteditable="true">secret <a href="#">x</a> typed</p><p>Read <a href="#">y</a> on</p>`,
      { redactInput: true },
    );
    expect(lines.join("\n")).not.toMatch(/secret|typed/);
    expect(lines.slice(-3)).toEqual([
      '  text "Read"',
      '  link "y"',
      '  text "on"',
    ]);
  });
});
