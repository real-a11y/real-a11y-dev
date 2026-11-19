import { serializeTree } from "@real-a11y-dev/serialize";
import { describe, it, expect } from "vitest";

import { parseA11yTree, verifyContract } from "./contract.js";

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

  it("reads a {…} states block into tokens, with the level and focus around it", () => {
    const { roots } = parseA11yTree(
      [
        'form "Sign up"',
        '  checkbox "Subscribe" {checked}',
        '  button "Menu" (level 2) {expanded=false, haspopup=menu} [focused]',
      ].join("\n"),
    );
    const [checkbox, button] = roots[0]!.children;
    expect(roots[0]!.states).toBeUndefined();
    expect(checkbox).toMatchObject({
      role: "checkbox",
      name: "Subscribe",
      states: ["checked"],
    });
    expect(button).toMatchObject({
      role: "button",
      name: "Menu",
      level: 2,
      focused: true,
      states: ["expanded=false", "haspopup=menu"],
    });
  });

  it("keeps a JSON string holding a separator as one token", () => {
    const { roots } = parseA11yTree(
      'textbox "Email" {required, description="Work, or personal"}',
    );
    expect(roots[0]!.states).toEqual([
      "required",
      'description="Work, or personal"',
    ]);
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

// ─── states blocks ───────────────────────────────────────────────────────────

describe("verifyContract — states blocks", () => {
  const RECEIVED = [
    'form "Sign up"',
    '  textbox "Email" {required, description="We don’t share it"}',
    '  checkbox "Subscribe" {checked=false}',
    '  button "Join"',
  ].join("\n");

  it("a contract line without a block says nothing about states", () => {
    expect(
      verifyContract('form "Sign up"\n  checkbox "Subscribe"', RECEIVED).pass,
    ).toBe(true);
  });

  it("a block asserts at least its tokens, in any order", () => {
    expect(
      verifyContract('checkbox "Subscribe" {checked=false}', RECEIVED).pass,
    ).toBe(true);
    expect(verifyContract('textbox "Email" {required}', RECEIVED).pass).toBe(
      true,
    );
  });

  it("fails when the received node lacks a token, naming the node with its block", () => {
    const result = verifyContract(
      'form "Sign up"\n  checkbox "Subscribe" {checked}',
      RECEIVED,
    );
    expect(result.pass).toBe(false);
    expect(result.message).toContain('checkbox "Subscribe" {checked}');
    expect(result.message).toContain(
      'checkbox "Subscribe" {checked=false} (line 3)',
    );
  });

  it("says which tokens are missing, not that the name differs", () => {
    const { message } = verifyContract(
      'checkbox "Subscribe" {checked}',
      RECEIVED,
    );
    expect(message).toContain(
      'same role and name, missing checked: checkbox "Subscribe" {checked=false} (line 3)',
    );
    expect(message).not.toContain("different name");
  });

  it("explains a failure against a tree that prints no blocks at all", () => {
    const { pass, message } = verifyContract(
      'checkbox "Subscribe" {checked}',
      'form "Sign up"\n  checkbox "Subscribe"',
    );
    expect(pass).toBe(false);
    expect(message).toContain("the received tree prints no {…} states blocks");
  });

  it('decodes a quoted value, so a typed \\" matches a curly double quote', () => {
    const received = 'textbox "Q" {description="Say “hi”"}';
    expect(
      verifyContract(
        String.raw`textbox "Q" {description="Say \"hi\""}`,
        received,
      ).pass,
    ).toBe(true);
  });

  it("fails against a received node with no block at all", () => {
    expect(verifyContract('button "Join" {disabled}', RECEIVED).pass).toBe(
      false,
    );
  });

  it("folds typography in a token, as it does in names", () => {
    expect(
      verifyContract(
        `textbox "Email" {description="We don't share it"}`,
        RECEIVED,
      ).pass,
    ).toBe(true);
  });

  it("needs every token of a block, in any order", () => {
    const received = 'textbox "Email" {required, invalid, description="x"}';
    expect(
      verifyContract('textbox "Email" {invalid, required}', received).pass,
    ).toBe(true);
    const { pass, message } = verifyContract(
      'textbox "Email" {required, readonly}',
      received,
    );
    expect(pass).toBe(false);
    expect(message).toContain("same role and name, missing readonly:");
  });

  it("{} asserts the node has no states", () => {
    expect(verifyContract('button "Join" {}', RECEIVED).pass).toBe(true);
    const { pass, message } = verifyContract(
      'checkbox "Subscribe" {}',
      RECEIVED,
    );
    expect(pass).toBe(false);
    expect(message).toContain(
      'same role and name, has states {checked=false}: checkbox "Subscribe" {checked=false} (line 3)',
    );
  });

  it("names the node whose states differ even past the first three of its role", () => {
    const received = [
      'form "Prefs"',
      '  checkbox "Email me" {checked}',
      '  checkbox "Text me" {checked=false}',
      '  checkbox "Call me" {checked=false}',
      '  checkbox "Post me" {checked=false}',
      '  checkbox "Subscribe" {checked=false}',
    ].join("\n");
    const { message } = verifyContract(
      'form "Prefs"\n  checkbox "Subscribe" {checked}',
      received,
    );
    expect(message).toContain(
      'same role and name, missing checked: checkbox "Subscribe" {checked=false} (line 6)',
    );
  });

  it("names the node under the matched parent even when a full match sits elsewhere", () => {
    const received = [
      'row "Alice"',
      '  checkbox "Select" {checked=false}',
      'row "Bob"',
      '  checkbox "Select" {checked}',
    ].join("\n");
    const { message } = verifyContract(
      'row "Alice"\n  checkbox "Select" {checked}',
      received,
    );
    expect(message).toContain(
      'same role and name, missing checked: checkbox "Select" {checked=false} (line 2)',
    );
  });

  it("an unnamed contract line says 'same role', not 'same role and name'", () => {
    const { message } = verifyContract("checkbox {checked}", RECEIVED);
    expect(message).toContain("same role, missing checked:");
    expect(message).not.toContain("same role and name");
  });

  it("reads a field value printed before the block, and asserts one when written", () => {
    const received = 'textbox "Email" = "a@b.c" {required}';
    expect(verifyContract('textbox "Email" {required}', received).pass).toBe(
      true,
    );
    expect(verifyContract('textbox "Email" = "a@b.c"', received).pass).toBe(
      true,
    );
    const { pass, message } = verifyContract(
      'textbox "Email" = "x@y.z"',
      received,
    );
    expect(pass).toBe(false);
    expect(message).toContain("same role, different value:");
  });

  it("names a level mismatch as a different level, not a different name", () => {
    const { message } = verifyContract(
      'heading "Setup" (level 3)',
      'heading "Setup" (level 2)',
    );
    expect(message).toContain(
      'same role, different level: heading "Setup" (level 2) (line 1)',
    );
  });

  it("a parse error on a line with a block points at escapes", () => {
    expect(() =>
      verifyContract('textbox "Email" {description="Say "hi""}', RECEIVED),
    ).toThrow(/String\.raw/);
  });

  describe("strict", () => {
    const contract = (email: string, checkbox: string) =>
      ['form "Sign up"', `  ${email}`, `  ${checkbox}`, '  button "Join"'].join(
        "\n",
      );

    it("a line without a block still says nothing about states", () => {
      expect(
        verifyContract(
          contract('textbox "Email"', 'checkbox "Subscribe"'),
          RECEIVED,
          { strict: true },
        ).pass,
      ).toBe(true);
    });

    it("a block must hold exactly the received tokens, in any order", () => {
      const exact = contract(
        `textbox "Email" {description="We don’t share it", required}`,
        'checkbox "Subscribe" {checked=false}',
      );
      expect(verifyContract(exact, RECEIVED, { strict: true }).pass).toBe(true);
      const subset = contract(
        'textbox "Email" {required}',
        'checkbox "Subscribe"',
      );
      const result = verifyContract(subset, RECEIVED, { strict: true });
      expect(result.pass).toBe(false);
      expect(result.message).toContain('  -   textbox "Email" {required}');
    });

    it("shows a received node with no states as {}, which a contract can write", () => {
      const { message } = verifyContract(
        contract('textbox "Email"', 'checkbox "Subscribe"').replace(
          'button "Join"',
          'button "Join" {disabled}',
        ),
        RECEIVED,
        { strict: true },
      );
      expect(message).toContain('  -   button "Join" {disabled}');
      expect(message).toMatch(/^ {2}\+ {3}button "Join" \{\}$/m);
    });

    it("diffs structure without blocks when the shapes differ", () => {
      const { pass, message } = verifyContract(
        [
          'form "Sign up"',
          '  link "Terms"',
          '  textbox "Email" {required}',
          '  checkbox "Subscribe"',
          '  button "Join"',
        ].join("\n"),
        RECEIVED,
        { strict: true },
      );
      expect(pass).toBe(false);
      // Only the extra link differs; no block shows up on lines that don't
      // correspond.
      expect(message).toContain('  -   link "Terms"');
      expect(message).not.toMatch(/^ {2}[-+].*\{/m);
    });

    it("{} catches a node that gained a state", () => {
      const received = RECEIVED.replace(
        'button "Join"',
        'button "Join" {disabled}',
      );
      const { pass } = verifyContract(
        contract('textbox "Email"', 'checkbox "Subscribe"').replace(
          'button "Join"',
          'button "Join" {}',
        ),
        received,
        { strict: true },
      );
      expect(pass).toBe(false);
    });

    it("shows each side's block as written, comparing them sorted", () => {
      const received = 'textbox "E" {required, description="x"}';
      const { message } = verifyContract(
        'textbox "E" {required, invalid, description="x"}',
        received,
        { strict: true },
      );
      expect(message).toContain(
        '  - textbox "E" {required, invalid, description="x"}',
      );
      expect(message).toContain('  + textbox "E" {required, description="x"}');
    });

    it("notes a received tree that prints no blocks", () => {
      const { message } = verifyContract(
        'checkbox "A" {checked}',
        'checkbox "A"',
        { strict: true },
      );
      expect(message).toContain(
        "note: the received tree prints no {…} states blocks",
      );
    });

    it("is byte-exact on tokens, as on names", () => {
      const folded = contract(
        `textbox "Email" {description="We don't share it", required}`,
        'checkbox "Subscribe"',
      );
      expect(verifyContract(folded, RECEIVED, { strict: true }).pass).toBe(
        false,
      );
    });
  });
});

// ─── ambiguity: proving a mismatch must stay decidable ───────────────────────

describe("verifyContract — ambiguous contracts stay decidable", () => {
  /** A list of `n` indistinguishable items — every one matches an unnamed
   *  `listitem`, which is what makes the search space combinatorial. */
  function bigList(n: number, extra = ""): string {
    const items = Array.from(
      { length: n },
      (_, i) => `<li>item ${i}</li>`,
    ).join("");
    return serializeTree(mount(`<ul role="list">${items}${extra}</ul>`));
  }

  it("returns a verdict, not a thrown error, when an unnamed contract FAILS", () => {
    // An unnamed contract node matches every same-role node, so proving a
    // mismatch means exhausting the combinations — C(200, 8) here. Memoized
    // failure states keep that polynomial; without them the step guard trips
    // and throws, turning a legitimate mismatch into an opaque engine error
    // (and making `.not.toMatchA11yContract()` throw instead of pass).
    const contract = [
      "list",
      ...Array<string>(8).fill("  listitem"),
      '  button "Never"',
    ].join("\n");

    const r = verifyContract(contract, bigList(200));
    expect(r.pass).toBe(false);
    expect(r.matched).toBe(9);
    expect(r.message).toContain('✖ button "Never"');
  });

  it("still finds a match when the same ambiguous contract IS satisfiable", () => {
    // Memoizing failures must not prune a reachable solution.
    const contract = [
      "list",
      ...Array<string>(8).fill("  listitem"),
      '  button "Go"',
    ].join("\n");

    const target = bigList(200, "<li><button>Go</button></li>");
    expect(verifyContract(contract, target).pass).toBe(true);
  });
});

describe("verifyContract — diagnostics fold typography too", () => {
  it("hints 'same name, different role' when the rendered name uses smart quotes", () => {
    // Rendered as a LINK with a curly apostrophe; the contract wants a BUTTON
    // typed with a straight one. The role swap is the bug to surface, so the
    // hint's name comparison must fold typography the way matching does —
    // otherwise the clearest explanation is silently dropped.
    const el = mount(`<main><a href="/save">Don’t save</a></main>`);
    const r = verifyContract(`main\n  button "Don't save"`, serializeTree(el));

    expect(r.pass).toBe(false);
    expect(r.message).toContain("same name, different role");
    expect(r.message).toContain("is the button rendered as a link?");
  });
});
