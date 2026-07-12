import { ROLE_FILTER_GROUPS } from "@real-a11y-dev/testing";
import { describe, expect, it } from "vitest";

import { diffViews, stripTabIndex } from "./views-diff.js";
import {
  summarizeViews,
  VIEW_CHANGE_ORDER,
  type RawViews,
  type ViewChange,
} from "./views-summary.js";

/** Run raw view texts through the same normalization page-diff uses, then
 * summarize — the tests exercise the whole path a real diff takes. */
function summarize(
  base: Partial<RawViews>,
  pr: Partial<RawViews>,
  ignore?: (line: string) => boolean,
): ViewChange[] {
  const b: RawViews = { tree: "", outline: "", tabs: "", ...base };
  const p: RawViews = { tree: "", outline: "", tabs: "", ...pr };
  const views = {
    tree: diffViews(b.tree, p.tree, undefined, ignore),
    outline: diffViews(b.outline, p.outline, undefined, ignore),
    tabs: diffViews(b.tabs, p.tabs, stripTabIndex, ignore),
  };
  return summarizeViews({ views, base: b, pr: p, ignore });
}

const messages = (changes: ViewChange[]) => changes.map((c) => c.message);
const kinds = (changes: ViewChange[]) => changes.map((c) => c.kind);

describe("summarizeViews", () => {
  // The landmark set is imported from core (via testing) — if the group ever
  // changes there, the summary semantics change with it; this pin makes that
  // an explicit decision instead of silent drift.
  it("pins the landmark role set", () => {
    expect([...(ROLE_FILTER_GROUPS["landmark"] ?? [])].sort()).toEqual([
      "banner",
      "complementary",
      "contentinfo",
      "form",
      "main",
      "navigation",
      "region",
      "search",
    ]);
  });

  describe("sentinels", () => {
    it("page losing all focusability is a headline plus the removals", () => {
      const changes = summarize(
        { tabs: '01. link "Home"\n02. button "Go"' },
        { tabs: "(nothing focusable)" },
      );
      expect(changes[0]).toMatchObject({
        kind: "tabs-emptied",
        message:
          "Nothing on this page is keyboard-focusable any more (was 2 tab stops)",
        count: 2,
      });
      expect(
        kinds(changes).filter((k) => k === "focus-stop-removed"),
      ).toHaveLength(2);
    });

    it("gaining the first stop drops the removed-side sentinel silently", () => {
      const changes = summarize(
        { tabs: "(nothing focusable)" },
        { tabs: '01. link "Home"' },
      );
      expect(kinds(changes)).toEqual(["focus-stop-added"]);
    });

    it("page losing all headings is a headline", () => {
      const changes = summarize(
        { outline: "h1 A\nh2 B" },
        { outline: "(no headings)" },
      );
      expect(changes[0]).toMatchObject({
        kind: "headings-emptied",
        message: "This page no longer has any headings (was 2)",
      });
      expect(
        kinds(changes).filter((k) => k === "heading-removed"),
      ).toHaveLength(2);
    });
  });

  describe("headings (outline-authoritative)", () => {
    it("pairs a level change and consumes the tree lines", () => {
      const changes = summarize(
        {
          outline: "h2 Setup",
          tree: 'main\n  heading "Setup" (level 2)',
        },
        {
          outline: "h3 Setup",
          tree: 'main\n  heading "Setup" (level 3)',
        },
      );
      expect(changes).toEqual([
        {
          kind: "heading-level-changed",
          view: "outline",
          message: 'Heading level changed: "Setup" h2 → h3',
          name: "Setup",
          from: "h2",
          to: "h3",
        },
      ]);
    });

    it("level pairing is count-aware for duplicate names", () => {
      const changes = summarize(
        { outline: "h2 A\nh2 A" },
        { outline: "h3 A\nh3 A" },
      );
      expect(changes).toEqual([
        expect.objectContaining({
          kind: "heading-level-changed",
          message: 'Heading level changed: "A" h2 → h3 (×2)',
          count: 2,
        }),
      ]);
    });

    it("pairs by sorted level when one name moved through levels", () => {
      // h2+h3 → h3+h4: the h3 cancels in the multiset; what changed is 2→4.
      const changes = summarize(
        { outline: "h2 Intro\nh3 Intro" },
        { outline: "h3 Intro\nh4 Intro" },
      );
      expect(messages(changes)).toEqual([
        'Heading level changed: "Intro" h2 → h4',
      ]);
    });

    it("an unnamed heading level change reads as (unnamed heading)", () => {
      // An unnamed heading serializes as `h2 ` and trims to `h2`.
      const changes = summarize({ outline: "h2" }, { outline: "h3" });
      expect(messages(changes)).toEqual([
        "Heading level changed: (unnamed heading) h2 → h3",
      ]);
    });

    it("pairs a rename only when it is 1:1 within a level", () => {
      expect(
        summarize({ outline: "h2 Setup" }, { outline: "h2 Set up" }),
      ).toEqual([
        {
          kind: "heading-renamed",
          view: "outline",
          message: 'Heading renamed (h2): "Setup" → "Set up"',
          from: "Setup",
          to: "Set up",
        },
      ]);
    });

    it("refuses ambiguous rename pairing (2 removed, 1 added)", () => {
      const changes = summarize({ outline: "h2 A\nh2 B" }, { outline: "h2 C" });
      expect(kinds(changes).sort()).toEqual([
        "heading-added",
        "heading-removed",
        "heading-removed",
      ]);
    });

    it("rename + relevel in one edit degrades to add/remove, never guesses", () => {
      const changes = summarize(
        { outline: "h2 Setup" },
        { outline: "h3 Set-up guide" },
      );
      expect(kinds(changes).sort()).toEqual([
        "heading-added",
        "heading-removed",
      ]);
      expect(messages(changes).sort()).toEqual([
        'Heading added: h3 "Set-up guide"',
        'Heading removed: h2 "Setup"',
      ]);
    });

    it("handles levels outside 1-6 (aria-level)", () => {
      const changes = summarize({ outline: "" }, { outline: "h7 Deep" });
      expect(messages(changes)).toEqual(['Heading added: h7 "Deep"']);
    });

    it("detects a pure heading reorder (invisible to the multiset diff)", () => {
      const changes = summarize(
        { outline: "h1 A\nh2 B\nh2 C" },
        { outline: "h1 A\nh2 C\nh2 B" },
      );
      expect(changes).toEqual([
        {
          kind: "heading-order-changed",
          view: "outline",
          message: "Heading order changed (same headings, different order)",
        },
      ]);
    });

    it("does not report reorder when the outline also changed", () => {
      const changes = summarize(
        { outline: "h1 A\nh2 B" },
        { outline: "h2 B\nh1 D" },
      );
      expect(kinds(changes)).not.toContain("heading-order-changed");
    });
  });

  describe("landmarks", () => {
    it("reports additions with the accessible name", () => {
      expect(summarize({}, { tree: 'navigation "Footer"' })).toEqual([
        {
          kind: "landmark-added",
          view: "tree",
          message: 'New landmark: navigation "Footer"',
          role: "navigation",
          name: "Footer",
        },
      ]);
    });

    it("an unnamed landmark reads as (unnamed)", () => {
      expect(messages(summarize({}, { tree: "banner" }))).toEqual([
        "New landmark: banner (unnamed)",
      ]);
    });

    it("removing main carries the consequence clause", () => {
      expect(messages(summarize({ tree: "main" }, {}))).toEqual([
        'Landmark removed: main — skip-to-content and "jump to main" navigation may break',
      ]);
    });

    it("pairs a 1:1 rename", () => {
      const changes = summarize(
        { tree: 'navigation "Site"' },
        { tree: 'navigation "Primary"' },
      );
      expect(changes).toEqual([
        {
          kind: "landmark-renamed",
          view: "tree",
          message: 'Landmark renamed: navigation "Site" → "Primary"',
          role: "navigation",
          from: "Site",
          to: "Primary",
        },
      ]);
    });

    it("refuses ambiguous landmark rename (2 removed, 1 added)", () => {
      const changes = summarize(
        { tree: 'navigation "A"\nnavigation "B"' },
        { tree: 'navigation "C"' },
      );
      expect(kinds(changes).sort()).toEqual([
        "landmark-added",
        "landmark-removed",
        "landmark-removed",
      ]);
    });
  });

  describe("tab stops", () => {
    it("an added stop carries its position from the raw PR counter", () => {
      const changes = summarize(
        { tabs: '01. link "Home"\n02. link "Docs"' },
        { tabs: '01. link "Home"\n02. link "New"\n03. link "Docs"' },
      );
      expect(changes).toEqual([
        {
          kind: "focus-stop-added",
          view: "tabs",
          message: 'Keyboard tab stop added: link "New" (now stop 2 of 3)',
          role: "link",
          name: "New",
          position: 2,
          of: 3,
        },
      ]);
    });

    it("a removed stop still in the PR tree warns it lost focusability", () => {
      const tree = 'main\n  link "Home"\n  button "Close"';
      const changes = summarize(
        { tabs: '01. link "Home"\n02. button "Close"', tree },
        { tabs: '01. link "Home"', tree },
      );
      expect(messages(changes)).toEqual([
        'Keyboard tab stop removed: button "Close" (was stop 2 of 2)' +
          " — still on the page but no longer keyboard-focusable (check this is intentional)",
      ]);
    });

    it("a removed stop gone from the PR tree reads as removed element", () => {
      const changes = summarize(
        {
          tabs: '01. link "Home"\n02. button "Close"',
          tree: 'main\n  link "Home"\n  button "Close"',
        },
        { tabs: '01. link "Home"', tree: 'main\n  link "Home"' },
      );
      expect(messages(changes)).toEqual([
        'Keyboard tab stop removed: button "Close" (was stop 2 of 2)' +
          " (element removed from the page)",
      ]);
    });

    it("omits the position and coalesces when duplicates are ambiguous", () => {
      const changes = summarize(
        { tabs: '01. link "Home"' },
        { tabs: '01. link "Home"\n02. link "More"\n03. link "More"' },
      );
      expect(changes).toEqual([
        expect.objectContaining({
          kind: "focus-stop-added",
          message: 'Keyboard tab stop added: link "More" (×2)',
          count: 2,
        }),
      ]);
      expect(changes[0].position).toBeUndefined();
    });

    it("pairs a 1:1 rename on the same role", () => {
      const changes = summarize(
        { tabs: '01. button "Send"' },
        { tabs: '01. button "Submit"' },
      );
      expect(changes).toEqual([
        {
          kind: "focus-stop-renamed",
          view: "tabs",
          message: 'Tab stop renamed: button "Send" → "Submit"',
          role: "button",
          from: "Send",
          to: "Submit",
        },
      ]);
    });

    it("parses 3-digit positions past stop 99", () => {
      const base = Array.from(
        { length: 100 },
        (_, i) => `${String(i + 1).padStart(2, "0")}. link "L${i + 1}"`,
      ).join("\n");
      const changes = summarize(
        { tabs: base },
        { tabs: `${base}\n101. link "Tail"` },
      );
      expect(messages(changes)).toEqual([
        'Keyboard tab stop added: link "Tail" (now stop 101 of 101)',
      ]);
    });

    it("a focusable generic (tabindex div) reads with no accessible name", () => {
      const changes = summarize({}, { tabs: "01. generic" });
      expect(messages(changes)).toEqual([
        "Keyboard tab stop added: generic (no accessible name) (now stop 1 of 1)",
      ]);
    });

    it("detects a pure reorder — today's total blind spot", () => {
      const changes = summarize(
        { tabs: '01. link "A"\n02. link "B"\n03. link "C"' },
        { tabs: '01. link "B"\n02. link "A"\n03. link "C"' },
      );
      expect(changes).toEqual([
        {
          kind: "tab-order-reordered",
          view: "tabs",
          message: "Keyboard tab order changed: 1 stop moved (same 3 stops)",
          count: 1,
          of: 3,
        },
      ]);
    });

    it("does not report reorder when stops also changed", () => {
      const changes = summarize(
        { tabs: '01. link "A"\n02. link "B"' },
        { tabs: '01. link "B"\n02. link "A"\n03. link "C"' },
      );
      expect(kinds(changes)).toEqual(["focus-stop-added"]);
    });

    it("N identical removed stops coalesce to ONE statement (no tree leak)", () => {
      // Two duplicate focusable stops removed: the tabs statement must consume
      // BOTH matching tree lines, or the leftover re-reports as interactive.
      const changes = summarize(
        {
          tree: 'main\n  link "Home"\n  link "Details"\n  link "Details"',
          tabs: '01. link "Home"\n02. link "Details"\n03. link "Details"',
        },
        { tree: 'main\n  link "Home"', tabs: '01. link "Home"' },
      );
      expect(changes).toEqual([
        expect.objectContaining({
          kind: "focus-stop-removed",
          message:
            'Keyboard tab stop removed: link "Details" (element removed from the page) (×2)',
          count: 2,
        }),
      ]);
      expect(kinds(changes)).not.toContain("interactive-removed");
    });

    it("position stays ≤ total when --ignore-view-line drops an earlier stop", () => {
      // "5 mins ago" is ignored, so "Home" is effectively the only stop — its
      // position must be 1 of 1, never the raw counter's 2 (of 1).
      const ignore = (line: string) => /mins ago/.test(line);
      const changes = summarize(
        {
          tabs: '01. link "5 mins ago"\n02. link "Home"',
          tree: 'main\n  link "5 mins ago"\n  link "Home"',
        },
        { tabs: '01. link "5 mins ago"', tree: 'main\n  link "5 mins ago"' },
        ignore,
      );
      expect(changes).toEqual([
        expect.objectContaining({
          kind: "focus-stop-removed",
          message:
            'Keyboard tab stop removed: link "Home" (was stop 1 of 1) (element removed from the page)',
          position: 1,
          of: 1,
        }),
      ]);
    });
  });

  describe("cross-view dedup", () => {
    it("one new focusable element yields ONE statement (tabs wins)", () => {
      const changes = summarize(
        { tree: "main", tabs: "(nothing focusable)" },
        { tree: 'main\n  link "New"', tabs: '01. link "New"' },
      );
      expect(kinds(changes)).toEqual(["focus-stop-added"]);
    });

    it("a heading change consumes its tree lines (no rollup)", () => {
      const changes = summarize(
        { outline: "h2 A", tree: 'heading "A" (level 2)' },
        { outline: "h3 A", tree: 'heading "A" (level 3)' },
      );
      expect(kinds(changes)).toEqual(["heading-level-changed"]);
    });

    it("a level suffix on a non-heading role never becomes a heading kind", () => {
      // <h2 role="tab"> serializes as `tab "x" (level 2)` in the tree and is
      // absent from the outline.
      const changes = summarize({ tree: 'tab "x" (level 2)' }, {});
      expect(changes).toEqual([
        expect.objectContaining({
          kind: "interactive-removed",
          message: 'Interactive element removed: tab "x"',
          role: "tab",
        }),
      ]);
    });

    it("a non-interactive role with a level suffix rides to the rollup", () => {
      const changes = summarize({ tree: 'cell "x" (level 2)' }, {});
      expect(kinds(changes)).toEqual(["other"]);
    });
  });

  describe("interactive elements outside the tab order", () => {
    it("reports composite-widget children the tabs view can't see", () => {
      const changes = summarize({}, { tree: 'menuitem "Export as PDF"' });
      expect(messages(changes)).toEqual([
        'Interactive element added: menuitem "Export as PDF"',
      ]);
    });
  });

  describe("line grammar hazards", () => {
    it("parses names with embedded unescaped quotes", () => {
      const changes = summarize({}, { tabs: '01. link "say "hi""' });
      expect(changes[0]).toMatchObject({
        role: "link",
        name: 'say "hi"',
      });
    });

    it("a literal (level N) inside a quoted name is not a level suffix", () => {
      const changes = summarize({}, { tree: 'paragraph "see (level 2)"' });
      expect(kinds(changes)).toEqual(["other"]);
      expect(changes[0].message).toContain("paragraph ×1");
    });

    it("the volatile timestamp line is dropped by the ignore predicate", () => {
      const ignore = (line: string) => /^time "/.test(line);
      const changes = summarize(
        { tree: 'main\n  time "Last updated: yesterday"' },
        { tree: 'main\n  time "Last updated: today"' },
        ignore,
      );
      expect(changes).toEqual([]);
    });

    it("without the ignore predicate the volatile line is visible, honest noise", () => {
      const changes = summarize(
        { tree: 'main\n  time "Last updated: yesterday"' },
        { tree: 'main\n  time "Last updated: today"' },
      );
      expect(kinds(changes)).toEqual(["other"]);
    });
  });

  describe("totality rollup", () => {
    it("compresses a mass content edit into one calm sentence", () => {
      const changes = summarize(
        { tree: "listitem\nlistitem" },
        {
          tree: [
            "listitem",
            "listitem",
            "listitem",
            "listitem",
            "listitem",
            'paragraph "Added keyboard shortcuts reference"',
            'paragraph "Fixed focus ring"',
          ].join("\n"),
        },
      );
      expect(changes).toEqual([
        {
          kind: "other",
          view: "tree",
          message:
            "Other content changed: 5 added / 0 removed lines (listitem ×3, paragraph ×2) — expand the raw diff below",
          added: 5,
          removed: 0,
        },
      ]);
    });

    it("caps the histogram at 4 roles", () => {
      const changes = summarize(
        {},
        { tree: "cell\nrow\nlistitem\nparagraph\nfigure" },
      );
      expect(changes[0].message).toContain("+1 other role)");
    });

    it("is total: any non-empty view diff yields at least one statement", () => {
      // A grab-bag of lines no taxonomy stage claims.
      const cases: Array<Partial<RawViews>> = [
        { tree: 'article "Post"' },
        { tree: "separator" },
        { outline: "not-an-outline-line" },
      ];
      for (const pr of cases) {
        expect(summarize({}, pr).length).toBeGreaterThan(0);
      }
    });
  });

  describe("determinism and ordering", () => {
    it("orders by kind importance, then message codepoint", () => {
      const changes = summarize(
        {
          tree: 'main\n  navigation "Old"\n  heading "Setup" (level 2)',
          outline: "h2 Setup",
          tabs: '01. button "Close"',
        },
        {
          tree: 'heading "Setup" (level 3)\nlistitem',
          outline: "h3 Setup",
          tabs: "(nothing focusable)",
        },
      );
      const ranks = changes.map((c) => VIEW_CHANGE_ORDER.indexOf(c.kind));
      expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
      expect(changes[0].kind).toBe("tabs-emptied");
      expect(changes.at(-1)?.kind).toBe("other");
    });

    it("is deterministic: double-run byte-equal", () => {
      const run = () =>
        summarize(
          {
            tree: 'navigation "A"\nheading "B" (level 2)\nlistitem',
            outline: "h2 B",
            tabs: '01. link "X"\n02. link "Y"',
          },
          {
            tree: 'navigation "Z"\nheading "B" (level 4)',
            outline: "h4 B",
            tabs: '01. link "Y"\n02. link "X"',
          },
        );
      expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
    });
  });
});
