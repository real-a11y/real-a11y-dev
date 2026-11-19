import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import {
  groupByFile,
  keepUnchanged,
  type FileGroup,
  type SnapshotRecord,
} from "./records.js";

interface Loaded {
  /** The records directory of the server showing them; a written report
   *  leaves it out. */
  dir?: string;
  /** The folder `show-report` was told to read, or null for the default. */
  outputDir?: string | null;
  records: SnapshotRecord[];
}

declare global {
  interface Window {
    /** Set by the snapshot report (`@real-a11y-dev/testing/reporter`), which
     *  writes the run's records into the page it makes. */
    __A11Y_SNAPSHOTS__?: Loaded;
  }
}

/**
 * The records the page carries, when the snapshot report wrote them into it;
 * otherwise the server's (`real-a11y show-report`, or this package's dev
 * server), read again whenever it says they changed.
 *
 * A tab follows the server only while it shows. Each stream holds one of the
 * six connections a browser allows an origin, so tabs left open from earlier
 * runs would otherwise keep the next one from loading at all.
 */
export function useRecords() {
  const [loaded, setLoaded] = useState<Loaded | null>(
    () => window.__A11Y_SNAPSHOTS__ ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  useEffect(() => {
    if (window.__A11Y_SNAPSHOTS__) return;
    let shown: SnapshotRecord[] = [];
    // A run changes records faster than they load: only the latest load counts.
    let loading: AbortController | null = null;
    const load = (): void => {
      loading?.abort();
      const mine = new AbortController();
      loading = mine;
      fetch("/__records", { signal: mine.signal })
        .then((res) => res.json() as Promise<Loaded>)
        .then((next) => {
          if (mine.signal.aborted) return;
          shown = keepUnchanged(shown, next.records);
          setLoaded({ ...next, records: shown });
          setError(null);
        })
        .catch((err: unknown) => {
          if (!mine.signal.aborted) setError(String(err));
        });
    };

    let changes: EventSource | null = null;
    const follow = (): void => {
      if (document.hidden) {
        changes?.close();
        changes = null;
      } else if (!changes) {
        changes = new EventSource("/__records/events");
        changes.addEventListener("records", load);
        // Each time it opens: at first, back on this tab, or after the server
        // went away. Whatever changed until now, this load has.
        changes.onopen = () => {
          setStopped(false);
          load();
        };
        changes.onerror = () => setStopped(true);
      }
    };
    follow();
    document.addEventListener("visibilitychange", follow);
    return () => {
      document.removeEventListener("visibilitychange", follow);
      changes?.close();
      loading?.abort();
    };
  }, []);
  return { loaded, error, stopped };
}

/**
 * The record on screen. A rerun clears a test file's records before it writes
 * them again: what is open stays open through that, with the view and the side
 * you chose, and stays listed too, so its button keeps keyboard focus and its
 * place in the list.
 */
export function useOpenRecord(
  readable: SnapshotRecord[],
  all: FileGroup[],
  selectedId: string | null,
) {
  const open = useRef<SnapshotRecord | null>(null);
  const byId = (id?: string | null) => readable.find((r) => r.id === id);
  const selected =
    byId(selectedId) ??
    byId(open.current?.id) ??
    open.current ??
    all[0]?.records[0] ??
    null;
  open.current = selected;

  const gone = selected !== null && !readable.includes(selected);
  const listed = useMemo(
    () => (gone ? groupByFile([...readable, selected]) : all),
    [all, readable, gone, selected],
  );
  return { selected, goneId: gone ? selected.id : null, listed };
}
