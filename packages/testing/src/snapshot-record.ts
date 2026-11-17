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
 * A record adds states and the rest of the tree, never what was typed into
 * the page: no field keeps its value, even where the text printed it
 * (`values: true`), as no view of the panel shows one; an editor keeps none
 * of what is inside it, and the nodes above a field none of its text
 * (`recorded-tree.ts`). The extractor masks sensitive fields itself, and
 * withholds more in strict mode. The snapshot's own `redact` patterns apply
 * to what the page supplied (`redactedJson`).
 *
 * Only a box made from a tree records: a snapshot of a plain string (say
 * `expect(serializeTree(el)).toMatchSnapshot()`) has no tree to write.
 */

import { toRecordedTree, type RecordedTree } from "./recorded-tree.js";
import type { A11ySnapshotBox, SnapshotTrees } from "./snapshot-box.js";

export type { RecordedTree } from "./recorded-tree.js";

/** The directory records go to; recording is off while it is unset. */
export const TREES_DIR_ENV = "REAL_A11Y_TREES_DIR";

/** Bumped when a record's shape changes; the viewer refuses others. */
export const RECORD_VERSION = 2;

/** One boxed snapshot, as the viewer reads it. */
export interface SnapshotRecord {
  version: typeof RECORD_VERSION;
  /** The Vitest project that ran the file, when it has a name. */
  project?: string;
  /** The test file, relative to the run's working directory, `/`-separated. */
  file: string;
  /** The full test name, `describe > it`. */
  test: string;
  /** Which of the test's boxed snapshots this is, from 1, in the order taken. */
  index: number;
  /** Which of the test file's records this is, from 1: the order taken,
   *  whatever a test does to the clock. */
  sequence: number;
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
}

interface ExpectLike {
  getState?(): TestState;
}

/** What Vitest's worker state says of the test running, where it has one. */
interface VitestWorkerLike {
  current?: {
    id?: string;
    concurrent?: boolean;
    result?: { retryCount?: number; repeatCount?: number };
  };
  ctx?: { projectName?: string };
}

