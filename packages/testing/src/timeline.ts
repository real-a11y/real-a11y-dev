// A timeline of what a keyboard and screen-reader user meets during an
// interaction: where focus goes, and what live regions announce, in order.
// `capture()` + `a11yDiff()` see the page at two moments; this records what
// happens between them.

import type { ExtractionResult } from "@real-a11y-dev/core";
import {
  asStop,
  buildA11yTree,
  extractDomTree,
  getImplicitRole,
  isAriaHiddenValue,
  LIVE_REGION_ATTRIBUTES,
  liveRegionLevel,
  pageText,
  renderingParent,
  resolveFocusedElement,
  safeContains,
  safeGetAttribute,
  safeNodeType,
  safeOwnerDocument,
  safeParentElement,
} from "@real-a11y-dev/core";
import { redactString, serializeTabStop } from "@real-a11y-dev/serialize";

import { boxSnapshot, type A11ySnapshotBox } from "./snapshot-box.js";

export interface RecordTimelineOptions {
  /**
   * Redact matching substrings from focused nodes' names and from announced
   * text, as the other snapshots redact names.
   */
  redact?: RegExp[];
  /** Record focus moves. Default `true`. */
  focus?: boolean;
  /** Record live-region announcements. Default `true`. */
  announcements?: boolean;
}

/** A running recorder, from {@link recordTimeline}. */
export interface A11yTimeline {
  /**
   * Stop recording and box what was recorded, for
   * `expect(...).toMatchSnapshot()`. Later calls return the same box.
   */
  stop(): A11ySnapshotBox;
}

/** The politeness each live role implies, for the `{live=…}` suffix. */
const ROLE_LEVELS: ReadonlyMap<string, "polite" | "assertive"> = new Map([
  ["alert", "assertive"],
  ["status", "polite"],
  ["log", "polite"],
]);

type Level = "polite" | "assertive";

/** The live region a change belongs to, and whether a nested
 *  `aria-live="off"` silenced it on the way there. */
interface Holder {
  region: Element;
  quiet: boolean;
}

/**
 * How `el` announces: a politeness, `"off"` when its `aria-live` switches
 * announcing off for everything inside it, or null when it is no region.
 * Core's rule, which reads authored roles only (its overlay pivot keys on
 * them), plus `<output>`: a `status` by its tag, which Chromium announces.
 */
function regionLevel(el: Element): Level | "off" | null {
  const live = safeGetAttribute(el, "aria-live")?.trim().toLowerCase();
  if (live === "off") return "off";
  const level = liveRegionLevel(el);
  if (level) return level;
  return el.localName === "output" && getImplicitRole(el) === "status"
    ? "polite"
    : null;
}

/** Is `element` inside `node`, across shadow roots and slots? */
function holds(node: Node, element: Element): boolean {
  if (safeContains(node, element)) return true;
  for (let el: Element | null = element; el; el = renderingParent(el)) {
    if (el === node) return true;
  }
  return false;
}

/** Is the node `id`, and everything above it, exposed to assistive tech? */
function exposed(tree: ExtractionResult, id: string): boolean {
  for (let n = tree.nodes.get(id); n;) {
    if (!n.a11y.isExposedToAT) return false;
    n = n.parentId === null ? undefined : tree.nodes.get(n.parentId);
  }
  return true;
}

/** Note a change to a region: where, and whether it added text. */
type Write = (holder: Holder | null, at: number, adds: boolean) => void;

/**
 * Is `now` what `before` was with some of its text taken out? Then it gained
 * nothing. White space aside, since a restyle can move a line break.
 */
function onlyLost(now: string, before: string): boolean {
  const from = before.replace(/\s+/g, "");
  let i = 0;
  for (const char of now.replace(/\s+/g, "")) {
    i = from.indexOf(char, i);
    if (i < 0) return false;
    i += char.length;
  }
  return true;
}

