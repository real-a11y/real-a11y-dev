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
  LIVE_REGION_ATTRIBUTES,
  renderingParent,
  resolveFocusedElement,
  safeContains,
  safeNodeType,
  safeOwnerDocument,
  safeParentElement,
} from "@real-a11y-dev/core";
import { redactString, serializeTabStop } from "@real-a11y-dev/serialize";

import { boxSnapshot, type A11ySnapshotBox } from "./snapshot-box.js";
import {
  announcedRead,
  announcedText,
  gains,
  heldFrom,
  hiddenAbove,
  isLive,
  regionLevel,
  ROLE_LEVELS,
} from "./timeline-regions.js";

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

/** Note a change to a region at a point in its block; `writes` when the
 *  change wrote or inserted something rather than restyling. */
type Touch = (region: Element | null, at: number, writes?: boolean) => void;

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

/** A focus event: before which record it happened, where focus went (null
 *  while it is leaving), and, if the block had changed the page by then,
 *  what each region said there ({@link TimelineRecorder.heardAt}). */
interface Move {
  at: number;
  to: Element | null;
  said?: Map<Element, string>;
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
  /** Each region's text as last read; gone once it empties. */
  private readonly lastText = new WeakMap<Element, string>();
  /** The text nodes that text came from, which count as said ({@link gains}). */
  private readonly lastFrom = new WeakMap<Element, Map<Text, string>>();
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
    this.moves.push({ at: this.records.length, to, said: this.saidNow() });
    this.schedule();
  }

  /**
   * What each region in the root says at a focus move, to place lines by
   * ({@link heardAt}). Read only when the block changed something in or
   * around the root since the last move's read; otherwise that read stands,
   * or, with none, the regions still say what they said before the block.
   */
  private saidNow(): Map<Element, string> | undefined {
    if (!this.options.announcements) return undefined;
    const last = this.moves[this.moves.length - 1];
    const fresh = this.records
      .slice(last?.at ?? 0)
      .some(
        ({ target }) =>
          safeContains(this.root, target) || safeContains(target, this.root),
      );
    if (!fresh) return last?.said;
    return new Map(
      this.regionsWithin(this.root).map((r) => [r, announcedText(r)]),
    );
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
      ? this.announcements(records, moves)
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
   * An announce line for each region the block left showing new text, where
   * the block came to leave it so ({@link heardAt}).
   */
  private announcements(records: MutationRecord[], moves: Move[]): Pending[] {
    const pending: Pending[] = [];
    for (const [region, positions] of this.collect(records)) {
      const text = this.announcement(region);
      if (text) {
        pending.push({ at: this.heardAt(region, positions, moves), text });
      }
    }
    return pending;
  }

  /**
   * Where in the block `region` came to say what it now says: at its last
   * change, unless it already said that at a focus move and at every move
   * after. Then at its last change before the first of those moves, so a
   * change after it that left the text alone, such as a restyle that shows
   * nothing, can't carry the line past the move. What a region said at a move
   * only places a line, and is never printed: the block hadn't rendered.
   */
  private heardAt(region: Element, positions: number[], moves: Move[]): number {
    const text = this.lastText.get(region);
    let from = moves.length;
    while (from > 0 && moves[from - 1]!.said?.get(region) === text) from--;
    const before = from < moves.length ? 2 * moves[from]!.at : Infinity;
    const earlier = positions.filter((at) => at < before);
    return Math.max(...(earlier.length ? earlier : positions));
  }

  /**
   * Which regions the block changed, and everywhere it did. A restyle
   * changes every region in what it restyled, but a region the block also
   * wrote to or inserted is placed by those writes alone.
   */
  private collect(records: MutationRecord[]): Map<Element, number[]> {
    const changed = new Map<Element, number[]>();
    const written = new Set<Element>();
    const restyledAt = new Map<Element, number[]>();
    const removed: Node[] = [];
    const touch: Touch = (region, at, writes = false) => {
      if (!region) return;
      const positions = changed.get(region);
      if (positions) positions.push(at);
      else changed.set(region, [at]);
      if (writes) written.add(region);
    };
    for (const [i, record] of records.entries()) {
      const at = 2 * i + 1;
      const target = record.target;
      if (record.type === "attributes") {
        // Walked once per block, for every time the page restyled it.
        const positions = restyledAt.get(target as Element);
        if (positions) positions.push(at);
        else restyledAt.set(target as Element, [at]);
        touch(this.regionHolding(target), at);
      } else if (record.type === "characterData") {
        touch(this.regionHolding(target), at, true);
      } else {
        if (record.removedNodes.length) {
          touch(this.regionHolding(target), at);
          removed.push(...record.removedNodes);
        }
        for (const node of record.addedNodes) {
          this.added(node, record, at, touch);
        }
      }
    }
    // A region moved within the block is still there, holding what it held.
    for (const node of removed) this.forget(node);
    for (const [element, positions] of restyledAt) {
      for (const region of this.regionsWithin(element)) {
        if (!written.has(region)) for (const at of positions) touch(region, at);
      }
    }
    return changed;
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
    touch: Touch,
  ): void {
    const element =
      safeNodeType(node) === Node.ELEMENT_NODE ? (node as Element) : null;
    if (!element || !isLive(regionLevel(element))) {
      touch(this.regionHolding(record.target), at, true);
    }
    // `regionsWithin` starts at the element itself.
    if (element) {
      for (const region of this.regionsWithin(element)) touch(region, at, true);
    }
  }

  /**
   * The nearest live region rendering `node`, if the root holds it. A change
   * under an `aria-live="off"` inside it is still its change, though it
   * announces nothing for the text that change shows ({@link gains}).
   */
  private regionHolding(node: Node): Element | null {
    let element: Element | null;
    if (safeNodeType(node) === Node.ELEMENT_NODE) element = node as Element;
    else {
      // Text a slot renders belongs to the region around the slot.
      element = (node as Partial<Text>).assignedSlot ?? safeParentElement(node);
    }
    for (let el = element; el; el = renderingParent(el)) {
      if (isLive(regionLevel(el))) return this.inRoot(el) ? el : null;
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

  /**
   * The regions' texts at the start: only text they gain is announced. One
   * hidden from assistive tech above it holds its text all the same.
   */
  private readBaseline(): void {
    for (const region of this.regionsWithin(this.root)) {
      const now = announcedRead(region);
      if (now.text) this.lastText.set(region, now.text);
      this.lastFrom.set(region, now.text ? now.from : heldFrom(region));
    }
  }

  /**
   * An announce line for `region`, if it now shows text it didn't show when
   * last read ({@link gains}): text written or inserted, or a part a restyle
   * reveals, but not text a removal or a restyle only takes away, nor a
   * change under an `aria-live="off"` inside it. The same text again says
   * nothing. Emptied, removed, or hidden by its own `hidden` or `display`,
   * it forgets, so the same text shown again is news again. Hidden from
   * assistive tech above it (`aria-hidden` on an ancestor, as a modal does
   * to the rest of the page), it keeps what it showed: shown again, it
   * announces only text it gained meanwhile.
   */
  private announcement(region: Element): string | null {
    const level = this.onPage(region) ? regionLevel(region) : null;
    if (!isLive(level)) {
      this.forgetRegion(region);
      return null;
    }
    const now = announcedRead(region);
    if (!now.text) {
      if (heldFrom(region).size === 0) this.forgetRegion(region);
      return null;
    }
    const said =
      this.lastText.get(region) === now.text ||
      !gains(region, now.from, this.lastFrom.get(region));
    this.lastText.set(region, now.text);
    this.lastFrom.set(region, now.from);
    if (said) return null;
    const role = getImplicitRole(region);
    const live = ROLE_LEVELS.get(role) === level ? "" : ` {live=${level}}`;
    const text = redactString(now.text, this.options.redact);
    return line("announce", `${role} "${text}"${live}`);
  }

  private forgetRegion(region: Element): void {
    this.lastText.delete(region);
    this.lastFrom.delete(region);
  }
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
