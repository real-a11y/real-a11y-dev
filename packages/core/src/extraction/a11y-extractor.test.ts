import { describe, it, expect, beforeEach } from "vitest";

import { resetIdCounter } from "../utils/id-generator.js";

import { extractA11yTree } from "./a11y-extractor.js";

beforeEach(() => {
  resetIdCounter();
});

function createPage(html: string): Element {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

describe("extractA11yTree", () => {
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
    expect(allNodes.find((n) => n.dom.tagName === "label")).toBeUndefined();

    // The form controls inside the labels MUST appear with correct names
    const textInput = allNodes.find(
      (n) => n.dom.tagName === "input" && n.dom.attributes["type"] === "text",
    );
    expect(textInput).toBeDefined();
    expect(textInput!.a11y.name).toBe("Full name");

    const emailInput = allNodes.find(
      (n) => n.dom.tagName === "input" && n.dom.attributes["type"] === "email",
    );
    expect(emailInput).toBeDefined();
    expect(emailInput!.a11y.name).toBe("Email address");

    const textarea = allNodes.find((n) => n.dom.tagName === "textarea");
    expect(textarea).toBeDefined();
    expect(textarea!.a11y.name).toBe("Message");

    // Button still present
    const btn = allNodes.find((n) => n.a11y.role === "button");
    expect(btn).toBeDefined();
    expect(btn!.a11y.name).toBe("Send");
  });

  it("suppresses legend and summary nodes entirely (including children)", () => {
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

    // legend and summary must not appear
    expect(allNodes.find((n) => n.dom.tagName === "legend")).toBeUndefined();
    expect(allNodes.find((n) => n.dom.tagName === "summary")).toBeUndefined();

    // fieldset keeps its accessible name from the legend text
    const fieldset = allNodes.find((n) => n.a11y.role === "group");
    expect(fieldset).toBeDefined();
    expect(fieldset!.a11y.name).toBe("Credentials");
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
    expect(allNodes.find((n) => n.dom.tagName === "label")).toBeUndefined();
    const inputs = allNodes.filter((n) => n.dom.tagName === "input");
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
      (n) => n.dom.tagName === "input" && n.a11y.name === "Email",
    );
    const role = allNodes.find(
      (n) => n.dom.tagName === "select" && n.a11y.name === "Role",
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
    const pw = allNodes.find((n) => n.dom.tagName === "input");
    expect(pw).toBeDefined();
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
      expect(allNodes.find((n) => n.dom.tagName === "img")).toBeUndefined();
      expect(
        allNodes.find((n) => n.a11y.role === "presentation"),
      ).toBeUndefined();

      // Real heading still present.
      expect(allNodes.find((n) => n.a11y.role === "heading")).toBeDefined();
    });

    it("keeps focusable elements with role=presentation (spec carve-out)", () => {
      // Per ARIA spec, role=presentation is ignored when the element is
      // focusable — presenting a real interactive control as decorative
      // would lose keyboard access. So an <a href> with role=presentation
      // stays in the tree (as the presentation role itself, since the
      // implicit role isn't restored — but it's kept rather than flattened).
      const root = createPage(`
        <nav aria-label="Main">
          <a href="/about" role="presentation">About</a>
        </nav>
      `);

      const { nodes } = extractA11yTree(root);
      const allNodes = Array.from(nodes.values());

      // The link is still in the tree (focusable carve-out).
      const link = allNodes.find((n) => n.dom.tagName === "a");
      expect(link).toBeDefined();
      expect(link!.interaction.isInteractive).toBe(true);
    });
  });
});
