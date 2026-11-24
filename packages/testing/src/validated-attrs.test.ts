import { describe, expect, it } from "vitest";

import { computedAriaAttributes } from "./validated-attrs.js";

describe("computedAriaAttributes", () => {
  it("writes each property under its aria attribute, and skips a key with none", () => {
    expect(
      computedAriaAttributes({
        states: { expanded: true },
        properties: { haspopup: "menu", captions: "false", level: "2" },
      }),
    ).toEqual({
      "aria-expanded": true,
      "aria-haspopup": "menu",
      "aria-level": "2",
    });
  });

  it("never writes a camelCase aria-hasPopup or an aria-captions", () => {
    const attrs = computedAriaAttributes({
      states: {},
      properties: { haspopup: "menu", captions: "false" },
    });
    expect(attrs).not.toHaveProperty("aria-hasPopup");
    expect(attrs).not.toHaveProperty("aria-captions");
  });
});
