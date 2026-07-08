// COMPLEX: the matchers working together on a realistic page, including a
// state change driven by `flow()`.
//
// This is closer to how you'd actually use the library: a handful of matchers
// act as a single "accessibility gate" over a rendered screen, an a11ySnapshot
// guards the semantic structure against regressions, and after an interaction
// opens a dialog we re-assert that the new state is still accessible.
import { describe, it, expect, afterEach } from "vitest";

import { flow } from "@real-a11y-dev/testing";
import { a11ySnapshot } from "@real-a11y-dev/testing/matchers";

import { fixture, cleanup } from "./fixtures.js";

afterEach(cleanup);

/**
 * Render a small but realistic "Account settings" screen: proper landmarks,
 * a heading outline, a labeled form, and a destructive action that opens a
 * confirmation dialog. The dialog is wired to open on click — the kind of
 * imperative behavior a real component would own.
 */
function renderAccountPage(): Element {
  const root = fixture(`
    <div>
      <header>
        <nav aria-label="Primary">
          <a href="/">Home</a>
          <a href="/settings">Settings</a>
        </nav>
      </header>

      <main>
        <h1>Account settings</h1>

        <section aria-labelledby="profile-h">
          <h2 id="profile-h">Profile</h2>
          <form aria-label="Profile">
            <label>Display name <input type="text" value="Ada" /></label>
            <label>Email <input type="email" value="ada@example.com" /></label>
            <button type="submit">Save changes</button>
          </form>
        </section>

        <section aria-labelledby="danger-h">
          <h2 id="danger-h">Danger zone</h2>
          <p>Account ID: 8f3a-2b91-cc40</p>
          <button type="button" id="delete">Delete account</button>
        </section>
      </main>

      <footer>© 2026 Example Inc.</footer>
    </div>
  `);

  // Imperative behavior: clicking "Delete account" appends a labeled,
  // properly-structured confirmation dialog into <main>.
  const main = root.querySelector("main")!;
  root.querySelector("#delete")!.addEventListener("click", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    // Genuinely modal (as the APG dialog pattern and every mainstream modal
    // library emit) — content behind it is inert, so the tree scopes to it.
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "confirm-title");
    dialog.innerHTML = `
      <h2 id="confirm-title">Delete account?</h2>
      <p>This cannot be undone.</p>
      <button type="button">Cancel</button>
      <button type="button">Delete</button>
    `;
    main.appendChild(dialog);
  });

  return root;
}

describe("account page — accessibility gate", () => {
  it("passes every structural matcher in its initial state", () => {
    const root = renderAccountPage();

    // One assertion block reads like an a11y checklist for the screen.
    expect(root).toHaveValidLandmarks();
    expect(root).toHaveValidHeadingOrder();
    expect(root).toHaveNoUnlabeledInteractive();
    expect(root).toHaveLabeledDialogs(); // vacuously true — no dialogs yet
  });

  it("guards the semantic structure with a redacted snapshot", () => {
    const root = renderAccountPage();

    // The account ID is dynamic — redact it so the snapshot stays stable
    // across runs while still capturing the full role/name structure.
    expect(
      a11ySnapshot(root, {
        redact: [/[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}/gi],
      }),
    ).toMatchSnapshot();
  });

  it("documents the keyboard path through the form", () => {
    const root = renderAccountPage();

    expect(root).toHaveTabSequence([
      'link "Home"',
      'link "Settings"',
      'textbox "Display name"',
      'textbox "Email"',
      'button "Save changes"',
      'button "Delete account"',
    ]);
  });
});

describe("account page — after opening the confirm dialog", () => {
  it("scopes the a11y tree to the modal, and the modal is accessible", async () => {
    const root = renderAccountPage();

    // Drive the real interaction through flow() — same path a user takes.
    await flow(root).findByRole("button", { name: "Delete account" }).click();

    // Modal semantics: with a dialog active, content behind it is inert to
    // assistive tech, so the extracted tree pivots to the dialog. The gate
    // we care about now is that the *dialog itself* is accessible.
    expect(root).toHaveLabeledDialogs();
    expect(root).toHaveNoUnlabeledInteractive();

    // Focus is effectively trapped: only the dialog's own controls remain in
    // the tab order — the form fields behind it have dropped out.
    expect(root).toHaveTabSequence(['button "Cancel"', 'button "Delete"']);

    // The snapshot captures the scoped tree (dialog only) — a precise
    // regression artifact for the modal state.
    expect(a11ySnapshot(root)).toMatchSnapshot();
  });
});
