/**
 * The snapshot report's recorder. With `REAL_A11Y_TREES_DIR` set — the
 * reporter (`reporter.ts`) sets it for a run — every boxed a11y snapshot a
 * test takes, `boxedTreeSnapshot` or `a11yDiff`, also writes the tree(s) its
 * text was printed from as JSON, so the viewer (`packages/snapshot-viewer`)
 * can draw them with the panel the extension uses: the states, the actions
 * and the change marks the text leaves out.
 *
 * The `.snap` text stays the assertion. This only ever writes beside it, and
 * never fails a test: a recorder that can't write says so once and stops.
 *
 * A record adds states and the rest of the tree, never a field value its
 * text didn't print: values are dropped unless the snapshot asked for
 * `values: true` (`withoutValue`), the extractor masks sensitive fields
 * itself (and withholds every value in strict mode), an editor's typed text
 * leaves the text previews of it and its ancestors, and the snapshot's own
 * `redact` patterns apply to what the page supplied (`redactedJson`).
 *
 * Only a box made from a tree records: a snapshot of a plain string (say
 * `expect(serializeTree(el)).toMatchSnapshot()`) has no tree to write.
 */

import type { ExtractionResult, SemanticNode } from "@real-a11y-dev/core";

import type { A11ySnapshotBox, SnapshotTrees } from "./snapshot-box.js";

/** The directory records go to; recording is off while it is unset. */
export const TREES_DIR_ENV = "REAL_A11Y_TREES_DIR";

/** Bumped when a record's shape changes; the viewer refuses others. */
export const RECORD_VERSION = 1;

/** An `ExtractionResult` as JSON can hold it: the node map as entries. */
export interface RecordedTree {
  nodes: [string, SemanticNode][];
  rootId: string;
  focusedId?: string;
  source: ExtractionResult["source"];
}

/** One boxed snapshot, as the viewer reads it. */
export interface SnapshotRecord {
  version: typeof RECORD_VERSION;
  /** The test file, relative to the run's working directory, `/`-separated. */
  file: string;
  /** The full test name, `describe > it`. */
  test: string;
  /** Which of the test's boxed snapshots this is, from 1, in the order taken. */
  index: number;
  kind: SnapshotTrees["kind"];
  /** The snapshot text, as the `.snap` holds it. */
  text: string;
  recordedAt: string;
  tree?: RecordedTree;
  before?: RecordedTree;
  after?: RecordedTree;
  focusBefore?: string | null;
  focusAfter?: string | null;
}

interface TestState {
  currentTestName?: string;
  testPath?: string;
  assertionCalls?: number;
}

interface ExpectLike {
  getState?(): TestState;
}

interface FsLike {
  mkdirSync(path: string, options: { recursive: true }): unknown;
  writeFileSync(path: string, data: string): void;
}

interface PathLike {
  join(...parts: string[]): string;
  resolve(...parts: string[]): string;
  relative(from: string, to: string): string;
  dirname(path: string): string;
  sep: string;
}

interface ProcessLike {
  env: Record<string, string | undefined>;
  cwd(): string;
  getBuiltinModule?(id: string): unknown;
}

let expectRef: ExpectLike | null = null;
let gaveUp = false;
// A box pretty-format prints twice (a failure message, say) records once.
const recorded = new WeakSet<object>();
// Per test file and name, how many boxed snapshots it has taken. Counted for
// as long as this module lives, which a runner gives each test file anew (and
// each rerun of it), so two tests that share a full name number on rather
// than write over each other.
const taken = new Map<string, number>();

/**
 * Where the recorder reads which test is running. `registerA11yMatchers` binds
 * the `expect` it is given; a serializer registered some other way reads the
 * runner's global `expect`, where Jest (and Vitest with `globals`) put it.
 */
export function bindSnapshotRecorder(expect: ExpectLike): void {
  expectRef = expect;
}

/**
 * Whether boxed snapshots are being recorded right now: what a box checks to
 * read its tree when it is made, rather than later.
 */
export function isRecording(): boolean {
  const proc = (globalThis as { process?: ProcessLike }).process;
  return !gaveUp && Boolean(proc?.env.REAL_A11Y_TREES_DIR);
}

