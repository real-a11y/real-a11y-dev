/**
 * The records the `testing` package's recorder writes, as the viewer reads
 * them. The shape mirrors `SnapshotRecord` in
 * `packages/testing/src/snapshot-record.ts`; `version` says which one.
 */
import type {
  ExtractionResult,
  RoleFilter,
  SemanticNode,
  TreeViewMode,
} from "@real-a11y-dev/core";

export const RECORD_VERSION = 2;

export interface RecordedTree {
  nodes: [string, SemanticNode][];
  rootId: string;
  focusedId?: string;
  source: ExtractionResult["source"];
}

export interface SnapshotRecord {
  /** The record's path in the records directory: its identity here. */
  id: string;
  version: number;
  /** The Vitest project that ran the file, when it has a name. */
  project?: string;
  file: string;
  test: string;
  index: number;
  /** The order the test file took its records in. */
  sequence: number;
  kind: "tree" | "diff";
  text: string;
  recordedAt: string;
  tree?: RecordedTree;
  /** A tree's view, for a snapshot of its tab sequence or its outline. A
   *  record written before there was one has none. */
  view?: "tab" | "headings";
  before?: RecordedTree;
  after?: RecordedTree;
  focusBefore?: string | null;
  focusAfter?: string | null;
}

/** Where the panel opens on a record: what its snapshot printed. */
export function openingView(record: SnapshotRecord): {
  viewMode: TreeViewMode;
  roleFilter: RoleFilter;
} {
  if (record.kind === "tree" && record.view === "tab") {
    return { viewMode: "tab", roleFilter: null };
  }
  if (record.kind === "tree" && record.view === "headings") {
    return { viewMode: "a11y", roleFilter: "heading" };
  }
  return { viewMode: "a11y", roleFilter: null };
}

/** The word a record's badge says: what its snapshot printed. */
export function kindLabel(record: SnapshotRecord): string {
  if (record.kind === "tree" && record.view === "tab") return "tabs";
  if (record.kind === "tree" && record.view === "headings") return "outline";
  return record.kind;
}

/**
 * The facets a native tree's nodes can lack, as a row that has neither says
 * them: a node Chrome reports carries no `dom`, and a read-only one no
 * `interaction`, while the panel's rows (`TreeNode.tsx`) read both on every
 * node.
 */
const TAKES_NOTHING = {
  isInteractive: false,
  actions: [],
  isFocusable: false,
  isEditable: false,
};
const NO_ELEMENT = {
  tagName: "",
  attributes: {},
  textContent: null,
  descendantText: "",
  isHidden: false,
};

/** A recorded tree as the panel takes it, every row open. */
export function toExtraction(recorded: RecordedTree): ExtractionResult {
  const nodes = new Map<string, SemanticNode>();
  for (const [id, node] of recorded.nodes) {
    nodes.set(id, {
      ...node,
      dom: node.dom ?? NO_ELEMENT,
      interaction: node.interaction ?? TAKES_NOTHING,
      ui: {
        expanded: true,
        highlighted: false,
        matchesFilter: true,
        selected: false,
      },
    });
  }
  return {
    nodes,
    rootId: recorded.rootId,
    focusedId: recorded.focusedId,
    source: recorded.source,
  };
}

export interface LineCounts {
  added: number;
  removed: number;
  changed: number;
}

/** What a diff's text says it holds, line by line. */
export function countLines(text: string): LineCounts {
  const counts = { added: 0, removed: 0, changed: 0 };
  for (const line of text.split("\n")) {
    if (line.startsWith("+ ")) counts.added++;
    else if (line.startsWith("- ")) counts.removed++;
    else if (line.startsWith("~ ")) counts.changed++;
  }
  return counts;
}

/** The kind of line a snapshot's text holds, for colouring it. */
export function lineKind(
  line: string,
): "added" | "removed" | "changed" | "focus" | null {
  if (line.startsWith("+ ")) return "added";
  if (line.startsWith("- ")) return "removed";
  if (line.startsWith("~ ")) return "changed";
  if (line.startsWith("focus: ")) return "focus";
  return null;
}

export interface FileGroup {
  /** The test file, after its Vitest project's name when it has one. */
  label: string;
  file: string;
  records: SnapshotRecord[];
}

/** The records this viewer can draw: another version's shape isn't known. */
export function readableRecords(records: SnapshotRecord[]): SnapshotRecord[] {
  return records.filter((record) => record.version === RECORD_VERSION);
}

/**
 * The records just loaded, each one that hasn't changed still the object it
 * was: the panel on screen keeps the rows you opened when another test reruns.
 */
export function keepUnchanged(
  previous: SnapshotRecord[],
  next: SnapshotRecord[],
): SnapshotRecord[] {
  const byId = new Map(previous.map((record) => [record.id, record]));
  return next.map((record) => {
    const old = byId.get(record.id);
    return old !== undefined &&
      old.recordedAt === record.recordedAt &&
      old.text === record.text
      ? old
      : record;
  });
}

/** The records by test file and project, each file's in the order its tests
 *  took them. */
export function groupByFile(records: SnapshotRecord[]): FileGroup[] {
  const byFile = new Map<string, FileGroup>();
  for (const record of records) {
    const label = record.project
      ? `${record.project} · ${record.file}`
      : record.file;
    const group = byFile.get(label) ?? {
      label,
      file: record.file,
      records: [],
    };
    group.records.push(record);
    byFile.set(label, group);
  }
  return [...byFile.values()]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((group) => ({
      ...group,
      records: group.records.sort((a, b) => a.sequence - b.sequence),
    }));
}

/**
 * How to fill the folder a server reads. `outputDir` is what `show-report` says
 * of it: null for the reporter's default, or the folder you named. The viewer's
 * dev server says nothing, and reads a bare folder of records.
 */
export function fillHint(dir: string, outputDir?: string | null): string {
  if (outputDir === undefined) return `REAL_A11Y_TREES_DIR=${dir} vitest run`;
  const entry = (reporter: string): string =>
    outputDir === null
      ? JSON.stringify(reporter)
      : `[${JSON.stringify(reporter)}, { outputDir: ${JSON.stringify(outputDir)} }]`;
  return [
    "// Vitest",
    `reporters: ["default", ${entry("@real-a11y-dev/testing/reporter")}]`,
    "// Jest",
    `reporters: ["default", ${entry("@real-a11y-dev/testing/reporter/jest")}]`,
  ].join("\n");
}

/** `describe > describe > it` as its describe path and its own name. */
export function splitTestName(test: string): { path: string; name: string } {
  const parts = test.split(" > ");
  const name = parts.pop() ?? test;
  return { path: parts.join(" › "), name };
}
