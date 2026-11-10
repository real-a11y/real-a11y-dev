/**
 * How a tree view shows what a read found changed since the read before it
 * (`tree-changes-diff.ts`): which rows flash, which collapsed row stands in
 * for the changes under it, which new rows open, where Alt+N goes, and the
 * words for all of it. Pure: a tree view renders from it (the extension's
 * `NativeTreeView.tsx`, through `useTreeChanges`), and `TreeChangesBar.tsx`
 * sums it up under the tree.
 */

import {
  documentOrder,
  type FieldChange,
  type TreeChanges,
  type TreeRow,
} from "./tree-changes-diff.js";

/**
 * The changes a tree marks, as its host hands them down with the read that
 * found them.
 */
export interface ChangeMarks {
  changes: TreeChanges;
  /** Different for every read that sets the marks: a read that finds what
   *  the one before it found is still a read. */
  seq: number;
  /** The user caused the read (Refresh, an action or a key sent through
   *  the tree, or a read that follows up one or a click on the page), so
   *  what it found is announced. An automatic read only marks it. */
  announce: boolean;
}

/** What the marks are compared with, unless a tree's host says otherwise:
 *  the read before, as the extension's tree of Chrome's has them. */
export const SINCE_READ_BEFORE = "the read before";

/** What a host hands its tree of the changes it marks: the extension's
 *  `use-native-changes.ts`, say. */
export interface TreeChangesProp {
  marks: ChangeMarks | null;
  /** Clear the marks: the changes bar's ✕. */
  clear: () => void;
  /**
   * What the marks are compared with, as the tree's words for them end:
   * "Changes since the checkpoint". {@link SINCE_READ_BEFORE} unless said.
   */
  since?: string;
  /**
   * How what a read the user caused found is said to end: "3 new in the
   * tree", or "3 new since the checkpoint" for marks that count from one,
   * where the count is more than the read found. "in the tree" unless said.
   */
  noticeEnd?: string;
  /**
   * The marks are totals since a fixed point (the checkpoint), so a read the
   * user caused says them whenever they move, down as well as up: "No changes
   * since the checkpoint" for marks with nothing in them. A read only says
   * what it found new otherwise.
   */
  totals?: boolean;
  /**
   * Which document the read on screen is of, as the marks tell reads apart:
   * the rows the user opened stay open until it changes, whatever root the
   * tree moves to (the extension's `use-tree-expansion.ts`).
   */
  documentKey?: string;
}

/** How long a row flashes when a read finds it new or changed. */
export const CHANGE_FLASH_MS = 1500;

/**
 * The most new rows a read opens every one of. A read that finds more than
 * this, such as a page swapping out its main content, opens only the top
 * row of each new subtree, as a first read opens only the page's root and
 * its children.
 */
export const AUTO_EXPAND_MAX_ROWS = 200;

/** The most removed rows the changes bar lists. */
export const MAX_REMOVED_LISTED = 50;

/** The two keys, as hints and titles name them. */
export const CHANGE_KEYS = { forward: "Alt+N", back: "Alt+Shift+N" } as const;

/** Both keys, as the tree's `aria-keyshortcuts` lists them. Spelled out
 *  rather than read from {@link CHANGE_KEYS}: a property read at the top of
 *  a module keeps both in every bundle of this package, used or not. */
export const CHANGE_KEYSHORTCUTS = "Alt+N Alt+Shift+N";

/**
 * Alt+N or Alt+Shift+N, matched as the jump keys are (`isJumpKey`): on the
 * physical key, since Option+N is a dead key on a Mac, and on the character,
 * for the key labelled N on another layout. With Ctrl or Meta it is some
 * other shortcut.
 */
export function isChangeKey(
  e: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "code" | "key">,
): boolean {
  return (
    e.altKey &&
    !e.ctrlKey &&
    !e.metaKey &&
    (e.code === "KeyN" || e.key.toLowerCase() === "n")
  );
}

/** What a changed row changed to, as one comparable value. */
function changeSignature(changes: readonly FieldChange[]): string {
  return JSON.stringify(changes.map((c) => [c.field, c.after ?? null]));
}

/**
 * The rows that flash for `next`: the rows it marks that `prev` didn't, or
 * marked as changing to something else, and the rows that more or fewer
 * rows went from under. A follow-up read that finds what the one before it
 * found flashes nothing again.
 */
export function freshChanges(
  prev: TreeChanges | null,
  next: TreeChanges,
): Set<string> {
  const fresh = new Set<string>();
  for (const id of next.added) {
    if (!prev?.added.has(id)) fresh.add(id);
  }
  for (const [id, changes] of next.changed) {
    const was = prev?.changed.get(id);
    if (!was || changeSignature(was) !== changeSignature(changes)) {
      fresh.add(id);
    }
  }
  for (const [id, count] of next.removedUnder) {
    if (prev?.removedUnder.get(id) !== count) fresh.add(id);
  }
  return fresh;
}

