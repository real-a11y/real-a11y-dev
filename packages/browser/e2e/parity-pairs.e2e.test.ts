// The parity metric's line normalizer, on its own: no browser needed.
import { describe, expect, it } from "vitest";

import { normalizePair } from "./parity.js";

describe("normalizePair", () => {
  it("reduces a line to role and name", () => {
    expect(normalizePair('  heading "Setup" (level 2)')).toBe(
      'heading "Setup"',
    );
    expect(normalizePair("  separator")).toBe("separator");
  });

  it("sets the {…} states block aside, so a state only one producer carries does not split a pair", () => {
    expect(normalizePair('checkbox "Subscribe" {checked}')).toBe(
      'checkbox "Subscribe"',
    );
    expect(normalizePair('button "x" {roledescription="slide"}')).toBe(
      normalizePair('button "x"'),
    );
    expect(
      normalizePair('treeitem "Docs" (level 2) {expanded=false, selected}'),
    ).toBe('treeitem "Docs"');
    expect(normalizePair("separator {disabled}")).toBe("separator");
  });
});
