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
 *
 * COVERAGE CAVEAT: `Element.checkVisibility` does not exist in jsdom, so every
 * case here exercises only the manual-walk fallback of `isActuallyVisible`.
 * The branch that runs in Chrome, the extension and the page-bundle is not
 * covered by this file — `packages/testing/e2e` is where that gets exercised.
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

  it("a root inside a shadow root is never pivoted away", () => {
    // `isConnected` is shadow-including, so it read this root as connected —
    // but the walk is light-DOM only, so widening to body replaced a web
    // component's entire subtree with the host page. `doc.contains` is not
    // shadow-including, which is exactly why it covers this.
    page(`<div id="wc"></div><p role="status">4 tickets</p>`);
    const shadow = document
      .getElementById("wc")!
      .attachShadow({ mode: "open" });
    const root = document.createElement("div");
    root.innerHTML = `<button>Save</button>`;
    shadow.appendChild(root);

    expect(root.isConnected).toBe(true); // the reason the old guard missed it
    expect(resolveEffectiveRoot(root)).toBe(root);
  });

  it("a shadow root is not hijacked by an open modal either", () => {
    page(
      `<div id="wc"></div><div role="dialog" aria-modal="true" aria-label="C">x</div>`,
    );
    const shadow = document
      .getElementById("wc")!
      .attachShadow({ mode: "open" });
    const root = document.createElement("div");
    root.innerHTML = `<button>Save</button>`;
    shadow.appendChild(root);

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

  it("pivots to a modal that CONTAINS the root", () => {
    page(
      `<div role="dialog" aria-modal="true" aria-label="C"><div id="host"><button>Open</button></div></div>`,
    );
    const modal = document.querySelector('[role="dialog"]')!;
    expect(resolveEffectiveRoot(document.getElementById("host")!)).toBe(modal);
  });

  it("pivots to a SIBLING modal too — deliberate, and it is data loss", () => {
    // Not an oversight: content behind a modal is inert to AT, so "the page is
    // showing a dialog" is the honest answer for anything on that page, and
    // dom-extractor.test.ts asserts the same thing ("the page behind it is
    // dropped"). The cost is real — auditing #host here describes the dialog
    // and says nothing about #host — so it is written down rather than left to
    // be discovered. Changing it is a decision about modelling AT, not a bug
    // fix, and does not belong in a change about detached roots.
    page(
      `<div id="host"><button>Open</button></div><div role="dialog" aria-modal="true" aria-label="C">x</div>`,
    );
    const modal = document.querySelector('[role="dialog"]')!;
    expect(resolveEffectiveRoot(document.getElementById("host")!)).toBe(modal);
  });

  it("KNOWN GAP (R35 step 1): a sibling live region still widens an attached root", () => {
    // Deliberately open, and asserted so it stays visible. "Outside the root"
    // cannot tell an ordinary in-page live region from a portal, so a result
    // count elsewhere on the page turns a component snapshot into a page
    // snapshot. Loss-free — the document contains the root — but silent.
    //
    // If this starts failing, the gap closed: narrow R35's Expected 1 and drop
    // the Troubleshooting workarounds with it.
    page(
      `<div id="host"><button>Save</button></div><p role="status">4 tickets</p>`,
    );
    expect(resolveEffectiveRoot(document.getElementById("host")!)).toBe(
      document.body,
    );
  });

  it("does NOT pivot for an ANCESTOR live region", () => {
    // The SPA route-announcer shape — Next.js, Remix and React Router all ship
    // an aria-live wrapper around the whole app. An ancestor is not a portal
    // by any definition, and treating it as one pivoted every component root
    // on the page permanently, not just while a toast was up.
    page(
      `<main aria-live="polite"><div id="host"><button>Save</button></div></main>`,
    );
    const host = document.getElementById("host")!;
    expect(resolveEffectiveRoot(host)).toBe(host);
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

  // One `it` per value: looping inside a single case meant a regression in
  // `polite` aborted before `assertive` ran, and the message named neither.
  for (const value of ["polite", "assertive"]) {
    it(`aria-live="${value}" still pivots`, () => {
      page(
        `<div id="host"><button>Save</button></div><div aria-live="${value}">Saving…</div>`,
      );
      expect(resolveEffectiveRoot(document.getElementById("host")!)).toBe(
        document.body,
      );
    });
  }

  // An allowlist, not `!== "off"`. A denylist pivoted for every hand-written
  // spelling of "switched off" — the opposite of the author's intent.
  for (const value of ["none", "false", "0", "polit", "OFF"]) {
    it(`aria-live="${value}" does not pivot`, () => {
      page(
        `<div id="host"><button>Save</button></div><div aria-live="${value}">idle</div>`,
      );
      const host = document.getElementById("host")!;
      expect(resolveEffectiveRoot(host)).toBe(host);
    });
  }

  it("a bare or empty aria-live falls through to the role's implicit value", () => {
    // ARIA maps an absent/invalid value to the role's implicit politeness, so
    // a roleless div is `off`. This DID pivot before — recorded because the
    // changeset announces only `aria-live="off"` as the narrowing.
    for (const attr of ["aria-live", 'aria-live=""', 'aria-live="   "']) {
      page(`<div id="host"><button>Save</button></div><div ${attr}>idle</div>`);
      const host = document.getElementById("host")!;
      expect(resolveEffectiveRoot(host)).toBe(host);
    }

    // …but the same attribute on a role that IS live still pivots.
    page(
      `<div id="host"><button>Save</button></div><div role="status" aria-live="">4 tickets</div>`,
    );
    expect(resolveEffectiveRoot(document.getElementById("host")!)).toBe(
      document.body,
    );
  });

  it("role case is not folded, so an off announcer stays off", () => {
    // Folding made `role="MENU"` hit the container check BEFORE the `off`
    // check, so the shell this rule exists to reject pivoted anyway — and the
    // same element got opposite scoping depending on an unrelated attribute.
    // CSS matches `role` case-sensitively, so the tree agrees: `MENU` is not
    // a menu to either.
    page(
      `<div id="host"><button>Save</button></div><div role="MENU" aria-live="off">idle</div>`,
    );
    const host = document.getElementById("host")!;
    expect(resolveEffectiveRoot(host)).toBe(host);
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
