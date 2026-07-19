import type { Finding } from "@real-a11y-dev/audit";
import { describe, expect, it } from "vitest";

import { fingerprintFindings, hashId } from "./fingerprint.js";

const button = (over: Partial<Finding> = {}): Finding => ({
  rule: "no-unlabeled-interactive",
  severity: "error",
  message: "Unlabeled interactive element: button <button>",
  role: "button",
  tagName: "button",
  locator: "body > main > button",
  context: "in <main>",
  ...over,
});

describe("fingerprintFindings — node findings", () => {
  it("keeps a bare #id locator verbatim", () => {
    const [f] = fingerprintFindings("Home", [button({ locator: "#save" })]);
    expect(f.id).toEqual([
      "v1",
      "Home",
      "no-unlabeled-interactive",
      "button",
      "button",
      "#save",
      "in <main>",
      0,
    ]);
    expect(f.fingerprint).toMatch(/^v1:[0-9a-f]{16}$/);
  });

  it("strips nth-of-type from non-bare locators — including parent-id paths", () => {
    const [f] = fingerprintFindings("Home", [
      button({ locator: "#nav > ul > li:nth-of-type(3) > button" }),
    ]);
    expect(f.id[5]).toBe("#nav > ul > li > button");
  });

  it("is churn-stable: an inserted sibling doesn't re-identify the finding", () => {
    const [before] = fingerprintFindings("Home", [
      button({ locator: "body > main > button:nth-of-type(1)" }),
    ]);
    const [after] = fingerprintFindings("Home", [
      button({ locator: "body > main > button:nth-of-type(2)" }),
    ]);
    expect(after.fingerprint).toBe(before.fingerprint);
  });

  it("disambiguates identical findings with occ, in document order", () => {
    const twins = fingerprintFindings("Home", [button(), button()]);
    expect(twins[0].id.at(-1)).toBe(0);
    expect(twins[1].id.at(-1)).toBe(1);
    expect(twins[0].fingerprint).not.toBe(twins[1].fingerprint);
  });

  it("strips volatile query strings from the context component", () => {
    const [a] = fingerprintFindings("Home", [
      button({ context: 'href="https://x/y?build=123" · in <nav>' }),
    ]);
    const [b] = fingerprintFindings("Home", [
      button({ context: 'href="https://x/y?build=456" · in <nav>' }),
    ]);
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it("is total when the locator is missing", () => {
    const [f] = fingerprintFindings("Home", [button({ locator: undefined })]);
    expect(f.id[5]).toBe("");
  });
});

describe("fingerprintFindings — doc findings", () => {
  const doc = (
    rule: Finding["rule"],
    message: string,
    name?: string,
  ): Finding => ({
    rule,
    severity: "warning",
    message,
    ...(name ? { name } : {}),
  });

  it.each([
    ["heading-order", "Missing <h1>: every document…", "missing-h1"],
    [
      "heading-order",
      'Expected exactly one <h1>, found 2: "a", "b"',
      "multiple-h1",
    ],
    ["heading-order", 'Heading level skipped: "X" is h4…', "skipped-level"],
    ["landmark-structure", "Missing <main>: every page…", "missing-main"],
    [
      "landmark-structure",
      "Expected exactly one <main> landmark, found 2.",
      "multiple-main",
    ],
    [
      "landmark-structure",
      "More than one top-level <header> (banner landmark): found 2.",
      "multiple-banner",
    ],
    [
      "landmark-structure",
      "More than one top-level <footer> (contentinfo landmark): found 3.",
      "multiple-contentinfo",
    ],
  ] as const)("classifies %s %j as %s", (rule, message, kind) => {
    const [f] = fingerprintFindings("Home", [doc(rule, message)]);
    expect(f.id[3]).toBe(kind);
  });

  it("keeps counts out of the identity — found 2 vs found 3 match", () => {
    const [a] = fingerprintFindings("Home", [
      doc(
        "landmark-structure",
        "Expected exactly one <main> landmark, found 2.",
      ),
    ]);
    const [b] = fingerprintFindings("Home", [
      doc(
        "landmark-structure",
        "Expected exactly one <main> landmark, found 3.",
      ),
    ]);
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it("distinguishes skipped-level findings by heading name", () => {
    const [a] = fingerprintFindings("Home", [
      doc("heading-order", 'Heading level skipped: "Details"…', "Details"),
    ]);
    const [b] = fingerprintFindings("Home", [
      doc("heading-order", 'Heading level skipped: "Pricing"…', "Pricing"),
    ]);
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });
});

describe("hashId", () => {
  it("is stable — a committed baseline must never silently re-hash", () => {
    expect(
      hashId(["v1", "Home", "image-alt", "img", "img", "#hero", "", 0]),
    ).toMatchInlineSnapshot(`"v1:a44ea21e34c4014e"`);
  });
});