/** Is `element` inside `aria-hidden` or `inert` content? */
function hiddenAbove(element: Element): boolean {
  for (let el = renderingParent(element); el; el = renderingParent(el)) {
    if (isAriaHiddenValue(safeGetAttribute(el, "aria-hidden"))) return true;
    if (safeGetAttribute(el, "inert") !== null) return true;
  }
  return false;
}

/** Is `node` an element under its own `aria-live="off"`? */
function isSilent(node: Node): boolean {
  return (
    safeNodeType(node) === Node.ELEMENT_NODE &&
    regionLevel(node as Element) === "off"
  );
}

/** `holder`, silenced when `silent`. */
function quieted(holder: Holder | null, silent: boolean): Holder | null {
  return holder && silent ? { ...holder, quiet: true } : holder;
}

/** Is `region`'s level one that announces? */
function isLive(level: Level | "off" | null): level is Level {
  return level !== null && level !== "off";
}

/** One recorded line, `focus     …` or `announce  …`. */
function line(kind: "focus" | "announce", text: string): string {
  return `${kind.padEnd(10)}${text}`;
}

/**
 * A line, and where in its block it happened: record `i` is at `2i + 1`, and
 * a focus event before record `k` at `2k`, so the two sort together.
 */
interface Pending {
  at: number;
  text: string;
}

/** A focus event: before which record it happened, and where focus went
 *  (null while it is leaving). */
interface Move {
  at: number;
  to: Element | null;
}

class TimelineRecorder {
  // Through the prototypes: a page's `<form name="addEventListener">` shadows
  // the document's own, and `<img name="createTreeWalker">` likewise. Read
  // here, not at module scope, so importing this package in plain Node, with
  // no DOM, doesn't throw.
  private readonly addListener = EventTarget.prototype.addEventListener;
  private readonly removeListener = EventTarget.prototype.removeEventListener;
  private readonly createTreeWalker = Document.prototype.createTreeWalker;
  private readonly getRootNode = Node.prototype.getRootNode;
  private readonly isConnected = Object.getOwnPropertyDescriptor(
    Node.prototype,
    "isConnected",
  )!.get!;
  /** Open shadow roots on focus's path. A move within one stops at its host
   *  and never reaches the document, so each is listened to as well. */
  private readonly shadowRoots = new Set<ShadowRoot>();
  private readonly lines: string[] = [];
  /** Each region's text when it last announced; gone once it empties. */
  private readonly lastText = new WeakMap<Element, string>();
  /** What it held then, `aria-hidden` above it aside ({@link heldText}). */
  private readonly lastHeld = new WeakMap<Element, string>();
  /** Regions hidden from assistive tech above them, holding text that counts
   *  as said though they never said it ({@link holdWhileHidden}). */
  private readonly quietWhileHidden = new WeakSet<Element>();
  private readonly doc: Document;
  private readonly observer: MutationObserver;
  /** What the page changed since the block last settled, in order. */
  private records: MutationRecord[] = [];
  /** The focus events among those changes. */
  private moves: Move[] = [];
  /** A settle is queued for the end of this synchronous block. */
  private scheduled = false;
  /** The focused element as last read, inside the root or not. */
  private seen: Element | null = null;
  /** The element the last focus line named, or null for `(none)`. */
  private focused: Element | null = null;
  private box: A11ySnapshotBox | null = null;