/**
 * The new rows a read opens, so what the page just added shows rather than
 * one collapsed row: every `fresh` new row that has rows under it, and every
 * row new earlier in the run that holds one, as the menu a button opened
 * does once the items the page fetched for it come. Past
 * {@link AUTO_EXPAND_MAX_ROWS}, only the top row of each new subtree that
 * holds a fresh row, as one read that found it all would: an empty list
 * found new, then filled, shows its items, closed. A row the user collapsed
 * after an earlier read found it stays collapsed unless the page adds to it.
 */
export function rowsToOpen(
  changes: TreeChanges,
  fresh: ReadonlySet<string>,
  nodes: ReadonlyMap<string, TreeRow>,
  parentOf: ReadonlyMap<string, string>,
): string[] {
  const opens = (id: string) => (nodes.get(id)?.childIds?.length ?? 0) > 0;
  const freshAdded = [...changes.added].filter((id) => fresh.has(id));
  if (freshAdded.length > AUTO_EXPAND_MAX_ROWS) {
    const tops = new Set<string>();
    for (const id of freshAdded) {
      let top = id;
      for (
        let p = parentOf.get(top);
        p !== undefined && changes.added.has(p);
        p = parentOf.get(p)
      ) {
        top = p;
      }
      if (opens(top)) tops.add(top);
    }
    return [...tops];
  }
  const open = new Set(freshAdded.filter(opens));
  for (const id of freshAdded) {
    for (
      let p = parentOf.get(id);
      p !== undefined && changes.added.has(p) && !fresh.has(p);
      p = parentOf.get(p)
    ) {
      open.add(p);
    }
  }
  return [...open];
}

/** `open` added to the rows `prev` holds open, or `prev` itself when it adds
 *  nothing: for a view that keeps its open rows as a set. */
export function withRowsOpen(
  prev: Set<string>,
  open: Iterable<string>,
): Set<string> {
  let next: Set<string> | null = null;
  for (const id of open) {
    if (!prev.has(id)) (next ??= new Set(prev)).add(id);
  }
  return next ?? prev;
}

/** The changes under a row that have no row of their own on screen. */
export interface HiddenChanges {
  added: number;
  changed: number;
  removed: number;
  /** One of them flashes: it is fresh (see {@link freshChanges}). */
  fresh: boolean;
  /** When the flash that ends last among them ends, given flashes with
   *  ends: a later read's flash moves it, and the row's tag starts over. */
  flashUntil?: number;
}

/**
 * The changes each shown row stands in for: those under it whose own rows
 * aren't shown, under a collapsed row or left out by a search, and the rows
 * that went from under it. A change goes to the nearest row above it that
 * shows. The rows under a new row aren't counted on it: it is new itself.
 * A change outside the rows shown at all (outside the scope) goes nowhere.
 */
export function hiddenChangesByRow(
  changes: TreeChanges,
  shown: ReadonlySet<string>,
  parentOf: ReadonlyMap<string, string>,
  fresh: {
    has(id: string): boolean;
    get?(id: string): { until: number } | undefined;
  },
): Map<string, HiddenChanges> {
  const byRow = new Map<string, HiddenChanges>();
  // Each node's nearest shown ancestor, filled in along every walk up.
  const nearest = new Map<string, string | undefined>();
  const nearestShown = (id: string): string | undefined => {
    const chain: string[] = [];
    let result: string | undefined;
    for (let p = parentOf.get(id); p !== undefined; p = parentOf.get(p)) {
      if (shown.has(p)) {
        result = p;
        break;
      }
      if (nearest.has(p)) {
        result = nearest.get(p);
        break;
      }
      chain.push(p);
    }
    for (const p of chain) nearest.set(p, result);
    return result;
  };
  // Count `id`'s change, `count` rows of `kind`, on the row it goes to.
  const tally = (
    row: string | undefined,
    kind: "added" | "changed" | "removed",
    id: string,
    count = 1,
  ) => {
    if (row === undefined) return;
    let e = byRow.get(row);
    if (!e) {
      e = { added: 0, changed: 0, removed: 0, fresh: false };
      byRow.set(row, e);
    }
    e[kind] += count;
    if (!fresh.has(id)) return;
    e.fresh = true;
    const until = fresh.get?.(id)?.until;
    if (until !== undefined && until > (e.flashUntil ?? -Infinity)) {
      e.flashUntil = until;
    }
  };
  for (const id of changes.added) {
    if (shown.has(id)) continue;
    const row = nearestShown(id);
    if (row === undefined || !changes.added.has(row)) tally(row, "added", id);
  }
  for (const id of changes.changed.keys()) {
    if (!shown.has(id)) tally(nearestShown(id), "changed", id);
  }
  for (const [site, count] of changes.removedUnder) {
    const row = shown.has(site) ? site : nearestShown(site);
    tally(row, "removed", site, count);
  }
  return byRow;
}

