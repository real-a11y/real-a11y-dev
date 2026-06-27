// Minimal proof that `@real-a11y-dev/testing/matchers` works under Jest:
// the matchers register via `expect.extend`, the global `jest.Matchers` type
// augmentation applies, and the snapshot serializer renders the semantic tree.
//
// This mirrors a slice of the Vitest example — the runtime matchers are
// framework-agnostic, so this exists to guard the *Jest* registration and
// typing path specifically, not to re-test the matcher logic.
import { a11ySnapshot } from "@real-a11y-dev/testing/matchers";

function mount(html: string): Element {
  document.body.innerHTML = "";
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  return container;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("assertion matchers under Jest", () => {
  it("toHaveValidLandmarks passes for one main and negates correctly", () => {
    expect(
      mount(`
        <div>
          <header><nav aria-label="Primary">…</nav></header>
          <main><h1>Page</h1></main>
          <footer>©</footer>
        </div>
      `),
    ).toHaveValidLandmarks();

    expect(
      mount(`<div><main>One</main><main>Two</main></div>`),
    ).not.toHaveValidLandmarks();
  });

  it("toHaveNoUnlabeledInteractive flags an icon-only button", () => {
    expect(
      mount(`
        <form>
          <label>Email <input type="email" /></label>
          <button type="submit">Subscribe</button>
        </form>
      `),
    ).toHaveNoUnlabeledInteractive();

    expect(
      mount(`<button type="button"><svg aria-hidden="true"></svg></button>`),
    ).not.toHaveNoUnlabeledInteractive();
  });

  it("toHaveTabSequence asserts the exact focus order", () => {
    const root = mount(`
      <nav aria-label="Primary">
        <a href="/">Home</a>
        <a href="/about">About</a>
      </nav>
    `);
    expect(root).toHaveTabSequence(['link "Home"', 'link "About"']);
  });
});

describe("a11ySnapshot serializer under Jest", () => {
  it("renders the semantic tree into toMatchSnapshot()", () => {
    const root = mount(`
      <main>
        <h1>Sign in</h1>
        <form aria-label="Sign-in form">
          <label>Email <input type="email" /></label>
          <button type="submit">Sign in</button>
        </form>
      </main>
    `);
    expect(a11ySnapshot(root)).toMatchSnapshot();
  });
});