/** Write `box`'s trees, if recording is on. Never throws. */
export function recordSnapshot(
  box: A11ySnapshotBox,
  trees: () => SnapshotTrees,
): void {
  if (gaveUp || recorded.has(box)) return;
  const proc = (globalThis as { process?: ProcessLike }).process;
  // Read by name, not through TREES_DIR_ENV, so the surface manifest sees
  // which package reads it.
  const dir = proc?.env.REAL_A11Y_TREES_DIR;
  if (!proc || !dir) return;
  recorded.add(box);
  try {
    const { fs, path } = builtins(proc);
    const { file, test, index } = takenBy(proc, path);

    const behind = trees();
    const record = toRecord(behind, { file, test, index, text: box.text });
    const json = redactedJson(record, globalPatterns(behind.redact));

    const target = path.join(
      path.resolve(proc.cwd(), dir),
      recordFolder(file),
      `${slug(test)}-${hash(test)}-${index}.json`,
    );
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, json);
  } catch (error) {
    gaveUp = true;
    console.warn(
      `[real-a11y] ${TREES_DIR_ENV} is set but the snapshot recorder can't ` +
        `write, so it stops for this run: ${(error as Error).message}`,
    );
  }
}

/** `node:fs` and `node:path`, reached without an import a browser bundle
 *  would have to resolve. */
function builtins(proc: ProcessLike): { fs: FsLike; path: PathLike } {
  const fs = proc.getBuiltinModule?.("node:fs") as FsLike | undefined;
  const path = proc.getBuiltinModule?.("node:path") as PathLike | undefined;
  if (!fs || !path) {
    throw new Error("needs Node 20.16+ (process.getBuiltinModule)");
  }
  return { fs, path };
}

/** Which test took the snapshot, and which of its snapshots this is. */
function takenBy(
  proc: ProcessLike,
  path: PathLike,
): { file: string; test: string; index: number } {
  const expect =
    expectRef ?? (globalThis as { expect?: ExpectLike }).expect ?? null;
  const state = expect?.getState?.() ?? {};
  const test = state.currentTestName ?? "(unknown test)";
  const file = state.testPath
    ? path.relative(proc.cwd(), state.testPath).split(path.sep).join("/")
    : "(unknown file)";
  const key = `${file}\0${test}`;
  const index = (taken.get(key) ?? 0) + 1;
  taken.set(key, index);
  return { file, test, index };
}

function toRecord(
  trees: SnapshotTrees,
  meta: Pick<SnapshotRecord, "file" | "test" | "index" | "text">,
): SnapshotRecord {
  const base = {
    version: RECORD_VERSION,
    ...meta,
    kind: trees.kind,
    recordedAt: new Date().toISOString(),
  } as const;
  const values = trees.values === true;
  if (trees.kind === "tree") {
    return { ...base, tree: toJsonTree(trees.tree, values) };
  }
  return {
    ...base,
    before: toJsonTree(trees.before, values),
    after: toJsonTree(trees.after, values),
    focusBefore: trees.focusBefore,
    focusAfter: trees.focusAfter,
  };
}

/**
 * The attributes that hold what a field was given: the ones strict mode
 * withholds (`RedactInputOption` in core's `strict-mode.ts`).
 */
const VALUE_ATTRIBUTES = ["value", "aria-valuenow", "aria-valuetext"];

/**
 * `tree` as JSON can hold it. Without `values`, no node keeps what a field
 * holds, as the snapshot's text prints none: a record must not carry what its
 * text left out on purpose.
 */
function toJsonTree(tree: ExtractionResult, values: boolean): RecordedTree {
  const nodes = [...tree.nodes.entries()];
  const above = values ? new Set<string>() : aboveValues(tree);
  return {
    nodes: values
      ? nodes
      : nodes.map(([id, node]) => [id, withoutValue(node, above.has(id))]),
    rootId: tree.rootId,
    focusedId: tree.focusedId,
    source: tree.source,
  };
}

/**
 * The nodes above a field that holds a value, whose `descendantText` takes in
 * what was typed into an editor below them. Their own `textContent` is only
 * their own text nodes', so it stays.
 */