/** What a row shows of the last read's changes. */
export interface RowChangeMarks {
  /** The row is new: it has the new rows' edge. */
  isNew: boolean;
  /** It is the top row of a new subtree, the one that says "new". */
  newTop: boolean;
  /** What changed on it, if it changed. */
  changes?: readonly FieldChange[];
  /** What it stands in for, under it. */
  hidden?: HiddenChanges;
}

/** Nothing marked. */
const UNMARKED: RowChangeMarks = { isNew: false, newTop: false };

/** What row `id` shows of `changes`, with `hidden` from
 *  {@link hiddenChangesByRow}. */
export function rowChangeMarks(
  changes: TreeChanges | null,
  hidden: ReadonlyMap<string, HiddenChanges> | null,
  parentOf: ReadonlyMap<string, string>,
  id: string,
): RowChangeMarks {
  if (!changes) return UNMARKED;
  const isNew = changes.added.has(id);
  const parent = parentOf.get(id);
  return {
    isNew,
    newTop: isNew && (parent === undefined || !changes.added.has(parent)),
    changes: changes.changed.get(id),
    hidden: hidden?.get(id),
  };
}

/**
 * One change as a screen reader hears it. A state says which way it went:
 * one that is off shows no badge, so no word of its own, and "changed:
 * checked" would read the same either way. Anything else is named, as the
 * row already says what it is now.
 */
export function spokenChange(change: FieldChange): string {
  const key = changedFieldLabel(change.field);
  if (!change.field.startsWith("states.")) return key;
  if (change.field === "states.expanded") {
    if (change.after === undefined) return "no longer expandable";
    return change.after === true ? "now expanded" : "now collapsed";
  }
  if (change.after === undefined) return `no longer ${key}`;
  return change.after === true ? `now ${key}` : `now ${key} ${change.after}`;
}

/**
 * What a screen reader hears of a row's marks, the same as its tags say:
 * ", new", ", changed: now collapsed, name", ", 2 new inside". Last in the
 * row's label rather than first, so a row still starts with its role and
 * name, which a reader moving through the tree, and a test, find it by.
 * Empty for a row with no marks.
 */
export function marksForReaders(marks: RowChangeMarks): string {
  const said: string[] = [];
  if (marks.newTop) said.push("new");
  if (marks.changes) {
    said.push(`changed: ${marks.changes.map(spokenChange).join(", ")}`);
  }
  if (marks.hidden) said.push(hiddenChangesText(marks.hidden));
  return said.length > 0 ? `, ${said.join("; ")}` : "";
}

/** A row's flash: when it ends, by `performance.now()`, and which of two
 *  equal animations it runs, so a row fresh again while it flashes starts
 *  over (`use-tree-changes.ts`). */
export interface Flash {
  until: number;
  alt: boolean;
}

/** The classes a marked row adds: its edge, and its flash while it has one. */
export function changeRowClass(
  marks: RowChangeMarks,
  flash: Flash | undefined,
): string | false {
  const own = marks.isNew
    ? "sn-node--change-new"
    : marks.changes
      ? "sn-node--change-changed"
      : "";
  if (!own) return false;
  if (!flash) return own;
  return `${own} sn-node--change-flash${flash.alt ? " sn-node--change-flash-alt" : ""}`;
}

/** No rows flashing. */
export const NO_FLASH: ReadonlyMap<string, Flash> = new Map();

/**
 * The flashes after a read that found `fresh` at `now`: each flash still
 * running keeps going to its own end, and each fresh row flashes from now,
 * on the other of its two animations if it had one going, so it starts over
 * rather than carrying on with the one it had.
 */
export function flashFresh(
  flashes: ReadonlyMap<string, Flash>,
  fresh: ReadonlySet<string>,
  now: number,
): ReadonlyMap<string, Flash> {
  const next = new Map<string, Flash>();
  for (const [id, flash] of flashes) if (flash.until > now) next.set(id, flash);
  for (const id of fresh) {
    const had = flashes.get(id);
    next.set(id, { until: now + CHANGE_FLASH_MS, alt: had ? !had.alt : false });
  }
  return next;
}

/** What is left of `flashes` at `now`. */
export function flashesLeft(
  flashes: ReadonlyMap<string, Flash>,
  now: number,
): ReadonlyMap<string, Flash> {
  const left = new Map([...flashes].filter(([, f]) => f.until > now));
  return left.size === 0 ? NO_FLASH : left;
}

