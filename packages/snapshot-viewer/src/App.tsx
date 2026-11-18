import type { ExtractionResult, TreeViewMode } from "@real-a11y-dev/core";
import {
  diffTreeRows,
  TreePanel,
  type TreeChangesProp,
} from "@real-a11y-dev/semantic-navigator-ui";
import { useEffect, useMemo, useState } from "preact/hooks";

import { snapshotDiffRules } from "./marks.js";
import {
  countLines,
  groupByFile,
  keepUnchanged,
  lineKind,
  readableRecords,
  splitTestName,
  toExtraction,
  type FileGroup,
  type SnapshotRecord,
} from "./records.js";

interface Loaded {
  /** The records directory of the server showing them; a written report
   *  leaves it out. */
  dir?: string;
  records: SnapshotRecord[];
}

declare global {
  interface Window {
    /** Set by the snapshot report (`@real-a11y-dev/testing/reporter`), which
     *  writes the run's records into the page it makes. */
    __A11Y_SNAPSHOTS__?: Loaded;
  }
}

type Side = "after" | "before";

interface Trees {
  after: ExtractionResult;
  before: ExtractionResult | null;
}

const NO_RECORDS: SnapshotRecord[] = [];

export function App() {
  const { loaded, error } = useRecords();
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    recordInHash(),
  );
  const [query, setQuery] = useState("");

  const readable = useMemo(
    () => (loaded ? readableRecords(loaded.records) : NO_RECORDS),
    [loaded],
  );
  const all = useMemo(() => groupByFile(readable), [readable]);
  const groups = useMemo(() => filterGroups(all, query), [all, query]);
  // The filter narrows the list, never what is open: typing into it doesn't
  // swap the record on screen.
  const selected =
    readable.find((r) => r.id === selectedId) ?? all[0]?.records[0] ?? null;

  const select = (id: string) => {
    setSelectedId(id);
    history.replaceState(null, "", `#${encodeURIComponent(id)}`);
  };

  return (
    // `sn-theme-auto` lends the frame the panel's colours (`ui`'s themes.css).
    <div class="sv sn-theme-auto">
      <RecordList
        groups={groups}
        selectedId={selected?.id ?? null}
        query={query}
        filtered={all.length > 0 && groups.length === 0}
        onQuery={setQuery}
        onSelect={select}
      />
      <main class="sv-main">
        {error ? (
          <p class="sv-empty">Couldn't load the records: {error}</p>
        ) : !loaded ? (
          <p class="sv-empty">Loading…</p>
        ) : selected ? (
          <RecordView key={selected.id} record={selected} />
        ) : (
          <Empty
            dir={loaded.dir}
            otherVersion={loaded.records.length - readable.length}
          />
        )}
      </main>
    </div>
  );
}

/**
 * The records the page carries, when the snapshot report wrote them into it;
 * otherwise the server's (`real-a11y show-report`, or this package's dev
 * server), read again whenever it says they changed.
 */
function useRecords() {
  const [loaded, setLoaded] = useState<Loaded | null>(
    () => window.__A11Y_SNAPSHOTS__ ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (window.__A11Y_SNAPSHOTS__) return;
    // A run changes records faster than they load: only the latest load counts.
    let latest = 0;
    const load = (): void => {
      const mine = ++latest;
      fetch("/__records")
        .then((res) => res.json() as Promise<Loaded>)
        .then(
          (next) => {
            if (mine !== latest) return;
            setLoaded((previous) => ({
              ...next,
              records: keepUnchanged(previous?.records ?? [], next.records),
            }));
            setError(null);
          },
          (err: unknown) => {
            if (mine === latest) setError(String(err));
          },
        );
    };
    load();
    const changes = new EventSource("/__records/events");
    changes.addEventListener("records", load);
    // Connecting again means the server went away, and may have missed some.
    let connected = false;
    changes.onopen = () => {
      if (connected) load();
      connected = true;
    };
    return () => changes.close();
  }, []);
  return { loaded, error };
}

/** The record the URL names, if it names one readably: a hand-edited link
 *  opens on the first record rather than on nothing. */
function recordInHash(): string | null {
  try {
    return decodeURIComponent(location.hash.slice(1)) || null;
  } catch {
    return null;
  }
}

function filterGroups(groups: FileGroup[], query: string): FileGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  return groups
    .map((g) => ({
      ...g,
      records: g.records.filter(
        (r) =>
          r.test.toLowerCase().includes(q) || g.label.toLowerCase().includes(q),
      ),
    }))
    .filter((g) => g.records.length > 0);
}

