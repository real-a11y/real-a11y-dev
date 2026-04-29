import { describe, it, expect, afterEach } from "vitest";

import { extractA11yTree, buildControlsIndex } from "@real-a11y-dev/core";

import { fixture, cleanup } from "./fixtures.js";

afterEach(cleanup);

/**
 * `buildControlsIndex` resolves disclosure-pair relationships across the
 * tree — used by the Real A11y panel to render cross-link chips, but
 * equally usable in tests/audits to assert the relationships are wired
 * correctly.
 */
describe("buildControlsIndex (disclosure pairs)", () => {
  it("links a button to the menu it controls via aria-controls", () => {
    const root = fixture(`
      <div>
        <button aria-haspopup="menu" aria-controls="settings-menu" aria-expanded="true">
          Settings
        </button>
        <div id="settings-menu" role="menu" aria-label="Settings menu">
          <div role="menuitem">Account</div>
        </div>
      </div>
    `);

    const tree = extractA11yTree(root);
    const { forward, reverse, inferred } = buildControlsIndex(tree.nodes);

    // The trigger and menu both exist in the tree.
    const trigger = [...tree.nodes.values()].find(
      (n) => n.a11y.role === "button" && n.a11y.name === "Settings",
    );
    const menu = [...tree.nodes.values()].find(
      (n) => n.a11y.role === "menu",
    );
    expect(trigger).toBeDefined();
    expect(menu).toBeDefined();

    // Forward and reverse maps connect them.
    expect(forward.get(trigger!.id)).toContain(menu!.id);
    expect(reverse.get(menu!.id)).toContain(trigger!.id);

    // Explicit aria-controls — not flagged as inferred.
    expect(inferred.has(trigger!.id)).toBe(false);
  });

  it("infers the link from aria-haspopup when aria-controls is missing", () => {
    const root = fixture(`
      <div>
        <button aria-haspopup="menu" aria-expanded="true">Profile</button>
        <div role="menu" aria-label="Profile menu">
          <div role="menuitem">View</div>
        </div>
      </div>
    `);

    const tree = extractA11yTree(root);
    const { forward, inferred } = buildControlsIndex(tree.nodes);

    const trigger = [...tree.nodes.values()].find(
      (n) => n.a11y.role === "button" && n.a11y.name === "Profile",
    );
    const menu = [...tree.nodes.values()].find(
      (n) => n.a11y.role === "menu",
    );

    expect(forward.get(trigger!.id)).toContain(menu!.id);
    // Heuristic — flagged so callers can render with a "likely" affordance.
    expect(inferred.has(trigger!.id)).toBe(true);
  });

  it("does not link when the trigger is collapsed", () => {
    const root = fixture(`
      <div>
        <button aria-haspopup="menu" aria-expanded="false">Profile</button>
        <div role="menu" aria-label="Profile menu" hidden>
          <div role="menuitem">View</div>
        </div>
      </div>
    `);

    const tree = extractA11yTree(root);
    const { forward, inferred } = buildControlsIndex(tree.nodes);

    expect(forward.size).toBe(0);
    expect(inferred.size).toBe(0);
  });
});
