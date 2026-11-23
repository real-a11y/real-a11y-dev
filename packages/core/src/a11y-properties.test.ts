import { describe, expect, it } from "vitest";

import {
  A11Y_PROPERTIES,
  a11yPropertyInfo,
  ariaAttributeOfProperty,
  nativePropertyKey,
} from "./a11y-properties.js";

describe("the a11y.properties key table", () => {
  it("spells every key as its ARIA attribute without aria-, lowercase", () => {
    for (const row of A11Y_PROPERTIES) {
      if (row.aria === null) continue;
      expect(row.aria).toBe(`aria-${row.key}`);
      expect(row.key).toBe(row.key.toLowerCase());
    }
  });

  it("never lists a value, which has one home in a11y.value", () => {
    const keys = A11Y_PROPERTIES.map((r) => r.key);
    expect(keys).not.toContain("valuenow");
    expect(keys).not.toContain("valuetext");
  });

  it("has no duplicate key", () => {
    const keys = A11Y_PROPERTIES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("maps Chromium's hasPopup to haspopup and keeps the other names", () => {
    expect(nativePropertyKey("hasPopup")).toBe("haspopup");
    expect(nativePropertyKey("haspopup")).toBe("haspopup");
    expect(nativePropertyKey("roledescription")).toBe("roledescription");
    expect(nativePropertyKey("level")).toBe("level");
  });

  it("keeps no Chromium property outside the table, and no DOM-only key", () => {
    expect(nativePropertyKey("valuenow")).toBeUndefined();
    expect(nativePropertyKey("valuetext")).toBeUndefined();
    expect(nativePropertyKey("describedby")).toBeUndefined();
    expect(nativePropertyKey("captions")).toBeUndefined();
  });

  it("answers the ARIA attribute of a key", () => {
    expect(ariaAttributeOfProperty("haspopup")).toBe("aria-haspopup");
    expect(ariaAttributeOfProperty("captions")).toBeNull();
    expect(ariaAttributeOfProperty("nonsense")).toBeNull();
    expect(a11yPropertyInfo("captions")?.producers).toBe("dom");
  });
});
