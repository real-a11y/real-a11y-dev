import { describe, expect, it } from "vitest";

import {
  fillHint,
  groupByFile,
  keepUnchanged,
  kindLabel,
  openingView,
  readableRecords,
  RECORD_VERSION,
  type SnapshotRecord,
} from "./records.js";

function record(over: Partial<SnapshotRecord> = {}): SnapshotRecord {
  return {
    id: "a/one.json",
    version: RECORD_VERSION,
    file: "src/a.test.ts",
    test: "one",
    index: 1,
    sequence: 1,
    kind: "tree",
    text: "main",
    recordedAt: "2026-11-18T00:00:00.000Z",
    ...over,
  };
}

describe("openingView", () => {
  it("opens a tab sequence's tree on the TAB view", () => {
    expect(openingView(record({ view: "tab" }))).toEqual({
      viewMode: "tab",
      roleFilter: null,
    });
  });

  it("opens an outline's tree on the headings", () => {
    expect(openingView(record({ view: "headings" }))).toEqual({
      viewMode: "a11y",
      roleFilter: "heading",
    });
  });

  it("opens a whole tree, and a record from before views, on the tree", () => {
    expect(openingView(record())).toEqual({
      viewMode: "a11y",
      roleFilter: null,
    });
  });

  it("opens a diff on the tree, whatever its record says of a view", () => {
    expect(openingView(record({ kind: "diff", view: "tab" }))).toEqual({
      viewMode: "a11y",
      roleFilter: null,
    });
  });
});

describe("kindLabel", () => {
  it("names what the snapshot printed", () => {
    expect(kindLabel(record())).toBe("tree");
    expect(kindLabel(record({ view: "tab" }))).toBe("tabs");
    expect(kindLabel(record({ view: "headings" }))).toBe("outline");
    expect(kindLabel(record({ kind: "diff" }))).toBe("diff");
  });
});

describe("keepUnchanged", () => {
  it("keeps the object of a record that hasn't changed", () => {
    const old = record();
    expect(keepUnchanged([old], [record()])[0]).toBe(old);
  });

  it("takes a record rewritten by a rerun", () => {
    const next = record({ recordedAt: "2026-11-18T00:00:01.000Z" });
    expect(keepUnchanged([record()], [next])[0]).toBe(next);
  });

  it("takes a record whose text changed", () => {
    const next = record({ text: "main\n  button" });
    expect(keepUnchanged([record()], [next])[0]).toBe(next);
  });

  it("takes a new record that has no recordedAt", () => {
    const next = { id: "b.json", version: 3 } as SnapshotRecord;
    expect(keepUnchanged([], [next])).toEqual([next]);
  });
});

describe("readableRecords", () => {
  it("leaves out another version's", () => {
    const mine = record();
    const other = record({ id: "b.json", version: RECORD_VERSION + 1 });
    expect(readableRecords([mine, other])).toEqual([mine]);
  });
});

describe("groupByFile", () => {
  it("puts a record back in its place by its sequence", () => {
    const first = record({ id: "1", sequence: 1 });
    const open = record({ id: "2", sequence: 2 });
    const last = record({ id: "3", sequence: 3 });
    const [group] = groupByFile([first, last, open]);
    expect(group.records.map((r) => r.id)).toEqual(["1", "2", "3"]);
  });
});

describe("fillHint", () => {
  it("adds the reporter alone for the default folder", () => {
    const hint = fillHint("/p/a11y-snapshots/records", null);
    expect(hint).toContain(
      'reporters: ["default", "@real-a11y-dev/testing/reporter"]',
    );
    expect(hint).not.toContain("outputDir");
  });

  it("names the folder you gave, for both runners", () => {
    const hint = fillHint("/p/reports/a11y", "reports/a11y");
    expect(hint).toContain(
      '["@real-a11y-dev/testing/reporter", { outputDir: "reports/a11y" }]',
    );
    expect(hint).toContain(
      '["@real-a11y-dev/testing/reporter/jest", { outputDir: "reports/a11y" }]',
    );
  });

  it("writes a Windows path so that it can be pasted", () => {
    expect(fillHint("C:\\p", "reports\\a11y")).toContain(
      '{ outputDir: "reports\\\\a11y" }',
    );
  });

  it("gives the dev server's folder as the variable that fills it", () => {
    expect(fillHint("/repo/.a11y-trees")).toBe(
      "REAL_A11Y_TREES_DIR=/repo/.a11y-trees vitest run",
    );
  });
});