function aboveValues(tree: ExtractionResult): Set<string> {
  const above = new Set<string>();
  for (const node of tree.nodes.values()) {
    if (node.a11y.value === undefined) continue;
    let id = node.parentId;
    while (id !== null && !above.has(id)) {
      above.add(id);
      id = tree.nodes.get(id)?.parentId ?? null;
    }
  }
  return above;
}

/**
 * `node` without what a field holds. A field that holds a value loses both
 * text previews, which for an editor are what was typed; a node above one
 * (`aboveValue`) loses only `descendantText`.
 */
function withoutValue(node: SemanticNode, aboveValue: boolean): SemanticNode {
  const holder = node.a11y.value !== undefined;
  const attributes = node.dom?.attributes;
  const valueAttribute =
    attributes !== undefined &&
    VALUE_ATTRIBUTES.some((name) => name in attributes);
  if (!holder && !aboveValue && !valueAttribute) return node;
  const { value: _value, ...a11y } = node.a11y;
  const kept = { ...node, a11y };
  if (node.dom) {
    const rest = { ...node.dom.attributes };
    for (const name of VALUE_ATTRIBUTES) delete rest[name];
    kept.dom = { ...node.dom, attributes: rest };
    if (holder) kept.dom.textContent = null;
    if (holder || aboveValue) kept.dom.descendantText = "";
  }
  return kept;
}

/** The fields of a node whose text a page supplied: what `redact` reaches. */
const CONTENT_KEYS = new Set([
  "name",
  "description",
  "value",
  "textContent",
  "descendantText",
  "locator",
]);

/**
 * `record` as JSON, its `redact` patterns applied to what the page supplied:
 * names, descriptions, values, text, and every attribute and property value,
 * the page's own element ids and the references to them included. Never to a
 * node's id (`sn-<n>`), which the record mints and builds its tree from: a
 * pattern like `/\d+/` would turn them all into one id and collapse the rows.
 *
 * An element id is redacted where it is declared and where it is referred to
 * alike, so a link between two rows survives unless the pattern makes two
 * ids one. That is the trade: a secret in an id must not outlive the text
 * that withheld it.
 */
function redactedJson(record: SnapshotRecord, redact: RegExp[]): string {
  if (redact.length === 0) return JSON.stringify(record);
  const keyed = new WeakSet<object>();
  for (const tree of [record.tree, record.before, record.after]) {
    for (const [, node] of tree?.nodes ?? []) {
      // Guarded: a WeakSet throws on anything that isn't an object.
      if (node.dom?.attributes) keyed.add(node.dom.attributes);
      if (node.a11y.properties) keyed.add(node.a11y.properties);
    }
  }
  return JSON.stringify(
    record,
    function (this: unknown, key: string, value: unknown) {
      if (typeof value !== "string") return value;
      const content = keyed.has(this as object) || CONTENT_KEYS.has(key);
      return content ? redactText(value, redact) : value;
    },
  );
}

/** As `serializeTree` treats them: every pattern global, so every match goes. */
function globalPatterns(patterns: RegExp[] | undefined): RegExp[] {
  return (patterns ?? []).map((p) =>
    p.global ? p : new RegExp(p.source, `${p.flags}g`),
  );
}

function redactText(input: string, patterns: RegExp[]): string {
  let out = input;
  for (const p of patterns) out = out.replace(p, "[REDACTED]");
  return out;
}

/**
 * The folder a test file's records go in, under the records directory.
 * `file` is the test file relative to the run's working directory, with
 * either separator: the snapshot report clears a file's folder when the
 * runner runs it again. The hash keeps two paths that slug alike apart
 * (`src/foo-bar.test.ts` and `src/foo/bar.test.ts`).
 */
export function recordFolder(file: string): string {
  const path = file.split("\\").join("/");
  return `${slug(path)}-${hash(path)}`;
}

/** A file-name-safe stand-in for `text`, short enough for Windows paths. */
function slug(text: string): string {
  const out = text
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return out || "snapshot";
}

/** Keeps two names that slug alike, or past the cut, apart. */
function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = (h * 33) ^ text.charCodeAt(i);
  return (h >>> 0).toString(36);
}
