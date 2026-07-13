import type { Finding } from "@real-a11y-dev/testing";
import { describe, expect, it } from "vitest";

import { diffArtifacts } from "../diff/page-diff.js";
import { fingerprintFindings } from "../fingerprint.js";
import { buildArtifact, type SnapshotPage } from "../snapshot-artifact.js";

import {
  renderDiffJson,
  renderDiffMarkdown,
  renderDiffPretty,
} from "./diff.js";

const button: Finding = {
  rule: "no-unlabeled-interactive",
  severity: "error",
  message: "Unlabeled interactive element: button <button>",
  role: "button",
  tagName: "button",
  locator: "#save",
  context: "in <main>",
};

function page(
  name: string,
  findings: Finding[],
  views: Partial<Pick<SnapshotPage, "tree" | "outline" | "tabs">> = {},
): SnapshotPage {
  return {
    name,
    url: `http://x/${name}`,
    root: "body",
    status: "ok",
    findings: fingerprintFindings(name, findings),
    tree: "main",
    outline: "",
    tabs: "",
    ...views,
  };
}

// Base clean, PR has one new finding.
const result = diffArtifacts(
  buildArtifact([page("Home", [])], { toolName: "cli", toolVersion: "0" }),
  buildArtifact([page("Home", [button])], {
    toolName: "cli",
    toolVersion: "0",
  }),
);

// One heading demotion + one added tab stop — structural drift, no findings.
const structural = diffArtifacts(
  buildArtifact(
    [
      page("Docs", [], {
        tree: 'main\n  heading "Setup" (level 2)',
        outline: "h2 Setup",
        tabs: '01. link "Home"',
      }),
    ],
    { toolName: "cli", toolVersion: "0" },
  ),
  buildArtifact(
    [
      page("Docs", [], {
        tree: 'main\n  heading "Setup" (level 3)\n  link "Skip"',
        outline: "h3 Setup",
        tabs: '01. link "Skip"\n02. link "Home"',
      }),
    ],
    { toolName: "cli", toolVersion: "0" },
  ),
);

// A pure tab reorder: EMPTY view diffs, but a structural statement.
const reorderOnly = diffArtifacts(
  buildArtifact([page("Docs", [], { tabs: '01. link "A"\n02. link "B"' })], {
    toolName: "cli",
    toolVersion: "0",
  }),
  buildArtifact([page("Docs", [], { tabs: '01. link "B"\n02. link "A"' })], {
    toolName: "cli",
    toolVersion: "0",
  }),
);

describe("renderDiffPretty", () => {
  it("shows NEW findings and puts the summary on the last line", () => {
    const out = renderDiffPretty(result, { color: false });
    expect(out).toContain("+ new [error] no-unlabeled-interactive");
    expect(out).toContain("#save");
    expect(out.trimEnd().split("\n").at(-1)).toBe(
      "1 new · 0 changed · 0 fixed",
    );
  });

  it("never conveys via color alone (text tags present with color on)", () => {
    const out = renderDiffPretty(result, { color: true });
    expect(out).toContain("+ new [error]");
  });

  it("is neutral by default: counts only, no statements, an --explain hint", () => {
    const out = renderDiffPretty(structural, { color: false });
    expect(out).toContain(
      "structure changed (advisory): tree +2/-1 · outline +1/-1 · tabs +1/-0",
    );
    expect(out).not.toContain("Heading level changed");
    expect(out).toContain(
      "Run with --explain for a plain-language structural summary.",
    );
  });

  it("--explain adds the plain-language statements (and drops the hint)", () => {
    const out = renderDiffPretty(structural, { color: false, explain: true });
    expect(out).toContain('· Heading level changed: "Setup" h2 → h3');
    expect(out).toContain(
      '· Keyboard tab stop added: link "Skip" (now stop 1 of 2)',
    );
    expect(out).not.toContain("Run with --explain");
  });

  it("a reorder-only page: neutral hides it (with a hint), --explain shows it", () => {
    const neutral = renderDiffPretty(reorderOnly, { color: false });
    expect(neutral).not.toContain("== Docs");
    expect(neutral).toContain("Run with --explain");
    const explained = renderDiffPretty(reorderOnly, {
      color: false,
      explain: true,
    });
    expect(explained).toContain("== Docs");
    expect(explained).toContain("Keyboard tab order changed");
  });
});

describe("renderDiffJson", () => {
  it("emits a stable envelope with new/changed/removed per page", () => {
    const parsed = JSON.parse(renderDiffJson(result)) as {
      schemaVersion: number;
      command: string;
      summary: { new: number };
      pages: { name: string; new: unknown[]; views: unknown }[];
    };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.command).toBe("diff");
    expect(parsed.summary.new).toBe(1);
    expect(parsed.pages[0].new).toHaveLength(1);
  });

  it("carries pages[].structural additively — schemaVersion stays 1", () => {
    const parsed = JSON.parse(renderDiffJson(structural)) as {
      schemaVersion: number;
      pages: {
        views: { tree: { added: string[] } };
        structural: { kind: string; message: string }[];
      }[];
    };
    expect(parsed.schemaVersion).toBe(1);
    // `views` is untouched — the workflow reads it defensively; a rename
    // would silently drop the structural section from PR comments.
    expect(parsed.pages[0].views.tree.added).toEqual([
      'heading "Setup" (level 3)',
      'link "Skip"',
    ]);
    expect(parsed.pages[0].structural.map((s) => s.kind)).toEqual([
      "heading-level-changed",
      "focus-stop-added",
    ]);
    // Clean pages carry an empty array, not a missing key.
    const clean = diffArtifacts(
      buildArtifact([page("Home", [])], { toolName: "c", toolVersion: "0" }),
      buildArtifact([page("Home", [])], { toolName: "c", toolVersion: "0" }),
    );
    const cleanParsed = JSON.parse(renderDiffJson(clean)) as {
      pages: { structural: unknown[] }[];
    };
    expect(cleanParsed.pages[0].structural).toEqual([]);
  });

  it("is deterministic — double render is byte-equal", () => {
    expect(renderDiffJson(structural)).toBe(renderDiffJson(structural));
  });
});