  constructor(
    private readonly root: Element,
    private readonly options: Required<
      Pick<RecordTimelineOptions, "focus" | "announcements">
    > &
      Pick<RecordTimelineOptions, "redact">,
  ) {
    this.doc = safeOwnerDocument(root);
    if (options.announcements) this.readBaseline();
    // Delivered once the page's synchronous block has run, which is when
    // the block settles.
    this.observer = new MutationObserver((records) => {
      if (this.box) return;
      for (const record of records) this.records.push(record);
      this.settle();
    });
    // The whole document, not just the root: removing an ancestor of the
    // root drops focus too, and no event says so.
    this.observer.observe(this.doc, {
      childList: true,
      subtree: true,
      ...(options.announcements
        ? {
            characterData: true,
            attributes: true,
            attributeFilter: [...LIVE_REGION_ATTRIBUTES],
          }
        : {}),
    });
    if (options.focus) {
      this.addListener.call(this.doc, "focusin", this.onFocusIn, true);
      this.addListener.call(this.doc, "focusout", this.onFocusOut, true);
      // Where focus starts. Nothing read yet counts as `(none)`, so a start
      // on nothing prints no line.
      const start = this.focusChange(0);
      if (start) this.lines.push(start.text);
      this.listenInside(resolveFocusedElement(this.doc));
    }
  }

  stop(): A11ySnapshotBox {
    if (this.box) return this.box;
    this.settle();
    this.observer.disconnect();
    for (const target of [this.doc, ...this.shadowRoots]) {
      this.removeListener.call(target, "focusin", this.onFocusIn, true);
      this.removeListener.call(target, "focusout", this.onFocusOut, true);
    }
    this.box = boxSnapshot(
      this.lines.length ? this.lines.join("\n") : "(nothing recorded)",
    );
    return this.box;
  }

  private readonly onFocusIn = (): void => {
    const to = resolveFocusedElement(this.doc);
    this.moved(to);
    this.listenInside(to);
  };

  private readonly onFocusOut = (): void => this.moved(null);

  /** Listen in every open shadow root `element` is inside, once each. */
  private listenInside(element: Element | null): void {
    if (this.box) return;
    for (let el = element; el;) {
      const root = this.getRootNode.call(el);
      if (!(root instanceof ShadowRoot)) return;
      if (!this.shadowRoots.has(root)) {
        this.shadowRoots.add(root);
        this.addListener.call(root, "focusin", this.onFocusIn, true);
        this.addListener.call(root, "focusout", this.onFocusOut, true);
      }
      el = root.host;
    }
  }

  /** Is `element` in the root, and the root on the page? A region in a root
   *  the block took off the page is read by nobody. */
  private onPage(element: Element): boolean {
    return this.inRoot(element) && this.isConnected.call(element) === true;
  }

  /** Note a focus event at this point among the page's changes. */
  private moved(to: Element | null): void {
    if (this.box) return;
    for (const record of this.observer.takeRecords()) this.records.push(record);
    this.moves.push({ at: this.records.length, to });
    this.schedule();
  }

