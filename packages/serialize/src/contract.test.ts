import { describe, it, expect } from "vitest";

import { parseA11yTree, verifyContract } from "./contract.js";
import { serializeTree } from "./serialize.js";

function mount(html: string): HTMLElement {
  document.body.innerHTML = "";
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

// ─── parser ──────────────────────────────────────────────────────────────────

describe("parseA11yTree", () => {
  it("parses roles, names, levels, focus, comments, and frontmatter", () => {
    const { roots, frontmatter } = parseA11yTree(
      [
        "---",
        "source: figma.com/design/abc?node-id=1-2",
        "---",
        "",
        "# the login form",
        "form",
        '  textbox "Email address" [focused]',
        '  heading "Sign in" (level 1)',
      ].join("\n"),
    );
    expect(frontmatter).toContain("source:");
    expect(roots).toHaveLength(1);
    const form = roots[0]!;
    expect(form.role).toBe("form");
    expect(form.name).toBeUndefined();
    expect(form.children.map((c) => c.role)).toEqual(["textbox", "heading"]);
    expect(form.children[0]!.focused).toBe(true);
    expect(form.children[1]!.level).toBe(1);
  });

  it("rejects odd indentation", () => {
    expect(() => parseA11yTree(" button")).toThrow(/indent/);
  });

  it("rejects a malformed name token", () => {
    expect(() => parseA11yTree('button "unterminated')).toThrow(/cannot parse/);
  });

  it("rejects an orphan depth jump only when strictIndent is set", () => {
    expect(() =>
      parseA11yTree('form\n    button "Go"', { strictIndent: true }),
    ).toThrow(/depth 2 with no parent/);
    // Lenient default: attach to the nearest ancestor rather than reject.
    const { roots } = parseA11yTree('form\n    button "Go"');
    expect(roots[0]!.children[0]!.role).toBe("button");
  });

  it("rebases a non-zero base indent (a pasted subtree fragment)", () => {
    const { roots } = parseA11yTree('  form\n    button "Go"');
    expect(roots[0]!.role).toBe("form");
    expect(roots[0]!.children[0]!.role).toBe("button");
  });

  it("round-trips serializeTree output, which starts at indent 0", () => {
    const el = mount(`<main><h1>Dash</h1><button>Save</button></main>`);
    const text = serializeTree(el);
    expect(text).toMatch(/^main$/m);
    const { roots } = parseA11yTree(text);
    expect(roots.map((r) => r.role)).toEqual(["main"]);
  });
});

// ─── containment (the tabs Correct/Broken pattern) ───────────────────────────

const TABS_CORRECT = `
  <div role="tablist" aria-label="Billing tabs">
    <button role="tab" aria-selected="true" aria-controls="p1" id="t1">Overview</button>
    <button role="tab" aria-selected="false" aria-controls="p2" id="t2">Invoices</button>
    <button role="tab" aria-selected="false" aria-controls="p3" id="t3">Settings</button>
  </div>
  <div role="tabpanel" id="p1" aria-labelledby="t1">Overview content</div>
`;
const TABS_BROKEN = `
  <div>
    <button type="button">Overview</button>
    <button type="button">Invoices</button>
    <button type="button">Settings</button>
  </div>
  <div>Overview content</div>
`;
const TABS_CONTRACT = `
# Billing screen tabs
tablist "Billing tabs"
  tab "Overview"
  tab "Invoices"
  tab "Settings"
tabpanel "Overview"
`;

describe("verifyContract — containment", () => {
  it("passes on the correct implementation", () => {
    const r = verifyContract(TABS_CONTRACT, serializeTree(mount(TABS_CORRECT)));
    expect(r.pass).toBe(true);
    expect(r.matched).toBe(r.total);
  });

  it("fails on the broken implementation, pinpointing the first missing node", () => {
    const r = verifyContract(TABS_CONTRACT, serializeTree(mount(TABS_BROKEN)));
    expect(r.pass).toBe(false);
    expect(r.message).toContain("matched 0/5");
    expect(r.message).toContain('✖ tablist "Billing tabs"');
  });
});

// ─── containment (a real page: noise + wrapper nesting) ──────────────────────

const LOGIN_CORRECT = `
  <a href="#main">Skip to content</a>
  <div role="dialog" aria-label="We value your privacy">
    <button>Accept all</button>
    <button>Reject all</button>
  </div>
  <main>
    <h1>Sign in</h1>
    <form aria-label="Sign in">
      <div role="group" aria-label="Credentials">
        <input type="text" aria-label="Email address" />
        <input type="text" aria-label="Password" />
      </div>
      <button>Sign in</button>
    </form>
    <a href="/forgot">Forgot password?</a>
  </main>
`;
const LOGIN_BROKEN = LOGIN_CORRECT.replace(
  "<button>Sign in</button>",
  `<div onclick="submit()" class="btn">Sign in</div>`,
);
const LOGIN_CONTRACT = `main
  heading "Sign in" (level 1)
  form
    textbox "Email address"
    textbox "Password"
    button "Sign in"
  link "Forgot password?"`;

describe("verifyContract — a real page", () => {
  it("passes despite extra nodes (skip link, cookie dialog) and wrapper nesting", () => {
    const r = verifyContract(
      LOGIN_CONTRACT,
      serializeTree(mount(LOGIN_CORRECT)),
    );
    expect(r.pass).toBe(true);
  });

  it("fails, and says the submit button is missing under the form", () => {
    const r = verifyContract(
      LOGIN_CONTRACT,
      serializeTree(mount(LOGIN_BROKEN)),
    );
    expect(r.pass).toBe(false);
    expect(r.matched).toBe(5);
    expect(r.message).toContain('✖ button "Sign in"');
    expect(r.message).toContain("under form");
  });

  it("enforces document order", () => {
    const reordered = `main\n  link "Forgot password?"\n  form\n    button "Sign in"`;
    expect(
      verifyContract(reordered, serializeTree(mount(LOGIN_CORRECT))).pass,
    ).toBe(false);
  });

  it("an omitted name is unconstrained", () => {
    const r = verifyContract(
      `dialog\n  button`,
      serializeTree(mount(LOGIN_CORRECT)),
    );
    expect(r.pass).toBe(true);
  });

  it("enforces heading level when specified", () => {
    const target = serializeTree(mount(LOGIN_CORRECT));
    expect(verifyContract(`heading "Sign in" (level 2)`, target).pass).toBe(
      false,
    );
    expect(verifyContract(`heading "Sign in" (level 1)`, target).pass).toBe(
      true,
    );
  });

  it("[focused] requires actual focus", () => {
    const el = mount(LOGIN_CORRECT);
    const contract = `textbox "Email address" [focused]`;
    expect(verifyContract(contract, serializeTree(el)).pass).toBe(false);
    el.querySelector("input")!.focus();
    expect(verifyContract(contract, serializeTree(el)).pass).toBe(true);
  });

  it("backtracks past a greedy dead end (two navs, only the second has a list)", () => {
    const el = mount(`
      <nav aria-label="Breadcrumbs"><a href="/">Home</a></nav>
      <nav aria-label="Primary"><ul><li><a href="/docs">Docs</a></li></ul></nav>
    `);
    const r = verifyContract(
      `navigation\n  list\n    link "Docs"`,
      serializeTree(el),
    );
    expect(r.pass).toBe(true);
  });
});

// ─── typography folding + strict mode ────────────────────────────────────────

describe("verifyContract — typography and strict", () => {
  it("folds smart quotes in names (containment)", () => {
    // Rendered with a curly apostrophe; the contract types a straight one.
    const el = mount(`<button aria-label="Don’t save">x</button>`);
    expect(verifyContract(`button "Don't save"`, serializeTree(el)).pass).toBe(
      true,
    );
  });

  it("strict: the same page fails equality against a partial contract", () => {
    expect(
      verifyContract(LOGIN_CONTRACT, serializeTree(mount(LOGIN_CORRECT)), {
        strict: true,
      }).pass,
    ).toBe(false);
  });

  it("strict: passes against its own serialized snapshot", () => {
    const text = serializeTree(mount(LOGIN_CORRECT));
    expect(verifyContract(text, text, { strict: true }).pass).toBe(true);
  });

  it("strict is byte-exact on names — a curly quote does NOT fold", () => {
    const el = mount(`<button aria-label="Don’t save">x</button>`);
    const text = serializeTree(el); // contains the curly apostrophe
    expect(
      verifyContract(`button "Don't save"`, text, { strict: true }).pass,
    ).toBe(false);
  });

  it("throws on an empty contract", () => {
    expect(() => verifyContract("", "main")).toThrow(/empty/);
  });
});
