import { describe, it, expect, beforeAll } from "vitest";

import { registerA11yMatchers, a11ySnapshot } from "./matchers.js";

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

describe("assertion matchers", () => {
  it("toHaveNoUnlabeledInteractive passes / fails / negates", () => {
    expect(mount(`<button>Go</button>`)).toHaveNoUnlabeledInteractive();
    expect(mount(`<button></button>`)).not.toHaveNoUnlabeledInteractive();

    expect(() =>
      expect(mount(`<button></button>`)).toHaveNoUnlabeledInteractive(),
    ).toThrow(/unlabeled interactive/i);
  });

  it("toHaveValidHeadingOrder catches a skipped level", () => {
    expect(mount(`<h1>A</h1><h2>B</h2>`)).toHaveValidHeadingOrder();
    expect(mount(`<h1>A</h1><h3>B</h3>`)).not.toHaveValidHeadingOrder();
  });

  it("toHaveLabeledDialogs requires accessible names", () => {
    expect(
      mount(`<div role="dialog" aria-label="Confirm">x</div>`),
    ).toHaveLabeledDialogs();
    expect(mount(`<div role="dialog"></div>`)).not.toHaveLabeledDialogs();
  });

  it("toHaveValidLandmarks requires exactly one main", () => {
    expect(mount(`<main>only</main>`)).toHaveValidLandmarks();
    expect(mount(`<main>a</main><main>b</main>`)).not.toHaveValidLandmarks();
  });

  it("reports a clear error when given a non-Element", () => {
    expect(() =>
      // @ts-expect-error — exercising the runtime guard
      expect("nope").toHaveValidLandmarks(),
    ).toThrow(/expected a DOM Element/);
  });
});

describe("toBeValidA11yTree", () => {
  it("passes a valid tree and fails on an ARIA error", () => {
    expect(
      mount(`<main><h1>Dashboard</h1><button>Save</button></main>`),
    ).toBeValidA11yTree();
    // an unnamed button — role "button" requires an accessible name
    expect(mount(`<button></button>`)).not.toBeValidA11yTree();
  });

  it("reports the violation in the failure message", () => {
    expect(() =>
      expect(mount(`<button></button>`)).toBeValidA11yTree(),
    ).toThrow(/ARIA violation/i);
  });
});

describe("toHaveTabSequence", () => {
  it("matches the computed Tab order (positive tabindex first)", () => {
    const root = mount(`
      <button>Zero</button>
      <button tabindex="1">First</button>
    `);
    expect(root).toHaveTabSequence(['button "First"', 'button "Zero"']);
    expect(root).not.toHaveTabSequence(['button "Zero"', 'button "First"']);
  });

  it("fails with both sequences in the message", () => {
    const root = mount(`<a href="#">Home</a>`);
    expect(() => expect(root).toHaveTabSequence(['link "Away"'])).toThrow(
      /Tab sequence mismatch[\s\S]*expected[\s\S]*actual/,
    );
  });
});

describe("a11ySnapshot serializer", () => {
  it("renders the deterministic tree via the native snapshot path", () => {
    const root = mount(`<main><h1>Hi</h1><button>Go</button></main>`);
    expect(a11ySnapshot(root)).toMatchInlineSnapshot(`
      main
          heading "Hi" (level 1)
          button "Go"
    `);
  });

  it("forwards serialize options (redaction)", () => {
    const root = mount(`<h1>Order #12345</h1>`);
    const out = a11ySnapshot(root, { redact: [/#\d+/g] });
    expect(a11ySnapshotSerializerText(out)).not.toContain("#12345");
  });
});

// Small helper so the redaction test doesn't depend on snapshot internals.
import { a11ySnapshotSerializer } from "./matchers.js";
function a11ySnapshotSerializerText(box: unknown): string {
  return a11ySnapshotSerializer.test(box)
    ? a11ySnapshotSerializer.serialize(box)
    : "";
}
