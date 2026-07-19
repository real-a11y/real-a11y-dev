import { describe, it, expect } from "vitest";

import { foldTypography } from "./normalize.js";

describe("foldTypography", () => {
  it("folds curly single quotes / apostrophes to '", () => {
    expect(foldTypography("Don’t")).toBe("Don't"); // ’
    expect(foldTypography("‘quoted’")).toBe("'quoted'"); // ‘ ’
    expect(foldTypography("a‛b‚c")).toBe("a'b'c"); // ‛ ‚
  });

  it('folds curly double quotes to "', () => {
    expect(foldTypography("“hi”")).toBe('"hi"'); // “ ”
    expect(foldTypography("„a‟b")).toBe('"a"b'); // „ ‟
  });

  it("folds the ellipsis character to ...", () => {
    expect(foldTypography("Learn more…")).toBe("Learn more...");
  });

  it("folds en / em / horizontal-bar dashes to -", () => {
    expect(foldTypography("10:00am — 5:30pm")).toBe("10:00am - 5:30pm"); // —
    expect(foldTypography("10–20")).toBe("10-20"); // –
    expect(foldTypography("a―b")).toBe("a-b"); // ―
  });

  it("folds a non-breaking space to a normal space", () => {
    expect(foldTypography("$10 USD")).toBe("$10 USD");
  });

  it("composes accents via NFC (decomposed === composed)", () => {
    const decomposed = "café"; // e + combining acute
    const composed = "café"; // é
    expect(foldTypography(decomposed)).toBe(foldTypography(composed));
    expect(foldTypography(decomposed)).toBe("café");
  });

  it("does NOT over-fold (NFKC-only cases stay put)", () => {
    // superscript-2 and the fi ligature are compatibility mappings, not
    // canonical — a conservative fold must leave them alone.
    expect(foldTypography("m²")).toBe("m²"); // m²
    expect(foldTypography("ﬁle")).toBe("ﬁle"); // ﬁle
    // math minus and guillemets are intentional, untouched.
    expect(foldTypography("−")).toBe("−"); // −
    expect(foldTypography("«x»")).toBe("«x»"); // «x»
  });

  it("is a no-op on plain ASCII", () => {
    expect(foldTypography(`Don't say "hi" - it's 1...2`)).toBe(
      `Don't say "hi" - it's 1...2`,
    );
  });
});
