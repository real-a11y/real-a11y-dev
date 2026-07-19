import type { Finding } from "@real-a11y-dev/audit";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fingerprintFindings } from "../fingerprint.js";

import { emitAnnotations } from "./annotations.js";
import { colorEnabled } from "./color.js";
import { renderJson, summarize, type PageReport } from "./json.js";
import { renderPretty } from "./pretty.js";

const findings: Finding[] = [
  {
    rule: "no-unlabeled-interactive",
    severity: "error",
    message: "Unlabeled interactive element: button <button>",
    role: "button",
    tagName: "button",
    locator: "body > main > button",
    context: "in <main>",
  },
  {
    rule: "no-unlabeled-interactive",
    severity: "error",
    message: "Unlabeled interactive element: button <button>",
    role: "button",
    tagName: "button",
    locator: "body > main > button:nth-of-type(2)",
    context: "in <main>",
  },
  {
    rule: "image-alt",
    severity: "warning",
    message: "Image has no accessible name: <img> — add alt text.",
    role: "img",
    tagName: "img",
    locator: "img",
  },
];

const page = (over: Partial<PageReport> = {}): PageReport => ({
  name: "https://example.com/",
  url: "https://example.com/",
  findings: fingerprintFindings("https://example.com/", findings),
  ...over,
});

describe("renderPretty", () => {
  it("groups findings, errors first, summary LAST", () => {
    expect(renderPretty([page()], { color: false })).toMatchInlineSnapshot(`
      "  [error] no-unlabeled-interactive: Unlabeled interactive element: button <button> (×2)
            body > main > button  in <main>
            body > main > button:nth-of-type(2)  in <main>
        [warning] image-alt: Image has no accessible name: <img> — add alt text.
            img

      3 issues — 2 error(s), 1 warning(s)
      "
    `);
  });

  it("renders a clean run as the fixed no-issues line", () => {
    expect(renderPretty([page({ findings: [] })], { color: false })).toBe(
      "No accessibility issues found.\n",
    );
  });

  it("renders page errors and keeps other pages reporting", () => {
    const out = renderPretty(
      [page(), page({ name: "b", findings: [], error: "could not open b" })],
      { color: false },
    );
    expect(out).toContain("== https://example.com/");
    expect(out).toContain("[error] page failed: could not open b");
    expect(out.trimEnd().split("\n").at(-1)).toMatch(
      /^3 issues .* · 1 page\(s\) failed to load$/,
    );
  });

  it("a failed page NEVER reads as a clean bill of health", () => {
    const out = renderPretty(
      [page({ findings: [], error: "could not open" })],
      { color: false },
    );
    expect(out).not.toContain("No accessibility issues found.");
    expect(out.trimEnd().split("\n").at(-1)).toBe(
      "1 page(s) failed to load — nothing was audited",
    );
  });

  it("conveys severity by text tag even with color on", () => {
    const out = renderPretty([page()], { color: true });
    expect(out).toContain("[error]");
    expect(out).toContain("[warning]");
  });
});

describe("renderJson", () => {
  it("emits the stable envelope with fingerprints", () => {
    const parsed = JSON.parse(renderJson("audit", [page()])) as {
      schemaVersion: number;
      command: string;
      summary: { total: number; errors: number; warnings: number };
      pages: {
        summary: { total: number };
        findings: { fingerprint: string; id: unknown[] }[];
      }[];
    };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.command).toBe("audit");
    expect(parsed.summary).toEqual({ total: 3, errors: 2, warnings: 1 });
    expect(parsed.pages[0].findings[0].fingerprint).toMatch(/^v1:/);
    expect(Array.isArray(parsed.pages[0].findings[0].id)).toBe(true);
  });

  it("summarize counts severities", () => {
    expect(summarize(findings)).toEqual({ total: 3, errors: 2, warnings: 1 });
  });
});

describe("emitAnnotations", () => {
  it("groups one annotation per severity+rule and escapes newlines", () => {
    const evil: Finding = {
      rule: "dialog-labeled",
      severity: "error",
      message: "line1\n::error ::forged",
      role: "dialog",
      tagName: "div",
    };
    const lines: string[] = [];
    emitAnnotations(
      [page({ findings: fingerprintFindings("p", [...findings, evil]) })],
      (l) => lines.push(l),
    );
    expect(lines).toHaveLength(3);
    const forged = lines.find((l) => l.includes("dialog-labeled"))!;
    expect(forged).toContain("%0A");
    expect(forged.split("\n").filter(Boolean)).toHaveLength(1);
    expect(lines.every((l) => /^::(error|warning) title=/.test(l))).toBe(true);
  });

  it("keeps distinct messages under one rule in separate, correctly-counted groups", () => {
    const headings: Finding[] = [
      {
        rule: "heading-order",
        severity: "warning",
        message: "Missing <h1>: every document should have one.",
      },
      {
        rule: "heading-order",
        severity: "warning",
        message: 'Heading level skipped: "A" is h4 but the previous was h2.',
        name: "A",
      },
      {
        rule: "heading-order",
        severity: "warning",
        message: 'Heading level skipped: "B" is h4 but the previous was h2.',
        name: "B",
      },
    ];
    const lines: string[] = [];
    emitAnnotations(
      [page({ findings: fingerprintFindings("p", headings) })],
      (l) => lines.push(l),
    );
    expect(lines).toHaveLength(3);
    expect(lines.filter((l) => l.includes("1 ×"))).toHaveLength(3);
    expect(lines.some((l) => l.includes("3 ×"))).toBe(false);
  });

  it("annotates failed pages", () => {
    const lines: string[] = [];
    emitAnnotations([page({ findings: [], error: "could not open" })], (l) =>
      lines.push(l),
    );
    expect(lines[0]).toMatch(/^::error title=real-a11y::/);
  });
});

describe("colorEnabled", () => {
  afterEach(() => vi.unstubAllEnvs());

  const tty = { isTTY: true };
  const pipe = { isTTY: false };

  it("follows FORCE_COLOR > NO_COLOR > TTY/GITHUB_ACTIONS", () => {
    vi.stubEnv("FORCE_COLOR", "1");
    vi.stubEnv("NO_COLOR", "1");
    expect(colorEnabled(pipe)).toBe(true);

    vi.unstubAllEnvs();
    vi.stubEnv("NO_COLOR", "1");
    vi.stubEnv("GITHUB_ACTIONS", "true");
    expect(colorEnabled(tty)).toBe(false);

    vi.unstubAllEnvs();
    vi.stubEnv("FORCE_COLOR", "");
    vi.stubEnv("NO_COLOR", "");
    vi.stubEnv("GITHUB_ACTIONS", "");
    expect(colorEnabled(tty)).toBe(true);
    expect(colorEnabled(pipe)).toBe(false);

    vi.stubEnv("GITHUB_ACTIONS", "true");
    expect(colorEnabled(pipe)).toBe(true);
  });
});