interface FsLike {
  mkdirSync(path: string, options: { recursive: true }): unknown;
  writeFileSync(path: string, data: string): void;
  rmSync(path: string, options: { force: true }): void;
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

/** The test that took a snapshot, as the runner says. */
interface Running {
  test: string;
  testPath: string;
  project: string | undefined;
  /** The runner's id for this one test, where it says: two tests that share
   *  a name are two tasks. */
  taskId: string | undefined;
  concurrent: boolean;
  /** Which try of the test this is: a retry or a repeat starts its own. */
  attempt: string;
}

/** What one test has written in its current try. */
interface Try {
  attempt: string;
  /** The index its first snapshot took: a new try numbers from there. */
  first: number;
  written: string[];
}

// The real clock, taken before a test can fake it: a record's time is when
// it was taken, not what `vi.setSystemTime` says.
const RealDate = Date;

let expectRef: ExpectLike | null = null;
let gaveUp = false;
let sequence = 0;
const said = new Set<string>();
// A box pretty-format prints twice (a failure message, say) records once.
const recorded = new WeakSet<object>();
// Per test file and name, how many boxed snapshots it has taken. Counted for
// as long as this module lives, which a runner gives each test file anew (and
// each rerun of it), so two tests that share a full name number on rather
// than write over each other.
const taken = new Map<string, number>();
// Per test (the runner's task, or the file and name where it names none),
// its current try: what a retry deletes, and only of that test.
const tries = new Map<string, Try>();

/**
 * Where the recorder reads which test is running. `registerA11yMatchers` binds
 * the `expect` it is given; a serializer registered some other way reads the
 * runner's global `expect`: Jest's, or Vitest's, which it keeps under a
 * symbol with `globals` off too.
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
  const running = runningTest();
  if (!running) {
    return sayOnce(
      "can't tell which test took a boxed snapshot, so it isn't recorded: " +
        "register the serializer with registerA11yMatchers(expect)",
    );
  }
  if (running.concurrent) {
    return sayOnce(
      "snapshots of concurrent tests aren't recorded: the runner can't say " +
        "which of the tests running together took one",
    );
  }
  try {
    write(proc, dir, running, { text: box.text, behind: trees() });
  } catch (error) {
    gaveUp = true;
    console.warn(
      `[real-a11y] ${TREES_DIR_ENV} is set but the snapshot recorder can't ` +
        `write, so it stops for this run: ${(error as Error).message}`,
    );
  }
}

function write(
  proc: ProcessLike,
  dir: string,
  running: Running,
  { text, behind }: { text: string; behind: SnapshotTrees },
): void {
  const { fs, path } = builtins(proc);
  const file = path
    .relative(proc.cwd(), running.testPath)
    .split(path.sep)
    .join("/");
  const group = `${file}\0${running.test}`;
  const slot = takeSlot(fs, group, running.taskId ?? group, running.attempt);
  const record = toRecord(behind, {
    ...(running.project ? { project: running.project } : {}),
    file,
    test: running.test,
    index: slot.index,
    text,
  });
  const target = path.join(
    path.resolve(proc.cwd(), dir),
    recordFolder(file, running.project),
    `${slug(running.test)}-${hash(running.test)}-${slot.index}.json`,
  );
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, redactedJson(record, globalPatterns(behind.redact)));
  slot.written.push(target);
}

function sayOnce(message: string): void {
  if (said.has(message)) return;
  said.add(message);
  console.warn(`[real-a11y] ${message}.`);
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

/**
 * The test that is running, from the `expect` it asserts through. Vitest's
 * worker state adds what `expect` doesn't say: the project, a concurrent
 * test (whose snapshot the shared `expect` can't place), and which try this
 * is. Jest says none of those, so a Jest retry keeps its failed try's
 * records.
 */
function runningTest(): Running | null {
  const scope = globalThis as unknown as Record<PropertyKey, unknown>;
  const expect =
    expectRef ??
    (scope["expect"] as ExpectLike | undefined) ??
    (scope[Symbol.for("expect-global")] as ExpectLike | undefined);
  const state = expect?.getState?.();
  if (!state?.currentTestName || !state.testPath) return null;
  return {
    test: state.currentTestName,
    testPath: state.testPath,
    ...vitestTask(scope["__vitest_worker__"] as VitestWorkerLike | undefined),
  };
}

/** What Vitest's worker state adds; nothing, under another runner. */
function vitestTask(
  worker: VitestWorkerLike | undefined,
): Pick<Running, "project" | "taskId" | "concurrent" | "attempt"> {
  const task = worker?.current;
  const retry = task?.result?.retryCount ?? 0;
  const repeat = task?.result?.repeatCount ?? 0;
  return {
    project: worker?.ctx?.projectName || undefined,
    taskId: task?.id,
    concurrent: task?.concurrent === true,
    attempt: `${retry}/${repeat}`,
  };
}

/**
 * The next snapshot of the test `task`, numbered in its name's `group`. A
 * new try deletes only the records this test's last try wrote, and numbers
 * again from where that try started, as the runner's own snapshot count
 * does: a retried test shows the try that counted, and another test that
 * shares its name keeps its own. Tests run one at a time here (concurrent
 * ones aren't recorded), so nothing else took a number in between.
 */
function takeSlot(
  fs: FsLike,
  group: string,
  task: string,
  attempt: string,
): { index: number; written: string[] } {
  let mine = tries.get(task);
  if (mine && mine.attempt !== attempt) {
    for (const path of mine.written) fs.rmSync(path, { force: true });
    taken.set(group, mine.first - 1);
    mine = undefined;
  }
  const index = (taken.get(group) ?? 0) + 1;
  taken.set(group, index);
  if (!mine) {
    mine = { attempt, first: index, written: [] };
    tries.set(task, mine);
  }
  return { index, written: mine.written };
}

function toRecord(
  trees: SnapshotTrees,
  meta: Pick<SnapshotRecord, "project" | "file" | "test" | "index" | "text">,
): SnapshotRecord {
  const base = {
    version: RECORD_VERSION,
    ...meta,
    sequence: ++sequence,
    kind: trees.kind,
    recordedAt: new RealDate().toISOString(),
  } as const;
  if (trees.kind === "tree") {
    return { ...base, tree: toRecordedTree(trees.tree).recorded };
  }
  const before = toRecordedTree(trees.before);
  const after = toRecordedTree(trees.after);
  return {
    ...base,
    before: before.recorded,
    after: after.recorded,
    focusBefore: before.shownAs(trees.focusBefore),
    focusAfter: after.shownAs(trees.focusAfter),
  };
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
 * The attributes and properties that hold structure, not the page's prose:
 * the viewer reads them as numbers and states, so a pattern aimed at a name
 * must not renumber the tab order or a heading's level. Every other one is
 * redacted, as an unknown attribute may hold anything.
 */
const STRUCTURAL_KEYS = new Set([
  "level",
  "posinset",
  "setsize",
  "tabindex",
  "role",
  "type",
  "size",
  "multiple",
  "method",
  "aria-expanded",
  "aria-hidden",
  "aria-checked",
  "aria-disabled",
  "aria-required",
  "aria-haspopup",
  "aria-valuemin",
  "aria-valuemax",
  "controls",
  "autoplay",
  "muted",
  "loop",
]);

/**
 * `record` as JSON, its `redact` patterns applied to what the page supplied:
 * names, descriptions, text, and the attribute and property values that are
 * not structure (`STRUCTURAL_KEYS`), the page's own element ids and the
 * references to them included. Never to a node's id (`sn-<n>`), which the
 * record mints and builds its tree from: a pattern like `/\d+/` would turn
 * them all into one id and collapse the rows.
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
      const content = keyed.has(this as object)
        ? !STRUCTURAL_KEYS.has(key)
        : CONTENT_KEYS.has(key);
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
 * The folder a test file's records go in, under the records directory: one
 * per test file and Vitest project, so two projects that run one file keep
 * their records apart. `file` is the test file relative to the run's working
 * directory, with either separator: the snapshot report clears a file's
 * folder when the runner runs it again. The hash keeps two paths that slug
 * alike apart (`src/foo-bar.test.ts` and `src/foo/bar.test.ts`).
 */
export function recordFolder(file: string, project?: string): string {
  const path = file.split("\\").join("/");
  const key = project ? `${project}:${path}` : path;
  return `${slug(key)}-${hash(key)}`;
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