function RecordList({
  groups,
  selectedId,
  query,
  filtered,
  onQuery,
  onSelect,
}: {
  groups: FileGroup[];
  selectedId: string | null;
  query: string;
  /** The filter hides every record there is. */
  filtered: boolean;
  onQuery: (query: string) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <nav class="sv-nav" aria-label="Snapshots">
      <div class="sv-nav-head">
        <h1>A11y snapshots</h1>
        <input
          type="search"
          class="sn-search"
          placeholder="Filter by test or file"
          aria-label="Filter snapshots"
          value={query}
          onInput={(e) => onQuery(e.currentTarget.value)}
        />
      </div>
      <div class="sv-nav-list">
        {filtered ? (
          <p class="sv-no-match" role="status">
            No snapshots match “{query.trim()}”.
          </p>
        ) : null}
        {groups.map((group) => (
          <section key={group.label} class="sv-file">
            <h2 class="sv-file-name" title={group.label}>
              {group.label}
            </h2>
            <ul>
              {group.records.map((record) => (
                <li key={record.id}>
                  <RecordButton
                    record={record}
                    current={record.id === selectedId}
                    onSelect={() => onSelect(record.id)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </nav>
  );
}

function RecordButton({
  record,
  current,
  onSelect,
}: {
  record: SnapshotRecord;
  current: boolean;
  onSelect: () => void;
}) {
  const { path, name } = splitTestName(record.test);
  const counts = record.kind === "diff" ? countLines(record.text) : null;
  return (
    <button
      type="button"
      class="sv-record"
      aria-current={current ? "true" : undefined}
      onClick={onSelect}
    >
      <span class="sv-record-top">
        <KindBadge kind={record.kind} />
        <span class="sv-record-name">
          {name}
          {record.index > 1 ? (
            <span class="sv-record-index"> #{record.index}</span>
          ) : null}
        </span>
      </span>
      {path ? <span class="sv-record-path">{path}</span> : null}
      {counts ? <Counts counts={counts} /> : null}
    </button>
  );
}

/** `ui`'s badge: a tree's in the interactive blue, a diff's in changed amber. */
function KindBadge({ kind }: { kind: SnapshotRecord["kind"] }) {
  const tone = kind === "tree" ? "sn-badge--interactive" : "sv-kind-diff";
  return <span class={`sn-badge sv-kind ${tone}`}>{kind}</span>;
}

function Counts({ counts }: { counts: ReturnType<typeof countLines> }) {
  return (
    <span class="sv-counts">
      {counts.added > 0 ? (
        <span class="sv-added">+{counts.added} added</span>
      ) : null}
      {counts.changed > 0 ? (
        <span class="sv-changed">~{counts.changed} changed</span>
      ) : null}
      {counts.removed > 0 ? (
        <span class="sv-removed">−{counts.removed} removed</span>
      ) : null}
      {counts.added + counts.changed + counts.removed === 0 ? (
        <span>no changes</span>
      ) : null}
    </span>
  );
}

/** Each side read fresh from the record: the panel opens and closes rows in
 *  place, on the tree it is given. */
function useTrees(record: SnapshotRecord): Trees | null {
  return useMemo(() => {
    if (record.kind === "tree" && record.tree) {
      return { after: toExtraction(record.tree), before: null };
    }
    if (record.before && record.after) {
      return {
        after: toExtraction(record.after),
        before: toExtraction(record.before),
      };
    }
    return null;
  }, [record]);
}

/**
 * What the after tree marks: what changed since the before capture, as the
 * view on screen shows rows, and what else the diff's text lists
 * (`marks.ts`). The DOM view's rows show classes and URLs the A11Y view's
 * don't, so its marks compare those too.
 */
function useChangeMarks(
  record: SnapshotRecord,
  trees: Trees | null,
  /** The view on screen, or null while the marks are off. */
  viewMode: TreeViewMode | null,
  onClear: () => void,
): TreeChangesProp | undefined {
  return useMemo(() => {
    if (!trees?.before || !viewMode) return undefined;
    const rules = snapshotDiffRules(
      viewMode,
      { tree: trees.before, focus: record.focusBefore },
      { tree: trees.after, focus: record.focusAfter },
    );
    return {
      marks: {
        changes: diffTreeRows(trees.before, trees.after, rules),
        seq: 1,
        announce: false,
      },
      clear: onClear,
      since: "the capture before",
      totals: true,
    };
  }, [record, trees, viewMode, onClear]);
}

function RecordView({ record }: { record: SnapshotRecord }) {
  const [side, setSide] = useState<Side>("after");
  const [viewMode, setViewMode] = useState<TreeViewMode>("a11y");
  const [marksOn, setMarksOn] = useState(true);
  const trees = useTrees(record);
  const changes = useChangeMarks(
    record,
    trees,
    side === "after" && marksOn ? viewMode : null,
    useMemo(() => () => setMarksOn(false), []),
  );

  if (!trees) {
    return <p class="sv-empty">This record holds no tree.</p>;
  }
  const shown = side === "before" && trees.before ? trees.before : trees.after;

  return (
    <article class="sv-record-view" aria-labelledby="sv-title">
      <RecordHeader
        record={record}
        side={trees.before ? side : null}
        onSide={(next) => {
          setSide(next);
          if (next === "after") setMarksOn(true);
        }}
      />
      <div class="sv-body">
        <section class="sv-panel" aria-label="Tree">
          <TreePanel
            key={`${record.id}:${side}`}
            treeData={shown}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            changes={changes}
            theme="auto"
          />
        </section>
        <SnapshotText text={record.text} />
      </div>
    </article>
  );
}

function RecordHeader({
  record,
  side,
  onSide,
}: {
  record: SnapshotRecord;
  /** Which tree of a diff shows; null for a record of one tree. */
  side: Side | null;
  onSide: (side: Side) => void;
}) {
  const { path, name } = splitTestName(record.test);
  return (
    <header class="sv-header">
      {path ? <p class="sv-crumbs">{path}</p> : null}
      <h2 id="sv-title">
        {name}
        <span class="sv-title-index"> · snapshot {record.index}</span>
      </h2>
      <p class="sv-meta">
        <KindBadge kind={record.kind} />
        <span>
          {record.project ? `${record.project} · ` : ""}
          {record.file}
        </span>
        <span>recorded {new Date(record.recordedAt).toLocaleString()}</span>
      </p>
      {side ? (
        // `ui`'s toggle, as the panel's DOM / A11Y / TAB.
        <div class="sn-toggle-group" role="group" aria-label="Which tree">
          <button
            type="button"
            class="sn-toggle-btn"
            aria-pressed={side === "after"}
            onClick={() => onSide("after")}
          >
            After, changes marked
          </button>
          <button
            type="button"
            class="sn-toggle-btn"
            aria-pressed={side === "before"}
            onClick={() => onSide("before")}
          >
            Before
          </button>
        </div>
      ) : null}
    </header>
  );
}

/** The snapshot's text as the `.snap` holds it, its change lines coloured. */
function SnapshotText({ text }: { text: string }) {
  return (
    <section class="sv-text" aria-labelledby="sv-text-title">
      <h3 id="sv-text-title">Snapshot text</h3>
      <pre>
        {text.split("\n").map((line, i) => (
          <span key={i} class={`sv-line sv-line-${lineKind(line) ?? "plain"}`}>
            {line}
            {"\n"}
          </span>
        ))}
      </pre>
    </section>
  );
}

function Empty({
  dir,
  otherVersion,
}: {
  dir?: string;
  /** Records there are, written in a shape this viewer can't read. */
  otherVersion: number;
}) {
  if (otherVersion > 0) {
    return (
      <div class="sv-empty">
        <h2>These snapshots can't be drawn here</h2>
        <p>
          {otherVersion === 1
            ? "One record was"
            : `${otherVersion} records were`}{" "}
          written by a different release of <code>@real-a11y-dev/testing</code>.
          Update it and <code>@real-a11y-dev/cli</code> to the same release,
          then run your tests again.
        </p>
      </div>
    );
  }
  return (
    <div class="sv-empty">
      <h2>No snapshots recorded</h2>
      <p>
        Only snapshots of <code>boxedTreeSnapshot()</code> and{" "}
        <code>a11yDiff()</code> show up here, from tests that called{" "}
        <code>registerA11yMatchers(expect)</code>. A snapshot of a plain string
        has no tree behind it.
      </p>
      {dir === undefined ? null : (
        <>
          <p>
            Add the snapshot report to your test runner and run your tests. This
            page updates by itself.
          </p>
          <pre>reporters: ["default", "@real-a11y-dev/testing/reporter"]</pre>
          <p>
            Reading records from <code>{dir}</code>
          </p>
        </>
      )}
    </div>
  );
}
