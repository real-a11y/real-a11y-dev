import { describe, it, expect, afterEach } from "vitest";
import {
  assertNoUnlabeledInteractive,
  assertHeadingOrder,
  assertDialogsLabeled,
  assertLandmarkStructure,
} from "@real-a11y-dev/testing";
import { fixture, cleanup } from "./fixtures.js";

afterEach(cleanup);

// ─── assertNoUnlabeledInteractive ─────────────────────────────────────────────

describe("assertNoUnlabeledInteractive", () => {
  it("passes when all interactive elements are labeled", () => {
    const root = fixture(`
      <form>
        <label>
          Name <input type="text" />
        </label>
        <button type="submit">Submit</button>
        <a href="/help">Help</a>
      </form>
    `);
    expect(() => assertNoUnlabeledInteractive(root)).not.toThrow();
  });

  it("throws when a button has no label", () => {
    const root = fixture(`
      <div>
        <button type="button"><!-- icon only, no text --></button>
      </div>
    `);
    expect(() => assertNoUnlabeledInteractive(root)).toThrow("unlabeled");
  });

  it("throws when an input has no label or aria-label", () => {
    const root = fixture(`
      <form>
        <input type="email" />
        <button type="submit">Subscribe</button>
      </form>
    `);
    // No label, no aria-label, no aria-labelledby — must fail
    expect(() => assertNoUnlabeledInteractive(root)).toThrow();
  });
});

// ─── assertHeadingOrder ───────────────────────────────────────────────────────

describe("assertHeadingOrder", () => {
  it("passes with a correct heading hierarchy", () => {
    const root = fixture(`
      <main>
        <h1>Title</h1>
        <h2>Section A</h2>
        <h3>Subsection</h3>
        <h2>Section B</h2>
      </main>
    `);
    expect(() => assertHeadingOrder(root)).not.toThrow();
  });

  it("throws when there is no h1", () => {
    const root = fixture(`
      <main>
        <h2>Section</h2>
        <h3>Subsection</h3>
      </main>
    `);
    expect(() => assertHeadingOrder(root)).toThrow();
  });

  it("throws when levels are skipped", () => {
    const root = fixture(`
      <main>
        <h1>Title</h1>
        <h3>Jumped from h1 to h3</h3>
      </main>
    `);
    expect(() => assertHeadingOrder(root)).toThrow();
  });
});

// ─── assertDialogsLabeled ─────────────────────────────────────────────────────

describe("assertDialogsLabeled", () => {
  it("passes when dialog has aria-labelledby", () => {
    const root = fixture(`
      <div>
        <h2 id="dlg-title">Confirm</h2>
        <dialog aria-labelledby="dlg-title" open>
          <p>Are you sure?</p>
        </dialog>
      </div>
    `);
    expect(() => assertDialogsLabeled(root)).not.toThrow();
  });

  it("throws for an unlabeled dialog", () => {
    const root = fixture(`
      <dialog open>
        <p>Some content without a label</p>
      </dialog>
    `);
    expect(() => assertDialogsLabeled(root)).toThrow();
  });
});

// ─── assertLandmarkStructure ──────────────────────────────────────────────────

describe("assertLandmarkStructure", () => {
  it("passes with one main, one header, one footer", () => {
    const root = fixture(`
      <div>
        <header><nav aria-label="Main">...</nav></header>
        <main><h1>Page</h1></main>
        <footer>Footer content</footer>
      </div>
    `);
    expect(() => assertLandmarkStructure(root)).not.toThrow();
  });

  it("throws with no main landmark", () => {
    const root = fixture(`
      <div>
        <header>Header</header>
        <article>Content (not a main)</article>
        <footer>Footer</footer>
      </div>
    `);
    expect(() => assertLandmarkStructure(root)).toThrow();
  });

  it("throws with two main landmarks", () => {
    const root = fixture(`
      <div>
        <main>First main</main>
        <main>Second main</main>
      </div>
    `);
    expect(() => assertLandmarkStructure(root)).toThrow();
  });
});