  /**
   * Read the block once the page's synchronous code has run. It renders as a
   * whole, so text set and cleared within it, or focus passing through an
   * element, never reached a screen reader.
   */
  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => this.settle());
  }

  /** Turn the block into lines: what it left in each region, and where it
   *  left focus, each where in the block it happened. */
  private settle(): void {
    this.scheduled = false;
    if (this.box) return;
    const records = this.records;
    for (const record of this.observer.takeRecords()) records.push(record);
    const moves = this.moves;
    this.records = [];
    this.moves = [];
    const pending = this.options.announcements
      ? this.announcements(records)
      : [];
    if (this.options.focus) {
      const change = this.focusChange(this.focusSettled(records, moves));
      if (change) pending.push(change);
    }
    // Stable, so lines from one record keep the order they were read in.
    pending.sort((a, b) => a.at - b.at);
    for (const p of pending) this.lines.push(p.text);
  }

  // ─── focus ─────────────────────────────────────────────────────────────────

  /**
   * Where in the block focus came to rest: its last move, or the last record
   * that removed the element it was on (jsdom fires no event for that),
   * whichever came later. With neither, the end of the block.
   */
  private focusSettled(records: MutationRecord[], moves: Move[]): number {
    let at = moves.length ? 2 * moves[moves.length - 1]!.at : -1;
    let current = this.seen;
    let next = 0;
    records.forEach((record, i) => {
      while (next < moves.length && moves[next]!.at <= i) {
        current = moves[next++]!.to;
      }
      if (current && this.removes(record, current)) {
        at = Math.max(at, 2 * i + 1);
      }
    });
    return at < 0 ? 2 * records.length : at;
  }

  /** Did this record take `element` out of the document with it? */
  private removes(record: MutationRecord, element: Element): boolean {
    if (record.type !== "childList") return false;
    for (const node of record.removedNodes) {
      if (holds(node, element)) return true;
    }
    return false;
  }

  /** A focus line, if focus now rests somewhere other than the last line said. */
  private focusChange(at: number): Pending | null {
    const element = resolveFocusedElement(this.doc);
    // Same element as last read: no move, and no extraction to find that out.
    if (element === this.seen) return null;
    this.seen = element;
    const label = element ? this.focusLabel(element) : null;
    const target = label === null ? null : element;
    if (target === this.focused) return null;
    this.focused = target;
    return { at, text: line("focus", label ?? "(none)") };
  }

  /**
   * `element` as a tab stop prints it, or null when the root doesn't hold it.
   * A focused node the a11y view folds away (a `<div tabindex="-1">` with no
   * name) is still where the user is, so it falls back to the DOM view's
   * node. One assistive tech can't reach gets a trailing `[hidden]`, since a
   * screen reader meets nothing there: inside `aria-hidden` or `inert`
   * content, above the root as well as in it, or somewhere the tree doesn't
   * walk at all (jsdom lets a `hidden` element take focus).
   */
  private focusLabel(element: Element): string | null {
    if (!this.inRoot(element)) return null;
    // Partial, so the root is read as it is: never widened to a portaled
    // overlay or narrowed to a modal, which would make what counts as inside
    // it hang on the rest of the page.
    const dom = extractDomTree(this.root, {
      nodes: new Map(),
      includeFocused: true,
    });
    const id = dom.focusedId;
    const node = id ? dom.nodes.get(id) : undefined;
    if (!id || !node) return `${getImplicitRole(element)} [hidden]`;
    const kept = buildA11yTree(dom.nodes, dom.rootId, id, dom.source).nodes.get(
      id,
    );
    // Singling a node out says what it is, so a sensitive field's choice is
    // withheld here as the tab order withholds it (ADR-0001).
    const text = serializeTabStop(asStop(kept ?? node), {
      redact: this.options.redact,
    });
    const reachable = (kept || exposed(dom, id)) && !this.hiddenAboveRoot();
    return reachable ? text : `${text} [hidden]`;
  }

  /** Is the root inside `aria-hidden` or `inert` content? The tree, read
   *  from the root down, can't see that. */
  private hiddenAboveRoot(): boolean {
    return hiddenAbove(this.root);
  }

  // ─── live regions ──────────────────────────────────────────────────────────

  /**
   * An announce line for each region the block left holding new text, at the
   * last record that wrote to it: the text it prints exists only from there.
   */
  private announcements(records: MutationRecord[]): Pending[] {
    const touches = this.collect(records);
    const pending: Pending[] = [];
    for (const [region, at] of touches.changed) {
      const text = this.announcement(region, touches.added.has(region));
      if (text) pending.push({ at, text });
    }
    for (const region of touches.quiet) this.takeInQuietly(region);
    return pending;
  }

  /**
   * Which regions the block changed, and where it last did; which of them it
   * added text to (written or inserted), since a removal or a restyle is news
   * only for the text it reveals; and which it changed only under
   * `aria-live="off"`.
   */
  private collect(records: MutationRecord[]): {
    changed: Map<Element, number>;
    added: Set<Element>;
    quiet: Set<Element>;
  } {
    const changed = new Map<Element, number>();
    const added = new Set<Element>();
    const quiet = new Set<Element>();
    const restyledAt = new Map<Element, number>();
    const removed: Node[] = [];
    const write: Write = (holder, at, adds) => {
      if (holder?.quiet) quiet.add(holder.region);
      else if (holder) {
        changed.set(holder.region, at);
        if (adds) added.add(holder.region);
      }
    };
    for (const [i, record] of records.entries()) {
      const at = 2 * i + 1;
      const target = record.target;
      if (record.type === "attributes") {
        // Walked once per block, at the last time the page restyled it.
        restyledAt.set(target as Element, at);
        write(this.regionHolding(target), at, false);
      } else if (record.type === "characterData") {
        write(this.regionHolding(target), at, true);
      } else {
        if (record.removedNodes.length) {
          const silent = [...record.removedNodes].every(isSilent);
          write(quieted(this.regionHolding(target), silent), at, false);
          removed.push(...record.removedNodes);
        }
        for (const node of record.addedNodes) {
          this.added(node, record, at, write);
        }
      }
    }
    // A region moved within the block is still there, holding what it held.
    for (const node of removed) this.forget(node);
    for (const [element, at] of restyledAt) {
      for (const region of this.regionsWithin(element)) {
        if (!added.has(region)) {
          changed.set(region, Math.max(changed.get(region) ?? -1, at));
        }
      }
    }
    // An announcing addition outweighs a silenced change; a silenced change
    // outweighs a removal or restyle, which reveals nothing it didn't hide.
    for (const region of quiet) {
      if (added.has(region)) quiet.delete(region);
      else changed.delete(region);
    }
    return { changed, added, quiet };
  }

  /**
   * What an added node writes to: a live region of its own (once, not again
   * as part of a region around it), or else the region it joins; and either
   * way any region inside it, which announces for itself.
   */
  private added(
    node: Node,
    record: MutationRecord,
    at: number,
    write: Write,
  ): void {
    const element =
      safeNodeType(node) === Node.ELEMENT_NODE ? (node as Element) : null;
    if (element && isLive(regionLevel(element))) {
      // `regionsWithin` starts at the element itself.
      for (const region of this.regionsWithin(element)) {
        write({ region, quiet: false }, at, true);
      }
      return;
    }
    // Content that arrives under its own `aria-live="off"` says nothing.
    write(quieted(this.regionHolding(record.target), isSilent(node)), at, true);
    if (!element) return;
    for (const region of this.regionsWithin(element)) {
      write({ region, quiet: false }, at, true);
    }
  }

  /** The nearest live region rendering `node`, if the root holds it. */
  private regionHolding(node: Node): Holder | null {
    let element: Element | null;
    if (safeNodeType(node) === Node.ELEMENT_NODE) element = node as Element;
    else {
      // Text a slot renders belongs to the region around the slot.
      element = (node as Partial<Text>).assignedSlot ?? safeParentElement(node);
    }
    // The nearest `aria-live` decides: under `off`, the region around still
    // holds the change, but announces nothing for it.
    let quiet = false;
    for (let el = element; el; el = renderingParent(el)) {
      const level = regionLevel(el);
      if (level === "off") quiet = true;
      else if (level) return this.inRoot(el) ? { region: el, quiet } : null;
      if (el === this.root) return null;
    }
    return null;
  }

  /** Every live region in `element`'s subtree that the root holds. */
  private regionsWithin(element: Element): Element[] {
    let scope: Element | null = null;
    if (this.inRoot(element)) scope = element;
    else if (safeContains(element, this.root)) scope = this.root;
    if (!scope) return [];
    const found: Element[] = [];
    const walker = this.createTreeWalker.call(
      this.doc,
      scope,
      NodeFilter.SHOW_ELEMENT,
    );
    for (let n: Node | null = scope; n; n = walker.nextNode()) {
      if (isLive(regionLevel(n as Element))) found.push(n as Element);
    }
    return found;
  }

  /**
   * Forget the regions a removal took with it, as emptying one does: put
   * back holding the same text, a region is announced again. Not one the
   * block put back already, which only moved.
   */
  private forget(node: Node): void {
    if (safeNodeType(node) !== Node.ELEMENT_NODE) return;
    if (this.onPage(node as Element)) return;
    const walker = this.createTreeWalker.call(
      this.doc,
      node,
      NodeFilter.SHOW_ELEMENT,
    );
    for (let n: Node | null = node; n; n = walker.nextNode()) {
      this.forgetRegion(n as Element);
    }
  }

  /** Is `element` the root, or rendered inside it? */
  private inRoot(element: Element): boolean {
    for (let el: Element | null = element; el; el = renderingParent(el)) {
      if (el === this.root) return true;
    }
    return false;
  }

  /** The regions' texts at the start: only text they gain is announced. */
  private readBaseline(): void {
    for (const region of this.regionsWithin(this.root)) {
      const text = announcedText(region);
      if (text) this.remember(region, text);
      else this.holdWhileHidden(region);
    }
  }

  /**
   * An announce line for `region`, if it now holds text it didn't hold when it
   * last announced. Emptied, removed, or hidden by its own `hidden` or
   * `display`, it forgets, so the same text shown again is news again. Hidden
   * from assistive tech some other way (`aria-hidden` on an ancestor, as a
   * modal does to the rest of the page), it keeps its text, and showing it
   * again announces nothing.
   *
   * `added` is a region the block wrote or inserted text into, where any
   * difference is news. A removal or a restyle only takes text away or shows
   * it: news only for text the region gained, as a screen reader announces
   * additions and not removals.
   */
  private announcement(region: Element, added: boolean): string | null {
    const level = this.onPage(region) ? regionLevel(region) : null;
    const text = isLive(level) ? announcedText(region) : "";
    if (!isLive(level) || !text) {
      this.saysNothing(region, level);
      return null;
    }
    const last = this.lastText.get(region);
    const silenced = this.quietWhileHidden.delete(region) && !added;
    if (last === text) return null;
    this.remember(region, text);
    if (silenced || (!added && last !== undefined && onlyLost(text, last))) {
      return null;
    }
    const role = getImplicitRole(region);
    const live = ROLE_LEVELS.get(role) === level ? "" : ` {live=${level}}`;
    const said = redactString(text, this.options.redact);
    return line("announce", `${role} "${said}"${live}`);
  }

  /**
   * A region changed under `aria-live="off"`: what it holds now counts as
   * said, and emptied, it forgets, as an announcing change would leave it.
   */
  private takeInQuietly(region: Element): void {
    const level = this.onPage(region) ? regionLevel(region) : null;
    const text = isLive(level) ? announcedText(region) : "";
    if (text) this.remember(region, text);
    else if (!isLive(level) || !this.holdWhileHidden(region)) {
      this.saysNothing(region, level);
    }
  }

  /**
   * Hidden from assistive tech above it, as a modal hides the page behind it,
   * `region` still holds text it can't say: count that as said once it shows
   * again. Not for text hidden inside it, which a restyle can reveal as news.
   */
  private holdWhileHidden(region: Element): boolean {
    const held = hiddenAbove(region) ? heldText(region) : "";
    if (!held) return false;
    this.lastHeld.set(region, held);
    this.quietWhileHidden.add(region);
    return true;
  }

  /**
   * `region` says nothing now. Emptied, removed or no longer a region, it
   * forgets; hidden from assistive tech above it with the same text, it
   * keeps it ({@link heldText}).
   */
  private saysNothing(region: Element, level: Level | "off" | null): void {
    const held = this.lastHeld.get(region);
    if (!isLive(level) || held === undefined || heldText(region) !== held) {
      this.forgetRegion(region);
    }
  }

  /** Note what `region` says now, and what it holds. */
  private remember(region: Element, text: string): void {
    this.lastText.set(region, text);
    this.lastHeld.set(region, heldText(region));
    this.quietWhileHidden.delete(region);
  }

  private forgetRegion(region: Element): void {
    this.lastText.delete(region);
    this.lastHeld.delete(region);
    this.quietWhileHidden.delete(region);
  }
}

