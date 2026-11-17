import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import A11ySnapshotJestReporter from "./reporter-jest.js";
import A11ySnapshotReporter from "./reporter.js";
import { recordFolder, TREES_DIR_ENV } from "./snapshot-record.js";

let root: string;
const envBefore = process.env[TREES_DIR_ENV];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "a11y-reporters-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  if (envBefore === undefined) delete process.env[TREES_DIR_ENV];
  else process.env[TREES_DIR_ENV] = envBefore;
});

/** A record file as the recorder would leave it for `file` in `project`. */
function recordFor(file: string, project?: string): string {
  const path = join(
    root,
    "a11y-snapshots",
    "records",
    recordFolder(file, project),
    "t-1.json",
  );
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "{}");
  return path;
}

const silent = { log: () => {} };

describe("the Vitest reporter", () => {
  it("clears a rerun file's records in its own project only", () => {
    const reporter = new A11ySnapshotReporter();
    const env: Record<string, string | undefined> = {};
    reporter.onInit({ config: { root, env }, logger: silent });
    expect(env[TREES_DIR_ENV]).toBe(join(root, "a11y-snapshots", "records"));

    const web = recordFor("src/a.test.ts", "web");
    const node = recordFor("src/a.test.ts", "node");
    reporter.onTestRunStart([
      {
        moduleId: join(process.cwd(), "src", "a.test.ts"),
        project: { name: "web" },
      },
    ]);

    expect(existsSync(web)).toBe(false);
    expect(existsSync(node)).toBe(true);
  });

  it("clears nothing when it merges the shards' reports", () => {
    new A11ySnapshotReporter().onInit({ config: { root }, logger: silent });
    const kept = recordFor("src/a.test.ts");

    const merging = new A11ySnapshotReporter();
    merging.onInit({ config: { root, mergeReports: "blobs" }, logger: silent });
    merging.onTestRunStart([
      { moduleId: join(process.cwd(), "src", "a.test.ts") },
    ]);

    expect(existsSync(kept)).toBe(true);
  });
});

describe("the Jest reporter", () => {
  it("clears the records once a process, not on each watch run", () => {
    new A11ySnapshotJestReporter({ rootDir: root });
    const kept = recordFor("src/b.test.ts");

    // Jest builds its reporters again for each run in watch mode.
    new A11ySnapshotJestReporter({ rootDir: root });

    expect(existsSync(kept)).toBe(true);
  });
});