/** When the first of `flashes` ends, or `Infinity` with none. A loop, not a
 *  spread into `Math.min`: a read can flash more rows than a call takes
 *  arguments. */
export function firstFlashEnd(flashes: ReadonlyMap<string, Flash>): number {
  let first = Infinity;
  for (const f of flashes.values()) if (f.until < first) first = f.until;
  return first;
}

/**
 * `open` without the rows above the selected row, which opening would push
 * down, and out of view, under a still pointer or a reader. The selected row
 * itself and those it sits in stay: opening them only adds rows below it,
 * and leaving one closed would hide it.
 */
export function notAboveSelection(
  open: string[],
  tree: {
    nodes: ReadonlyMap<string, TreeRow>;
    rootId: string;
    parentOf: ReadonlyMap<string, string>;
  },
  selectedId: string | null,
): string[] {
  if (selectedId === null || open.length === 0) return open;
  const position = documentPositions(tree.nodes, tree.rootId);
  const selected = position.get(selectedId);
  if (selected === undefined) return open;
  const holds = new Set<string>();
  for (let p: string | undefined = selectedId; p; p = tree.parentOf.get(p)) {
    holds.add(p);
  }
  return open.filter(
    (id) => holds.has(id) || (position.get(id) ?? -1) > selected,
  );
}

/** Each row's place in document order, walking from `rootId` as the tree
 *  draws it: what {@link nextChangeStop} orders by. */
export function documentPositions(
  nodes: ReadonlyMap<string, TreeRow>,
  rootId: string,
): Map<string, number> {
  return new Map(documentOrder({ nodes, rootId }).map((id, i) => [id, i]));
}

/**
 * Where Alt+N (`back` false) or Alt+Shift+N (`back` true) goes from the row
 * `from`: the next or previous stop (`TreeChanges.stops`) in document
 * order, wrapping around, or the first or last with no row selected.
 * `position` is each row's place in that order; a stop without one is gone
 * from the tree. `undefined` when there is nowhere to go.
 */
export function nextChangeStop(
  stops: readonly string[],
  position: ReadonlyMap<string, number>,
  from: string | null,
  back: boolean,
): string | undefined {
  const present = stops.filter((id) => position.has(id));
  if (present.length === 0) return undefined;
  const here = from === null ? undefined : position.get(from);
  if (here === undefined) return back ? present.at(-1) : present[0];
  if (back) {
    for (let i = present.length - 1; i >= 0; i--) {
      if (position.get(present[i]!)! < here) return present[i];
    }
    return present.at(-1);
  }
  return present.find((id) => position.get(id)! > here) ?? present[0];
}

/** "3 new, 1 changed, 2 removed": every count there is, in that order. */
function countsText(added: number, changed: number, removed: number): string {
  return [
    added > 0 && `${added} new`,
    changed > 0 && `${changed} changed`,
    removed > 0 && `${removed} removed`,
  ]
    .filter(Boolean)
    .join(", ");
}

/** What a read found, in rows: "3 new, 1 changed, 2 removed". */
export function summarizeChanges(changes: TreeChanges): string {
  return countsText(
    changes.added.size,
    changes.changed.size,
    changes.removed.length,
  );
}

/** What a row stands in for: "2 new, 1 removed inside". */
export function hiddenChangesText(hidden: HiddenChanges): string {
  return `${countsText(hidden.added, hidden.changed, hidden.removed)} inside`;
}

/** A change's field as a badge names it: `states.expanded` is
 *  "expanded", `name` is "name". */
export function changedFieldLabel(field: string): string {
  return field.slice(field.indexOf(".") + 1);
}

/** One side of a change, as the row showed it. */
function shownSide(field: string, value: string | boolean | undefined): string {
  if (field === "states.expanded") {
    return value === true ? "expanded" : value === false ? "collapsed" : "none";
  }
  if (field.startsWith("states.")) return String(value ?? false);
  if (value === undefined) return "none";
  if (typeof value === "boolean") return String(value);
  if (field === "role" || field.startsWith("properties.")) return value;
  // Cut by characters, not UTF-16 units: half an emoji prints as `\ud83d`.
  const chars = [...value];
  return JSON.stringify(
    chars.length > 40 ? `${chars.slice(0, 40).join("")}…` : value,
  );
}

/** One change, for a row's tooltip: `expanded: collapsed → expanded`. */
export function describeChange(change: FieldChange): string {
  // Ids mean nothing to a reader; the row's chips show the rows it controls.
  if (change.field === "controls") return "the rows it controls";
  return `${changedFieldLabel(change.field)}: ${shownSide(change.field, change.before)} → ${shownSide(change.field, change.after)}`;
}