/** One line of text, its white space collapsed. */
function oneLine(text: string): string {
  return text.replace(/[ \t\n\r\f]+/g, " ").trim();
}

/**
 * What `region` holds whatever hides it from assistive tech above it: its
 * text as rendered, `aria-hidden` and ancestors aside. Empty when it is
 * emptied or hidden by its own `hidden` or `display`.
 */
function heldText(region: Element): string {
  return oneLine(pageText(region, { lines: true }));
}

/**
 * What a screen reader could say for `region`: core's read of a live region
 * (never raw `textContent`, which also holds a `<textarea>`'s markup default
 * and hidden text), line by line as the page lays it out, so two paragraphs
 * don't run together, then joined into one line.
 */
function announcedText(region: Element): string {
  return oneLine(pageText(region, { announced: true, lines: true }));
}

/**
 * Record what a keyboard and screen-reader user meets from now on, in order:
 * where focus goes, and what live regions announce. Start it before the
 * interaction, wait for the page's last change, then box the result with
 * `stop()`:
 *
 * ```ts
 * const timeline = recordTimeline(document.body);
 * await user.click(screen.getByRole("button", { name: "Delete draft" }));
 * await screen.findByText("Draft deleted.");
 * expect(timeline.stop()).toMatchInlineSnapshot(`
 *   focus     button "Delete draft"
 *   announce  status "Deleting…"
 *   focus     (none)
 *   focus     button "New draft"
 *   announce  status "Draft deleted."
 * `);
 * ```
 *
 * - A **focus** line names the focused node as a tab stop prints it,
 *   `role "name" {states}`, with `[hidden]` when assistive tech can't reach
 *   it. `(none)` means focus rests on `<body>` or `<html>`, or outside the
 *   root. The first line is where focus starts, unless it starts on nothing.
 *   (In the example, React renders the status after the handler's `focus()`
 *   has run, so focus lands first.)
 * - An **announce** line is the text a live region gains: an element with
 *   `aria-live="polite"` or `"assertive"`, or a `status` (an `<output>` too),
 *   `alert` or `log`. It names the region's role, and `{live=…}` when
 *   `aria-live` sets a politeness the role doesn't imply. A region emptied
 *   prints nothing, and so does the same text set again; emptied, removed or
 *   hidden by its own `hidden` first, it prints again. One hidden by
 *   `aria-hidden` above it keeps its text.
 * - Lines follow the order the page made its changes. What one synchronous
 *   run of the page's code does is read once: text set and cleared in it, or
 *   focus passing through an element, prints nothing. Anything an `await`
 *   separates is read separately, even an `await` of a resolved promise.
 *
 * Only what the root holds is recorded, so pass `document.body` to hear the
 * whole page. Changes inside a shadow root aren't seen: a `MutationObserver`
 * doesn't reach them. Call `stop()` even when a test fails first (in a
 * `finally` or `afterEach`), or the recorder keeps listening.
 */
export function recordTimeline(
  root: Element,
  options: RecordTimelineOptions = {},
): A11yTimeline {
  if (typeof Element === "undefined" || !(root instanceof Element)) {
    throw new TypeError(
      `recordTimeline: expected a DOM Element, received ${root === null ? "null" : typeof root}`,
    );
  }
  const { focus = true, announcements = true, redact } = options;
  // A recorder that listens for nothing snapshots "(nothing recorded)"
  // forever, whatever the page does: a test that can't fail.
  if (!focus && !announcements) {
    throw new TypeError(
      "recordTimeline: { focus: false, announcements: false } records nothing. Leave one of them on.",
    );
  }
  const recorder = new TimelineRecorder(root, {
    focus,
    announcements,
    redact,
  });
  return { stop: () => recorder.stop() };
}
