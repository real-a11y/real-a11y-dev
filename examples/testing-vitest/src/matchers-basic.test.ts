// SIMPLE: the custom `expect` matchers from `@real-a11y-dev/testing/matchers`.
//
// These wrap the same checks as the `assertX` functions and `auditSnapshot`,
// but read as native assertions — `.not` negation and failure messages come
// for free. Registration happens once in `./setup.ts`.
import { describe, it, expect, afterEach } from "vitest";

import { a11ySnapshot } from "@real-a11y-dev/testing/matchers";

import { fixture, cleanup } from "./fixtures.js";

afterEach(cleanup);

describe("assertion matchers", () => {
  it("toHaveNoUnlabeledInteractive — labeled controls pass, icon-only button fails", () => {
    expect(
      fixture(`
        <form>
          <label>Email <input type="email" /></label>
          <button type="submit">Subscribe</button>
        </form>
      `),
    ).toHaveNoUnlabeledInteractive();

    // An icon-only button with no accessible name is the classic offender.
    expect(
      fixture(`<button type="button"><svg aria-hidden="true"></svg></button>`),
    ).not.toHaveNoUnlabeledInteractive();
  });

  it("toHaveValidHeadingOrder — flags a skipped level", () => {
    expect(
      fixture(`<main><h1>Title</h1><h2>Section</h2></main>`),
    ).toHaveValidHeadingOrder();

    expect(
      fixture(`<main><h1>Title</h1><h3>Jumped a level</h3></main>`),
    ).not.toHaveValidHeadingOrder();
  });

  it("toHaveLabeledDialogs — dialog needs an accessible name", () => {
    expect(
      fixture(`
        <div>
          <h2 id="t">Confirm delete</h2>
          <dialog aria-labelledby="t" open><p>Are you sure?</p></dialog>
        </div>
      `),
    ).toHaveLabeledDialogs();

    expect(
      fixture(`<dialog open><p>No label here</p></dialog>`),
    ).not.toHaveLabeledDialogs();
  });

  it("toHaveValidLandmarks — exactly one main", () => {
    expect(
      fixture(`
        <div>
          <header><nav aria-label="Primary">…</nav></header>
          <main><h1>Page</h1></main>
          <footer>©</footer>
        </div>
      `),
    ).toHaveValidLandmarks();

    expect(
      fixture(`<div><main>One</main><main>Two</main></div>`),
    ).not.toHaveValidLandmarks();
  });
});

describe("toHaveTabSequence", () => {
  it('asserts the exact focus order as `role "name"` tokens', () => {
    const root = fixture(`
      <nav aria-label="Primary">
        <a href="/">Home</a>
        <a href="/about">About</a>
      </nav>
    `);
    expect(root).toHaveTabSequence(['link "Home"', 'link "About"']);
  });

  it("a positive tabindex jumps to the front of the order", () => {
    const root = fixture(`
      <div>
        <button>Default</button>
        <button tabindex="1">Promoted</button>
      </div>
    `);
    expect(root).toHaveTabSequence(['button "Promoted"', 'button "Default"']);
  });
});

describe("a11ySnapshot serializer", () => {
  it("renders the semantic tree (not the DOM) into toMatchSnapshot()", () => {
    const root = fixture(`
      <main>
        <h1>Sign in</h1>
        <form aria-label="Sign-in form">
          <label>Email <input type="email" /></label>
          <button type="submit">Sign in</button>
        </form>
      </main>
    `);
    // Because the serializer is registered, this snapshot is roles + names,
    // not an HTML dump — readable and resistant to non-semantic markup churn.
    expect(a11ySnapshot(root)).toMatchSnapshot();
  });
});
