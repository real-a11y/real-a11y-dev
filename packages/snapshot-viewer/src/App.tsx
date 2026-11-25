import type { ExtractionResult, TreeViewMode } from "@real-a11y-dev/core";
import {
  diffTreeRows,
  TreePanel,
  type TreeChangesProp,
} from "@real-a11y-dev/semantic-navigator-ui";
import { useMemo, useState } from "preact/hooks";

import { snapshotDiffRules } from "./marks.js";
import {
  countLines,
  fillHint,
  groupByFile,
  kindLabel,
  lineKind,
  openingView,
  readableRecords,
  splitTestName,
  toExtraction,
  type FileGroup,
  type SnapshotRecord,
} from "./records.js";
import { useOpenRecord, useRecords } from "./use-records.js";

type Side = "after" | "before";

interface Trees {
  after: ExtractionResult;
  before: ExtractionResult | null;
}

const NO_RECORDS: SnapshotRecord[] = [];

export function App() {
  const { loaded, error, stopped } = useRecords();
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    recordInHash(),
  );
  const [query, setQuery] = useState("");

  const readable = useMemo(
    () => (loaded ? readableRecords(loaded.records) : NO_RECORDS),
    [loaded],
  );
  const all = useMemo(() => groupByFile(readable), [readable]);
  const { selected, goneId, listed } = useOpenRecord(readable, all, selectedId);
  // The filter narrows the list, never what is open: typing into it doesn't
  // swap the record on screen.
  const groups = useMemo(() => filterGroups(listed, query), [listed, query]);
  const otherVersion = (loaded?.records.length ?? 0) - readable.length;

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
        goneId={goneId}
        stopped={stopped}
        leftOut={selected ? otherVersion : 0}
        query={query}
        filtered={listed.length > 0 && groups.length === 0}
        onQuery={setQuery}
        onSelect={select}
      />
      <main class="sv-main">
        {error ? (
          <p class="sv-empty">Couldn't load the records: {error}</p>
        ) : !loaded ? (
          <p class="sv-empty">Loading…</p>
        ) : selected ? (
          <RecordView
            key={selected.id}
            record={selected}
            gone={selected.id === goneId}
          />
        ) : (
          <Empty
            dir={loaded.dir}
            outputDir={loaded.outputDir}
            otherVersion={otherVersion}
          />
        )}
      </main>
    </div>
  );
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
  goneId,
  stopped,
  leftOut,
  query,
  filtered,
  onQuery,
  onSelect,
}: {
  groups: FileGroup[];
  selectedId: string | null;
  /** The record that is open but not in the latest records. */
  goneId: string | null;
  /** The server this page follows has gone away. */
  stopped: boolean;
  /** Records of another release, left out of the list. */
  leftOut: number;
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
        <p class="sv-nav-note sv-nav-stopped" role="status">
          {stopped ? (
            <>
              The report server has stopped, so this page no longer updates. Run{" "}
              <code>real-a11y show-report</code> again to follow new runs.
            </>
          ) : null}
        </p>
        <p class="sv-nav-note" role="status">
          {leftOut === 1
            ? "1 record from another release of @real-a11y-dev/testing isn't shown."
            : leftOut > 1
              ? `${leftOut} records from another release of @real-a11y-dev/testing aren't shown.`
              : null}
        </p>
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
                    gone={record.id === goneId}
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
  gone,
  onSelect,
}: {
  record: SnapshotRecord;
  current: boolean;
  gone: boolean;
  onSelect: () => void;
}) {
  const { path, name } = splitTestName(record.test);
  const counts = record.kind === "diff" ? countLines(record.text) : null;
  return (
    <button
      type="button"
      class={gone ? "sv-record sv-record-gone" : "sv-record"}
      aria-current={current ? "true" : undefined}
      onClick={onSelect}
    >
      <span class="sv-record-top">
        <KindBadge record={record} />
        <span class="sv-record-name">
          {name}
          {record.index > 1 ? (
            <span class="sv-record-index"> #{record.index}</span>
          ) : null}
          {gone ? (
            <span class="sn-sr-only"> (not in the latest records)</span>
          ) : null}
        </span>
      </span>
      {path ? <span class="sv-record-path">{path}</span> : null}
      {counts ? <Counts counts={counts} /> : null}
    </button>
  );
}

/** `ui`'s badge: a tree's in the interactive blue, its tab sequence's and its
 *  outline's too, and a diff's in changed amber. */
function KindBadge({ record }: { record: SnapshotRecord }) {
  const tone =
    record.kind === "tree" ? "sn-badge--interactive" : "sv-kind-diff";
  return <span class={`sn-badge sv-kind ${tone}`}>{kindLabel(record)}</span>;
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

function RecordView({
  record,
  gone,
}: {
  record: SnapshotRecord;
  /** It is still open, but the latest records no longer hold it. */
  gone: boolean;
}) {
  // A snapshot of the tab sequence opens on the TAB view, one of the outline
  // on the headings: the part of the tree its text printed.
  const opening = openingView(record);
  const [side, setSide] = useState<Side>("after");
  const [viewMode, setViewMode] = useState<TreeViewMode>(opening.viewMode);
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
        gone={gone}
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
            defaultRoleFilter={opening.roleFilter}
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
  gone,
  side,
  onSide,
}: {
  record: SnapshotRecord;
  gone: boolean;
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
        <KindBadge record={record} />
        <span>
          {record.project ? `${record.project} · ` : ""}
          {record.file}
        </span>
        <span>recorded {new Date(record.recordedAt).toLocaleString()}</span>
      </p>
      <p class="sv-gone" role="status">
        {gone
          ? "Not in the latest records: its test is rerunning, or no longer takes this snapshot."
          : ""}
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
  outputDir,
  otherVersion,
}: {
  dir?: string;
  outputDir?: string | null;
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
        Only boxed snapshots show up here: <code>boxedTreeSnapshot()</code>,{" "}
        <code>boxedTabSequenceSnapshot()</code>,{" "}
        <code>boxedOutlineSnapshot()</code> and <code>a11yDiff()</code>, from
        tests that called <code>registerA11yMatchers(expect)</code>. A snapshot
        of a plain string has no tree behind it.
      </p>
      {dir === undefined ? null : (
        <>
          <p>
            {outputDir === undefined
              ? "Record a test run into this folder."
              : "Add the snapshot report to your test runner and run your tests."}{" "}
            This page updates by itself.
          </p>
          <pre>{fillHint(dir, outputDir)}</pre>
          <p>
            Reading records from <code>{dir}</code>
          </p>
        </>
      )}
    </div>
  );
}
