import { describe, expect, it } from "vitest";

import {
  projectFinding,
  projectFindings,
  projectSnapshot,
  redactUrl,
  redactUrlsIn,
  sanitizeText,
} from "./sanitize.js";

describe("sanitizeText", () => {
  it("escapes terminal escape sequences to visible text", () => {
    expect(sanitizeText("evil\u001B]0;owned\u0007name")).toBe(
      "evil\\u{1B}]0;owned\\u{7}name",
    );
  });

  it("escapes bidi override characters", () => {
    expect(sanitizeText("a‮b⁦c")).toBe("a\\u{202E}b\\u{2066}c");
  });

  it("passes CJK and RTL letters through untouched", () => {
    const text = "ボタン عربى héllo";
    expect(sanitizeText(text)).toBe(text);
  });

  it("collapses newlines in singleLine mode so a name can't forge lines", () => {
    expect(sanitizeText("a\r\nb\tc", { singleLine: true })).toBe("a b c");
  });

  it("normalizes CR away in multiline mode", () => {
    expect(sanitizeText("a\r\nb")).toBe("a\nb");
  });

  it("stringifies non-strings defensively", () => {
    expect(sanitizeText(42)).toBe("42");
    expect(sanitizeText(null)).toBe("");
  });

  it("strips SGR color codes (Playwright errors) but keeps non-SGR escapes visible", () => {
    expect(sanitizeText("a\u001B[2mdim\u001B[22mb")).toBe("adimb");
    expect(sanitizeText("x\u001B[2Ky")).toBe("x\\u{1B}[2Ky");
    expect(sanitizeText("literal [31m text")).toBe("literal [31m text");
  });
});

describe("redactUrl", () => {
  it("strips userinfo", () => {
    expect(redactUrl("https://user:pass@host/x")).toBe("https://host/x");
  });

  it("redacts secret-looking query params, keeps the rest", () => {
    expect(redactUrl("https://h/p?q=1&token=abc&API_KEY=zz")).toBe(
      "https://h/p?q=1&token=%5BREDACTED%5D&API_KEY=%5BREDACTED%5D",
    );
  });

  it("sanitizes but returns non-URLs as-is", () => {
    expect(redactUrl("not a url")).toBe("not a url");
  });

  it("redactUrlsIn scrubs URLs embedded in free text (Playwright messages)", () => {
    expect(
      redactUrlsIn("page.goto: net::ERR at https://u:p@h/x?token=abc failed"),
    ).toBe("page.goto: net::ERR at https://h/x?token=%5BREDACTED%5D failed");
  });
});

describe("projectFinding", () => {
  const valid = {
    rule: "image-alt",
    severity: "warning",
    message: "Image has no accessible name",
    locator: "img:nth-of-type(2)",
  };

  it("keeps known fields, drops unknown ones", () => {
    const projected = projectFinding({
      ...valid,
      __proto__x: "boom",
      extra: 1,
    });
    expect(projected).toEqual({
      rule: "image-alt",
      severity: "warning",
      message: "Image has no accessible name",
      locator: "img:nth-of-type(2)",
    });
  });

  it("rejects unknown rules and severities", () => {
    expect(projectFinding({ ...valid, rule: "made-up" })).toBeNull();
    expect(projectFinding({ ...valid, severity: "fatal" })).toBeNull();
    expect(projectFinding("nope")).toBeNull();
  });

  it("sanitizes and caps every string field", () => {
    const projected = projectFinding({
      ...valid,
      message: `hi\u001B[2K${"x".repeat(2000)}`,
    });
    expect(projected!.message.startsWith("hi\\u{1B}[2K")).toBe(true);
    expect(projected!.message.length).toBeLessThanOrEqual(1000);
  });
});

describe("projectFindings / projectSnapshot", () => {
  it("returns [] for non-arrays and skips invalid entries", () => {
    expect(projectFindings("x")).toEqual([]);
    expect(
      projectFindings([
        null,
        { rule: "image-alt", severity: "warning", message: "m" },
      ]),
    ).toHaveLength(1);
  });

  it("projects a snapshot shape with defaults for garbage", () => {
    const snapshot = projectSnapshot({ tree: "main\n", nonsense: 1 });
    expect(snapshot).toEqual({
      findings: [],
      tree: "main\n",
      outline: "",
      tabOrder: "",
    });
  });
});
