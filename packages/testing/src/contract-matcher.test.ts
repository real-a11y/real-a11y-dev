import { describe, it, expect, beforeAll } from "vitest";

import { registerA11yMatchers } from "./matchers.js";

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

const CORRECT = `
  <main>
    <h1>Sign in</h1>
    <form aria-label="Sign in">
      <div role="group" aria-label="Credentials">
        <input type="text" aria-label="Email address" />
        <input type="text" aria-label="Password" />
      </div>
      <button>Sign in</button>
    </form>
  </main>
`;
const BROKEN = CORRECT.replace(
  "<button>Sign in</button>",
  `<div onclick="submit()">Sign in</div>`,
);
const CONTRACT = `main
  heading "Sign in" (level 1)
  form
    textbox "Email address"
    textbox "Password"
    button "Sign in"`;

describe("toMatchA11yContract", () => {
  it("passes when a DOM Element satisfies the contract (containment)", () => {
    expect(mount(CORRECT)).toMatchA11yContract(CONTRACT);
  });

  it("fails (with .not) when a node is missing, and throws a pinpointed message", () => {
    const broken = mount(BROKEN);
    expect(broken).not.toMatchA11yContract(CONTRACT);
    expect(() => expect(broken).toMatchA11yContract(CONTRACT)).toThrow(
      /button "Sign in".*not found under form/s,
    );
  });

  it("accepts an already-serialized tree string", () => {
    // A committed snapshot / CLI artifact, not a live Element.
    const snapshot = `main
  heading "Sign in" (level 1)
  button "Sign in"`;
    expect(snapshot).toMatchA11yContract(`main\n  button "Sign in"`);
  });

  it("strict: exact equality — a partial contract fails, the full snapshot passes", () => {
    const el = mount(CORRECT);
    expect(el).not.toMatchA11yContract(CONTRACT, { strict: true });
    // Its own serialization matches itself exactly.
    const full = `main
  heading "Sign in" (level 1)
  form "Sign in"
    group "Credentials"
      textbox "Email address"
      textbox "Password"
    button "Sign in"`;
    expect(el).toMatchA11yContract(full, { strict: true });
  });

  it("folds smart-quote typography in names", () => {
    const el = mount(`<button aria-label="Don’t save">x</button>`);
    expect(el).toMatchA11yContract(`button "Don't save"`);
  });

  it("reports a clear error when given a non-Element, non-string", () => {
    expect(() => expect(42).toMatchA11yContract(`main`)).toThrow(
      /expected a DOM Element or a serialized tree string/,
    );
  });
});

describe("toMatchA11yContract — states blocks against an element", () => {
  const html = `<form aria-label="Sign up">
    <input type="checkbox" checked aria-label="Subscribe">
    <input type="email" required aria-label="Email" aria-describedby="h">
    <p id="h" hidden>We never share it</p>
  </form>`;

  it("checks a block against the element's tree", () => {
    const el = mount(html);
    expect(el).toMatchA11yContract('checkbox "Subscribe" {checked}');
    expect(el).toMatchA11yContract(
      'textbox "Email" {description="We never share it", required}',
    );
    expect(el).not.toMatchA11yContract('checkbox "Subscribe" {checked=false}');
  });

  it("fails the negated form on a block that matches", () => {
    const el = mount(html);
    expect(() =>
      expect(el).not.toMatchA11yContract('checkbox "Subscribe" {checked}'),
    ).toThrow();
  });

  it("names the missing state when the element's state differs", () => {
    const el = mount(html);
    expect(() =>
      expect(el).toMatchA11yContract('checkbox "Subscribe" {checked=false}'),
    ).toThrow(/same role and name, missing checked=false/);
  });

  it("checks a block in strict mode, and {} for a node with none", () => {
    const el = mount(html);
    expect(el).toMatchA11yContract(
      [
        'form "Sign up"',
        '  checkbox "Subscribe" {checked}',
        '  textbox "Email" {required, description="We never share it"}',
      ].join("\n"),
      { strict: true },
    );
    expect(el).not.toMatchA11yContract(
      [
        'form "Sign up" {}',
        '  checkbox "Subscribe" {}',
        '  textbox "Email"',
      ].join("\n"),
      { strict: true },
    );
  });
});

describe("toMatchA11yContract — field values against an element", () => {
  const html = `<form aria-label="Sign up"><input type="text" aria-label="Email" value="a@b.c"></form>`;

  it("checks a written value against the element's tree with values on", () => {
    const el = mount(html);
    expect(el).toMatchA11yContract('textbox "Email" = "a@b.c"');
    expect(el).not.toMatchA11yContract('textbox "Email" = "x@y.z"');
    expect(() =>
      expect(el).not.toMatchA11yContract('textbox "Email" = "a@b.c"'),
    ).toThrow();
  });

  it("checks it in strict mode too", () => {
    const el = mount(html);
    const contract = 'form "Sign up"\n  textbox "Email" = "a@b.c"';
    expect(el).toMatchA11yContract(contract, { strict: true });
    expect(el).not.toMatchA11yContract(contract.replace("a@b.c", "x@y.z"), {
      strict: true,
    });
  });

  it("leaves the tree without values when the contract writes none", () => {
    const el = mount(html);
    expect(el).toMatchA11yContract('form "Sign up"\n  textbox "Email"', {
      strict: true,
    });
  });
});

describe("toMatchA11yContract — native-only keys against an element", () => {
  const html = `<button aria-expanded="false" aria-haspopup="menu" aria-roledescription="slide">Menu</button>`;

  it("throws for haspopup and roledescription, with or without .not", () => {
    const el = mount(html);
    for (const block of [
      "{expanded=false, haspopup=menu}",
      '{roledescription="slide"}',
    ]) {
      const contract = `button "Menu" ${block}`;
      expect(() => expect(el).toMatchA11yContract(contract)).toThrow(
        /a DOM Element's tree never carries/,
      );
      expect(() => expect(el).not.toMatchA11yContract(contract)).toThrow(
        /a DOM Element's tree never carries/,
      );
    }
  });

  it("still checks them against native tree text", () => {
    expect('button "Menu" {expanded=false, haspopup=menu}').toMatchA11yContract(
      'button "Menu" {haspopup=menu}',
    );
    expect(mount(html)).toMatchA11yContract('button "Menu" {expanded=false}');
  });
});
