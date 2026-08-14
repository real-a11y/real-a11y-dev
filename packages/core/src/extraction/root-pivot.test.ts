/**
 * The root you pass is the root you get — unless a pivot can only ADD.
 *
 * `resolveEffectiveRoot` widens extraction to `document.body` when a
 * portal-mounted overlay sits outside the root, so a React-portalled dropdown
 * joins the tree with its trigger. For an attached root that is loss-free:
 * body is a superset. For a DETACHED one it is not — body is a disjoint tree,
 * so the caller's own subtree vanished and the audit described markup they
 * never passed. `collectFindings` then reported *no findings* for a component
 * that had real ones. Found running the published package from npm (R35).
 */
import { describe, it, expect, beforeEach } from "vitest";

import { resolveEffectiveRoot } from "./dom-extractor.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

function page(html: string): void {
  document.body.innerHTML = html;
}

/** A root that was never appended — the jsdom-fixture and pre-mount shapes. */
function detached(html = `<button>Save</button>`): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

describe("a detached root is never pivoted away", () => {
  it("survives a portalled live region", () => {
    page(`<p role="status">4 tickets</p>`);
    const root = detached();
    expect(resolveEffectiveRoot(root)).toBe(root);
  });

  it("survives an open modal", () => {
    // findActiveModal never looked at `root`, so this path hijacked a detached
    // root just as readily — and it runs FIRST.
    page(
      `<div role="dialog" aria-modal="true" aria-label="Confirm">Delete?</div>`,
    );
    const root = detached();
    expect(resolveEffectiveRoot(root)).toBe(root);
  });

  it("survives a portalled menu", () => {
    page(`<div role="menu"><button>Copy</button></div>`);
    const root = detached();
    expect(resolveEffectiveRoot(root)).toBe(root);
  });

  it("a root detached mid-flight stops pivoting", () => {
    page(
      `<div id="host"><button>Save</button></div><p role="status">4 tickets</p>`,
    );
    const host = document.getElementById("host")!;
    expect(resolveEffectiveRoot(host)).toBe(document.body);

    host.remove();
    expect(resolveEffectiveRoot(host)).toBe(host);
  });
});

describe("an attached root still pivots — the feature is intact", () => {
  it("pivots for a portalled menu outside the root", () => {
    page(
      `<div id="host"><button>Open</button></div><div role="menu"><button>Copy</button></div>`,
    );
    expect(resolveEffectiveRoot(document.getElementById("host")!)).toBe(
      document.body,
    );
  });

  it("pivots to an open modal", () => {
    page(
      `<div id="host"><button>Open</button></div><div role="dialog" aria-modal="true" aria-label="C">x</div>`,
    );
    const modal = document.querySelector('[role="dialog"]')!;
    expect(resolveEffectiveRoot(document.getElementById("host")!)).toBe(modal);
  });

  it("does not pivot when the overlay is INSIDE the root", () => {
    page(
      `<div id="host"><button>Open</button><div role="menu"><button>Copy</button></div></div>`,
    );
    const host = document.getElementById("host")!;
    expect(resolveEffectiveRoot(host)).toBe(host);
  });

  it("does not pivot when there is no overlay at all", () => {
    page(`<div id="host"><button>Save</button></div><p>Just text</p>`);
    const host = document.getElementById("host")!;
    expect(resolveEffectiveRoot(host)).toBe(host);
  });
});

describe("aria-live=off declares the element inert", () => {
  it("an announcer shell switched off does not pivot", () => {
    // Component kits mount exactly this at body level, permanently.
    page(
      `<div id="host"><button>Save</button></div><div aria-live="off">idle</div>`,
    );
    const host = document.getElementById("host")!;
    expect(resolveEffectiveRoot(host)).toBe(host);
  });

  it("case and whitespace are not a loophole", () => {
    page(
      `<div id="host"><button>Save</button></div><div aria-live=" OFF ">idle</div>`,
    );
    const host = document.getElementById("host")!;
    expect(resolveEffectiveRoot(host)).toBe(host);
  });

  it("an explicit off overrides a role's implicit politeness", () => {
    page(
      `<div id="host"><button>Save</button></div><div role="status" aria-live="off">idle</div>`,
    );
    const host = document.getElementById("host")!;
    expect(resolveEffectiveRoot(host)).toBe(host);
  });

  it("polite and assertive still pivot", () => {
    for (const value of ["polite", "assertive"]) {
      page(
        `<div id="host"><button>Save</button></div><div aria-live="${value}">Saving…</div>`,
      );
      expect(resolveEffectiveRoot(document.getElementById("host")!)).toBe(
        document.body,
      );
    }
  });

  it("a CONTAINER role is an overlay regardless of aria-live", () => {
    // A dialog is an overlay because of what it is, not because it announces.
    page(
      `<div id="host"><button>Save</button></div><div role="menu" aria-live="off"><button>Copy</button></div>`,
    );
    expect(resolveEffectiveRoot(document.getElementById("host")!)).toBe(
      document.body,
    );
  });

  it("a role token list resolves to its FIRST token", () => {
    // `status` first — a live region, pivots.
    page(
      `<div id="host"><button>Save</button></div><div role="status generic">4 tickets</div>`,
    );
    expect(resolveEffectiveRoot(document.getElementById("host")!)).toBe(
      document.body,
    );
  });

  it("a token list whose first token is not an overlay does NOT pivot", () => {
    // The selector matches this (`~=` sees `status` anywhere in the list) but
    // `generic` is the role that actually wins, so it is not a live region.
    page(
      `<div id="host"><button>Save</button></div><div role="generic status">4 tickets</div>`,
    );
    const host = document.getElementById("host")!;
    expect(resolveEffectiveRoot(host)).toBe(host);
  });
});
