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

  it("is neutral by default: the unified diff, no statements, an --explain hint", () => {
    const out = renderDiffPretty(structural, { color: false });
    expect(out).toContain("== Docs");
    expect(out).toContain('heading "Setup" (level 3)'); // a + line in the diff
    expect(out).not.toContain("Heading level changed"); // no statement
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

  it("a reorder shows in both modes (unified diff catches it); --explain names it", () => {
    // The unified diff of the numbered tabs sees the reorder (the multiset
    // didn't), so the page is no longer invisible in neutral mode.
    const neutral = renderDiffPretty(reorderOnly, { color: false });
    expect(neutral).toContain("== Docs");
    expect(neutral).toContain("Run with --explain");
    const explained = renderDiffPretty(reorderOnly, {
      color: false,
      explain: true,
    });
    expect(explained).toContain("== Docs");
    expect(explained).toContain("Keyboard tab order changed");
  });

  it("caps with --max-lines and --max-pages", () => {
    const capped = renderDiffPretty(structural, {
      color: false,
      maxLines: 2,
    });
    expect(capped).toMatch(/… \d+ more diff line/);
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

  it("adds structuralDiff — true for a pure tree reorder that statements miss", () => {
    // Two landmarks swap order: the multiset diff is empty and there's no
    // tree-reorder statement pass, so `structural` is []. But the unified diff
    // catches it — structuralDiff is the honest per-page "structure changed".
    const reorder = diffArtifacts(
      buildArtifact(
        [
          page("Home", [], {
            tree: 'main\n  navigation "A"\n  navigation "B"',
          }),
        ],
        { toolName: "c", toolVersion: "0" },
      ),
      buildArtifact(
        [
          page("Home", [], {
            tree: 'main\n  navigation "B"\n  navigation "A"',
          }),
        ],
        { toolName: "c", toolVersion: "0" },
      ),
    );
    const parsed = JSON.parse(renderDiffJson(reorder)) as {
      pages: { structural: unknown[]; structuralDiff: boolean }[];
    };
    expect(parsed.pages[0].structural).toEqual([]);
    expect(parsed.pages[0].structuralDiff).toBe(true);
    // A genuinely clean page reports structuralDiff: false.
    const clean = diffArtifacts(
      buildArtifact([page("Home", [])], { toolName: "c", toolVersion: "0" }),
      buildArtifact([page("Home", [])], { toolName: "c", toolVersion: "0" }),
    );
    expect(
      (
        JSON.parse(renderDiffJson(clean)) as {
          pages: { structuralDiff: boolean }[];
        }
      ).pages[0].structuralDiff,
    ).toBe(false);
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

  it("is neutral by default: the unified diff, no statements, header names the drift", () => {
    const out = renderDiffMarkdown(structural);
    // "structure changed on N pages" is a fact — it rides the header in both
    // modes so an all-zero triplet doesn't read as "nothing changed".
    expect(out.split("\n")[0]).toBe(
      "### Accessibility diff — 0 new · 0 changed · 0 fixed · structure changed on 1 page",
    );
    expect(out).toContain("#### Docs");
    expect(out).not.toContain("**Structure (advisory");
    expect(out).not.toContain("Heading level changed");
    expect(out).toContain("_tree_");
    expect(out).toContain("```diff");
    expect(out).toContain("@@");
    expect(out).toContain('-  heading "Setup" (level 2)'); // tag + indented text
    expect(out).toContain('+  heading "Setup" (level 3)');
    expect(out).not.toContain("<details>");
    expect(out).toContain(
      "_Run with `--explain` for a plain-language summary of the structural changes._",
    );
  });

  it("--explain: statements before the unified diff; header names the drift", () => {
    const out = renderDiffMarkdown(structural, { explain: true });
    expect(out.split("\n")[0]).toBe(
      "### Accessibility diff — 0 new · 0 changed · 0 fixed · structure changed on 1 page",
    );
    expect(out).toContain(
      "No accessibility finding changes — but the semantic structure moved (advisory, review below).",
    );
    expect(out).toContain("**Structure (advisory — never blocks merge):**");
    expect(out).toContain('- Heading level changed: "Setup" h2 → h3');
    // Statements come BEFORE the unified diff.
    expect(out.indexOf("Heading level changed")).toBeLessThan(
      out.indexOf("```diff"),
    );
    expect(out).toContain('-  heading "Setup" (level 2)');
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

  it("a reorder shows in both modes; --explain names it", () => {
    const neutral = renderDiffMarkdown(reorderOnly);
    expect(neutral).toContain("#### Docs"); // unified diff catches the reorder
    expect(neutral).toContain("```diff");
    const explained = renderDiffMarkdown(reorderOnly, { explain: true });
    expect(explained).toContain("Keyboard tab order changed");
  });

  it("lists changed routes and caps with --max-pages / --max-lines", () => {
    const two = diffArtifacts(
      buildArtifact(
        [page("A", [], { tree: "main" }), page("B", [], { tree: "main" })],
        { toolName: "c", toolVersion: "0" },
      ),
      buildArtifact(
        [
          page("A", [], { tree: 'main\n  link "x"' }),
          page("B", [], { tree: 'main\n  link "y"' }),
        ],
        { toolName: "c", toolVersion: "0" },
      ),
    );
    const out = renderDiffMarkdown(two, { maxPages: 1 });
    expect(out).toContain("**Pages with a11y changes (2):** `A`, `B`");
    expect(out).toContain("#### A");
    expect(out).not.toContain("#### B"); // capped; listed in the overflow note
    expect(out).toContain("and 1 more page with changes: `B`");
  });

  it("escapes hostile accessible names in --explain statements; the diff keeps them verbatim", () => {
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
    // …while the unified diff keeps the line verbatim inside its fence.
    const diffLine = out
      .split("\n")
      .find((l) => l.startsWith("+") && l.includes("navigation"));
    expect(diffLine).toContain("</details>**bold**");
  });

  it("escapes hostile page names in the heading and route index", () => {
    // Page names come from config — a backtick or `<` must not break the
    // comment. Two changed pages so the route index renders.
    const hostile = diffArtifacts(
      buildArtifact(
        [
          page("a`b", [], { tree: "main" }),
          page("<img>", [], { tree: "main" }),
        ],
        { toolName: "c", toolVersion: "0" },
      ),
      buildArtifact(
        [
          page("a`b", [], { tree: 'main\n  link "x"' }),
          page("<img>", [], { tree: 'main\n  link "y"' }),
        ],
        { toolName: "c", toolVersion: "0" },
      ),
    );
    const out = renderDiffMarkdown(hostile);
    // Route index wraps names in a backtick-run-safe code span.
    expect(out).toContain("Pages with a11y changes (2):");
    expect(out).toContain("``a`b``"); // fenced past the embedded backtick
    // The `####` heading escapes `<` so it can't inject HTML.
    expect(out).toContain("#### &lt;img&gt;");
    expect(out).not.toContain("#### <img>");
  });
});
