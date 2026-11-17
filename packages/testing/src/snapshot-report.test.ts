import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  recordFolder,
  TREES_DIR_ENV,
  type SnapshotRecord,
} from "./snapshot-record.js";
import {
  readRecords,
  renderReport,
  SnapshotReport,
} from "./snapshot-report.js";

let dir: string;
const envBefore = process.env[TREES_DIR_ENV];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "a11y-report-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (envBefore === undefined) delete process.env[TREES_DIR_ENV];
  else process.env[TREES_DIR_ENV] = envBefore;
});

function record(over: Partial<SnapshotRecord> = {}): SnapshotRecord {
  return {
    version: 1,
    file: "src/form.test.ts",
    test: "form > shows an error",
    index: 1,
    kind: "tree",
    text: 'button "Go"',
    recordedAt: "2026-11-16T00:00:00.000Z",
    tree: { nodes: [], rootId: "n1", source: { producer: "dom" } },
    ...over,
  };
}

function write(path: string, content: string): void {
  mkdirSync(join(dir, path, ".."), { recursive: true });
  writeFileSync(join(dir, path), content);
}

describe("readRecords", () => {
  it("reads every record under the directory, each with its path as id", () => {
    write("src-form-test-ts/a-1.json", JSON.stringify(record()));
    write("src-nav-test-ts/b-1.json", JSON.stringify(record({ index: 2 })));

    const ids = readRecords(dir)
      .map((r) => r.id)
      .sort();
    expect(ids).toEqual([
      "src-form-test-ts/a-1.json",
      "src-nav-test-ts/b-1.json",
    ]);
  });

  it("skips what the page can't draw: another version, or no JSON", () => {
    write("a/ok-1.json", JSON.stringify(record()));
    write("a/old-1.json", JSON.stringify({ ...record(), version: 0 }));
    write("a/half-1.json", '{"version": 1, "fi');

    expect(readRecords(dir).map((r) => r.id)).toEqual(["a/ok-1.json"]);
  });

  it("is empty for a directory that isn't there", () => {
    expect(readRecords(join(dir, "missing"))).toEqual([]);
  });
});

describe("renderReport", () => {
  const viewer = { js: "window.viewerRan = true;", css: "body{color:red}" };

  it("inlines the viewer and the records into one page", () => {
    const page = renderReport({ dir, records: [] }, viewer);

    expect(page).toContain("<style>body{color:red}</style>");
    expect(page).toContain("<script>window.viewerRan = true;</script>");
    expect(page).toContain("window.__A11Y_SNAPSHOTS__ = {");
    expect(page).not.toContain('type="module"');
  });

  it("lets nothing it inlines close the element it sits in", () => {
    const text = 'button "</script><script>alert(1)</script>"';
    const page = renderReport(
      { dir, records: [{ ...record({ text }), id: "x" }] },
      { js: 'const s = "</script>";', css: "a::after{content:'</style>'}" },
    );

    // Only the page's own tags close: two scripts, one style.
    expect(page.match(/<\/script>/g)).toHaveLength(2);
    expect(page.match(/<\/style>/g)).toHaveLength(1);
    // The data still reads back whole.
    const json = /window\.__A11Y_SNAPSHOTS__ = (.*);<\/script>/.exec(page)![1]!;
    expect(
      (JSON.parse(json) as { records: SnapshotRecord[] }).records[0]!.text,
    ).toBe(text);
  });
});

describe("SnapshotReport", () => {
  const viewer = { js: "/* viewer */", css: "/* css */" };

  it("starts from nothing and switches the recorder on", () => {
    const report = new SnapshotReport(dir);
    write("records/old-test-ts/gone-1.json", JSON.stringify(record()));

    report.start();

    expect(existsSync(join(dir, "records"))).toBe(false);
    expect(process.env[TREES_DIR_ENV]).toBe(join(dir, "records"));
  });

  it("drops one test file's records and keeps the others'", () => {
    const report = new SnapshotReport(dir);
    const rerun = join(process.cwd(), "src", "form.test.ts");
    const kept = join(process.cwd(), "src", "nav.test.ts");
    const folderOf = (file: string) =>
      join("records", recordFolder(file.slice(process.cwd().length + 1)));
    write(join(folderOf(rerun), "a-1.json"), JSON.stringify(record()));
    write(join(folderOf(kept), "b-1.json"), JSON.stringify(record()));

    report.clearFile(rerun);

    expect(readRecords(report.recordsDir).map((r) => r.id)).toEqual([
      `${recordFolder("src/nav.test.ts")}/b-1.json`,
    ]);
  });

  it("writes index.html from every record there is", () => {
    const report = new SnapshotReport(dir);
    write("records/src-form-test-ts/a-1.json", JSON.stringify(record()));

    const { url, count } = report.write(viewer);

    expect(count).toBe(1);
    expect(url).toMatch(/^file:.*index\.html$/);
    const page = readFileSync(join(dir, "index.html"), "utf8");
    expect(page).toContain("/* viewer */");
    expect(page).toContain('"test":"form > shows an error"');
  });

  it("never throws from a clean-up it can't do", () => {
    // A path no file system accepts makes the delete itself throw.
    const report = new SnapshotReport(join(dir, "bad\0dir"));

    expect(() => report.start()).not.toThrow();
    expect(() => report.clearFile(join(dir, "x.test.ts"))).not.toThrow();
  });

  it("says why it couldn't write, rather than failing the run", () => {
    // The viewer ships in dist/viewer; from source there is none to read.
    const report = new SnapshotReport(dir);

    expect(report.writeAndSay()).toMatch(/couldn't write the report/);
  });
});
