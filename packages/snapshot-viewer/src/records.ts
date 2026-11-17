/**
 * The records the `testing` package's recorder writes, as the viewer reads
 * them. The shape mirrors `SnapshotRecord` in
 * `packages/testing/src/snapshot-record.ts`; `version` says which one.
 */
import type { ExtractionResult, SemanticNode } from "@real-a11y-dev/core";

export const RECORD_VERSION = 1;

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
  file: string;
  test: string;
  index: number;
  kind: "tree" | "diff";
  text: string;
  recordedAt: string;
  tree?: RecordedTree;
  before?: RecordedTree;
  after?: RecordedTree;
  focusBefore?: string | null;
  focusAfter?: string | null;
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
  file: string;
  records: SnapshotRecord[];
}

/**
 * The records by test file, each file's in the order its tests took them.
 * Only records of this viewer's version: another one's can't be read.
 */
export function groupByFile(records: SnapshotRecord[]): FileGroup[] {
  const byFile = new Map<string, SnapshotRecord[]>();
  for (const record of records) {
    if (record.version !== RECORD_VERSION) continue;
    const list = byFile.get(record.file) ?? [];
    list.push(record);
    byFile.set(record.file, list);
  }
  return [...byFile.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, list]) => ({
      file,
      records: list.sort(
        (a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.index - b.index,
      ),
    }));
}

/** `describe > describe > it` as its describe path and its own name. */
export function splitTestName(test: string): { path: string; name: string } {
  const parts = test.split(" > ");
  const name = parts.pop() ?? test;
  return { path: parts.join(" › "), name };
}