describe("renderDiffMarkdown", () => {
  it("renders a PR-comment-ready summary", () => {
    const out = renderDiffMarkdown(result);
    expect(out).toMatch(/### Accessibility diff — 1 new/);
    expect(out).toMatch(/\*\*new\*\* `no-unlabeled-interactive`/);
  });

  it("says so when nothing changed", () => {
    const clean = diffArtifacts(
      buildArtifact([page("Home", [])], { toolName: "c", toolVersion: "0" }),
      buildArtifact([page("Home", [])], { toolName: "c", toolVersion: "0" }),
    );
    expect(renderDiffMarkdown(clean)).toContain(
      "No accessibility finding changes.",
    );
  });

  it("is neutral by default: raw diff, no statements, findings-only header + hint", () => {
    const out = renderDiffMarkdown(structural);
    // Header stays findings-only; the raw diff below carries the structure.
    expect(out.split("\n")[0]).toBe(
      "### Accessibility diff — 0 new · 0 changed · 0 fixed",
    );
    expect(out).toContain("#### Docs");
    expect(out).not.toContain("**Structure (advisory");
    expect(out).not.toContain("Heading level changed");
    expect(out).toContain(
      "**Raw view diff — tree +2/-1 · outline +1/-1 · tabs +1/-0**",
    );
    expect(out).not.toContain("<details>");
    expect(out).toContain('+ heading "Setup" (level 3)');
    expect(out).toContain("```diff");
    expect(out).toContain(
      "_Run with `--explain` for a plain-language summary of the structural changes._",
    );
  });

  it("--explain: header suffix + lead-in, statements before the inline raw diff", () => {
    const out = renderDiffMarkdown(structural, { explain: true });
    // The header (an email/notification title) names the drift so it doesn't
    // read as an all-zero "nothing changed".
    expect(out.split("\n")[0]).toBe(
      "### Accessibility diff — 0 new · 0 changed · 0 fixed · structure changed on 1 page",
    );
    expect(out).toContain(
      "No accessibility finding changes — but the semantic structure moved (advisory, review below).",
    );
    expect(out).toContain("**Structure (advisory — never blocks merge):**");
    expect(out).toContain('- Heading level changed: "Setup" h2 → h3');
    expect(out.indexOf("Heading level changed")).toBeLessThan(
      out.indexOf("Raw view diff"),
    );
    expect(out).toContain(
      "**Raw view diff — tree +2/-1 · outline +1/-1 · tabs +1/-0**",
    );
    expect(out).toContain('- heading "Setup" (level 2)');
    expect(out).toContain(
      "_Structural notes are advisory and never fail the check; container/nesting moves are not tracked._",
    );
  });

  it("keeps the header findings-only when nothing structural moved", () => {
    // `result` has a finding but identical tree/outline/tabs → no structural.
    expect(renderDiffMarkdown(result, { explain: true }).split("\n")[0]).toBe(
      "### Accessibility diff — 1 new · 0 changed · 0 fixed",
    );
  });

  it("a reorder-only page: neutral hides it (hint), --explain shows the statement", () => {
    const neutral = renderDiffMarkdown(reorderOnly);
    expect(neutral).not.toContain("#### Docs");
    expect(neutral).toContain("_Run with `--explain`");
    const explained = renderDiffMarkdown(reorderOnly, { explain: true });
    expect(explained).toContain("#### Docs");
    expect(explained).toContain("Keyboard tab order changed");
    // A reorder adds/removes no lines, so there's no raw diff to show.
    expect(explained).not.toContain("Raw view diff");
  });

  it("escapes hostile accessible names in --explain statements", () => {
    const hostile = diffArtifacts(
      buildArtifact([page("Home", [], { tree: "main" })], {
        toolName: "c",
        toolVersion: "0",
      }),
      buildArtifact(
        [
          page("Home", [], {
            tree: 'main\n  navigation "</details>**bold** `tick`"',
          }),
        ],
        { toolName: "c", toolVersion: "0" },
      ),
    );
    const out = renderDiffMarkdown(hostile, { explain: true });
    // The statement bullet must not leak raw HTML/markdown structure…
    const bullet = out.split("\n").find((l) => l.startsWith("- New landmark"));
    expect(bullet).toBeDefined();
    expect(bullet).not.toContain("</details>");
    expect(bullet).toContain("&lt;/details&gt;");
    expect(bullet).toContain("\\*\\*bold\\*\\*");
    // …while the raw block keeps the line verbatim inside its fence.
    expect(out).toContain('+ navigation "</details>**bold** `tick`"');
  });
});
