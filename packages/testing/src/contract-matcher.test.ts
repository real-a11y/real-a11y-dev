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
    // @ts-expect-error — exercising the runtime guard
    expect(() => expect(42).toMatchA11yContract(`main`)).toThrow(
      /expected a DOM Element or a serialized tree string/,
    );
  });
});
