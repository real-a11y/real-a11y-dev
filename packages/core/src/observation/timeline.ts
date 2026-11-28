// The timeline view's recorder (ADR-0002): what a keyboard and screen-reader
// user meets during an interaction, where focus goes and what live regions
// announce, as events in the order the page made them. It runs in the page
// on every surface; `serialize`'s `serializeTimeline` writes the lines.

import { safeNodeType, safeOwnerDocument } from "../extraction/clobber-safe.js";
import { resolveFocusedElement } from "../extraction/dom-extractor.js";
import { renderingParent } from "../extraction/flat-tree.js";
import { getImplicitRole } from "../extraction/role-map.js";

import {
  freeze,
  timelineProblem,
  type TimelineAnnounceEvent,
  type TimelineEvent,
  type TimelineOptions,
  type TimelineRecording,
} from "./timeline-events.js";
import {
  type FocusLine,
  INTERACTION_TYPES,
  interactionOf,
  nodeStop,
  type NotedAct,
  placeAct,
  TypingRun,
} from "./timeline-interactions.js";
import {
  alreadySaid,
  announcedRead,
  audibleRead,
  gains,
  heldFrom,
  holds,
  isLive,
  regionLevel,
  renderedIn,
  type Said,
} from "./timeline-regions.js";

/** Note a change to the regions at a point in their block. */
type Touch = (regions: Element[], at: number) => void;

/**
 * An event, and where in its block it happened: record `i` is at `2i + 1`,
 * and a focus event before record `k` at `2k`, so the two sort together. An
 * interaction before record `k` is a quarter either side of `2k`, by
 * whether a focus move there came before it ({@link placeAct}). `el` is the
 * field a type event names.
 */
interface Pending {
  at: number;
  event: TimelineEvent;
  el?: Element | null;
}

/** A focus event: before which record it happened, where in the root focus
 *  went (null while it is leaving, or outside the root), and, if the block
 *  had changed the page by then, what each region said aloud there
 *  ({@link TimelineRecorder.heardAt}). */
interface Move {
  at: number;
  to: Element | null;
  said?: Map<Element, Said>;
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
  private readonly shadowRoot = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "shadowRoot",
  )!.get!;
  /** Open shadow roots on focus's path. A move within one stops at its host
   *  and never reaches the document, so each is listened to as well. */
  private readonly shadowRoots = new Set<ShadowRoot>();
  private readonly events: TimelineEvent[] = [];
  /** How many of them `onEvents` has had. */
  private sent = 0;
  /** A call to `onEvents` is running. */
  private delivering = false;
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
  /** The interactions among them. */
  private acts: NotedAct[] = [];
  private readonly typing = new TypingRun();
  /** Interaction events already noted. */
  private readonly heard = new WeakSet<Event>();
  /** A settle is queued for the end of this synchronous block. */
  private scheduled = false;
  /** Focus has left one element for another and not arrived yet. */
  private leaving = false;
  /** The focused element as last read, inside the root or not. */
  private seen: Element | null = null;
  /** The element the last focus event named, or null for `(none)`. */
  private focused: Element | null = null;
  /** Every event, once stopped. */
  private done: readonly TimelineEvent[] | null = null;

  constructor(
    private readonly root: Element,
    private readonly options: Required<
      Pick<TimelineOptions, "focus" | "announcements" | "interactions">
    > &
      Pick<TimelineOptions, "onEvents">,
  ) {
    this.doc = safeOwnerDocument(root);
    if (options.announcements) this.readBaseline();
    // Delivered once the page's synchronous block has run, which is when
    // the block settles.
    this.observer = new MutationObserver((records) => {
      if (this.done) return;
      for (const record of records) this.records.push(record);
      this.settle();
    });
    // The whole document, not just the root: removing an ancestor of the
    // root drops focus too, and no event says so.
    // Every attribute, not just those that make a region: CSS keyed on any
    // of them (`[data-state=open]`) can show a region's text.
    this.observer.observe(this.doc, {
      childList: true,
      subtree: true,
      ...(options.announcements
        ? { characterData: true, attributes: true }
        : {}),
    });
    if (options.interactions) this.listenForActs(this.doc, this.addListener);
    if (options.focus) {
      this.listen(this.doc, this.addListener);
      // Where focus starts. Nothing read yet counts as `(none)`, so a start
      // on nothing is no event. Recorded now, handed to `onEvents` once
      // `startTimeline` has returned. Handed over, not settled: settling
      // here would read the block before the page's own microtasks ran, and
      // announce text a cleanup it queued first would have cleared.
      const start = this.focusChange(0);
      if (start) {
        this.events.push(freeze(start.event));
        if (options.onEvents) {
          void Promise.resolve().then(() => {
            if (!this.done) this.emit([]);
          });
        }
      }
    }
  }

  stop(): readonly TimelineEvent[] {
    if (this.done) return this.done;
    this.leaving = false;
    // Detached however the last `onEvents` call ends.
    try {
      this.settle();
    } finally {
      this.observer.disconnect();
      for (const target of [this.doc, ...this.shadowRoots]) {
        this.listen(target, this.removeListener);
        this.listenForActs(target, this.removeListener);
      }
      // Kept when a call `onEvents` was handed stopped it first.
      this.done ??= Object.freeze([...this.events]);
    }
    return this.done;
  }

  /**
   * Add a run of events, and hand `onEvents` every one it hasn't had. Never
   * from inside a call to it: what a call's `stop()` settles is the next
   * run, handed over once that call returns, though that call threw. The
   * first throw is rethrown once every run is out.
   */
  private emit(events: TimelineEvent[]): void {
    for (const event of events) this.events.push(freeze(event));
    if (this.delivering) return;
    this.delivering = true;
    const errors: unknown[] = [];
    while (this.sent < this.events.length) {
      const run = this.events.slice(this.sent);
      this.sent = this.events.length;
      try {
        this.options.onEvents?.(run);
      } catch (error) {
        errors.push(error);
      }
    }
    this.delivering = false;
    if (errors.length) throw errors[0];
  }

  /**
   * Add or remove the focus listeners on `target`. `focus` and `blur` as well
   * as `focusin` and `focusout`, in the capture phase: a page's `focus` or
   * `blur` listener runs before the other of the pair, and a move is stamped
   * at the first ({@link moved}).
   */
  private listen(
    target: EventTarget,
    method: typeof EventTarget.prototype.addEventListener,
  ): void {
    for (const type of ["focus", "focusin"]) {
      method.call(target, type, this.onFocusIn, true);
    }
    for (const type of ["blur", "focusout"]) {
      method.call(target, type, this.onFocusOut, true);
    }
  }

  /** Add or remove the interaction listeners: the document's alone, since
   *  an event's composed path reaches into the open shadow roots it crossed. */
  private listenForActs(
    target: EventTarget,
    method: typeof EventTarget.prototype.addEventListener,
  ): void {
    for (const type of INTERACTION_TYPES) {
      method.call(target, type, this.onInteraction, true);
    }
  }

  /** Note an interaction at this point among the page's changes, named as
   *  it happened: what a click removes is gone by the time the block
   *  settles. */
  private readonly onInteraction = (event: Event): void => {
    // Once: a composed event reaches a shadow root's listener and then the
    // document's.
    if (this.done || this.heard.has(event)) return;
    this.heard.add(event);
    for (const record of this.observer.takeRecords()) this.records.push(record);
    const k = this.records.length;
    const last = this.typing.reusable(k);
    const act = interactionOf(event, this.root, (el) => this.inRoot(el), last);
    // Records taken for nothing still settle with their block: the
    // observer won't deliver them again.
    if (!act) {
      if (k > 0) this.schedule();
      return;
    }
    const noted = { ...act, k, n: this.moves.length };
    this.typing.last = act.event.kind === "type" ? noted : null;
    this.acts.push(noted);
    this.schedule();
  };

  private readonly onFocusIn = (): void => {
    this.leaving = false;
    const to = resolveFocusedElement(this.doc);
    this.moved(to);
    this.listenInside(to);
  };

  private readonly onFocusOut = (event: Event): void => {
    // Bound for another element: a browser runs microtasks between the
    // events of a move, and focus rests nowhere yet.
    this.leaving = (event as FocusEvent).relatedTarget != null;
    this.moved(null);
  };

  /**
   * Listen in every open shadow root `element` is inside, and its own, once
   * each: a move within one, or from a host into its own, stops at the host
   * and never reaches the document.
   */
  private listenInside(element: Element | null): void {
    if (this.done || !element) return;
    const own = this.shadowRoot.call(element) as ShadowRoot | null;
    if (own) this.listenIn(own);
    for (let el = element; ;) {
      const root = this.getRootNode.call(el);
      if (!(root instanceof ShadowRoot)) return;
      this.listenIn(root);
      el = root.host;
    }
  }

  private listenIn(root: ShadowRoot): void {
    if (this.shadowRoots.has(root)) return;
    this.shadowRoots.add(root);
    this.listen(root, this.addListener);
    // An `input` a script sends in it without `composed` stops there.
    if (this.options.interactions) this.listenForActs(root, this.addListener);
  }

  /** Is `element` in the root, and the root on the page? A region in a root
   *  the block took off the page is read by nobody. */
  private onPage(element: Element): boolean {
    return this.inRoot(element) && this.isConnected.call(element) === true;
  }

  /**
   * Note a focus event at this point among the page's changes: a move to
   * somewhere new for an event to name, not the second event of a pair or a
   * move between two places outside the root.
   */
  private moved(element: Element | null): void {
    if (this.done) return;
    const to = element && this.inRoot(element) ? element : null;
    if (this.moves.length && this.moves[this.moves.length - 1]!.to === to) {
      return;
    }
    for (const record of this.observer.takeRecords()) this.records.push(record);
    this.moves.push({ at: this.records.length, to, said: this.saidNow() });
    this.typing.last = null;
    this.schedule();
  }

  /**
   * What each region in the root says at a focus move, to place events by
   * ({@link heardAt}). Read only when the block changed something in or
   * around the root since the last move's read; otherwise that read stands,
   * or, with none, the regions still say what they said before the block.
   */
  private saidNow(): Map<Element, Said> | undefined {
    if (!this.options.announcements) return undefined;
    const last = this.moves[this.moves.length - 1];
    // In the root as rendered, so light-DOM text a slot in the root renders
    // counts, as it does for the regions that hold it.
    const fresh = this.records.slice(last?.at ?? 0).some(({ target }) => {
      const el =
        safeNodeType(target) === Node.ELEMENT_NODE
          ? (target as Element)
          : renderedIn(target);
      return (el !== null && this.inRoot(el)) || holds(target, this.root);
    });
    if (!fresh) return last?.said;
    const said = new Map<Element, Said>();
    for (const region of this.regionsWithin(this.root)) {
      if (isLive(regionLevel(region))) said.set(region, audibleRead(region));
    }
    return said;
  }

  /**
   * Read the block once the page's synchronous code has run. It renders as a
   * whole, so text set and cleared within it, or focus passing through an
   * element, never reached a screen reader.
   */
  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    // A promise job, not `queueMicrotask`, which Jest's fake timers fake.
    void Promise.resolve().then(() => this.settle());
  }

  /** Turn the block into events: what it left in each region, and where it
   *  left focus, each where in the block it happened. */
  private settle(): void {
    this.scheduled = false;
    if (this.done) return;
    const records = this.records;
    for (const record of this.observer.takeRecords()) records.push(record);
    const moves = this.moves;
    const acts = this.acts;
    this.records = [];
    this.moves = [];
    this.acts = [];
    const pending = this.options.announcements
      ? this.announcements(records, moves)
      : [];
    // Between two elements, focus is read once it arrives.
    let line: FocusLine | null = null;
    if (this.options.focus && !this.leaving) {
      line = this.focusSettled(records, moves);
      const change = this.focusChange(line.at);
      if (change) pending.push(change);
      else line = null;
    }
    const at = moves.map((move) => move.at);
    for (const act of acts)
      pending.push({ ...act, at: placeAct(act, at, line) });
    // Stable, so events from one record keep the order they were read in.
    pending.sort((a, b) => a.at - b.at);
    const events = pending.filter((p) => this.typing.keeps(p.event, p.el));
    this.typing.settled();
    this.emit(events.map((p) => p.event));
  }

  // ─── focus ─────────────────────────────────────────────────────────────────

  /**
   * Where in the block focus came to rest on what the event names: the first
   * of the moves, and records that removed the element focus was on (jsdom
   * fires no event for that), after which it named nothing else. Without
   * one, the end of the block.
   */
  private focusSettled(records: MutationRecord[], moves: Move[]): FocusLine {
    // Where, the element, and how many moves had been noted by then.
    const changes: [at: number, to: Element | null, moves: number][] = [];
    let current = this.focused;
    let next = 0;
    const moveTo = (i: number): void => {
      while (next < moves.length && moves[next]!.at <= i) {
        current = moves[next]!.to;
        changes.push([2 * moves[next]!.at, current, ++next]);
      }
    };
    records.forEach((record, i) => {
      moveTo(i);
      if (current && this.removes(record, current)) {
        current = null;
        changes.push([2 * i + 1, null, next]);
      }
    });
    moveTo(Infinity);
    const element = resolveFocusedElement(this.doc);
    const named = element && this.inRoot(element) ? element : null;
    const line = { at: 2 * records.length, moves: moves.length };
    for (let i = changes.length; i-- && changes[i]![1] === named;) {
      [line.at, , line.moves] = changes[i]!;
    }
    return line;
  }

  /** Did this record take `element` out of the document with it? */
  private removes(record: MutationRecord, element: Element): boolean {
    if (record.type !== "childList") return false;
    for (const node of record.removedNodes) {
      if (holds(node, element)) return true;
    }
    return false;
  }

  /** A focus event, if focus now rests somewhere other than the last event
   *  named. */
  private focusChange(at: number): Pending | null {
    const element = resolveFocusedElement(this.doc);
    // Same element as last read: no move, and no extraction to find that out.
    if (element === this.seen) return null;
    this.seen = element;
    this.listenInside(element);
    const named =
      element && this.inRoot(element) ? nodeStop(this.root, element) : null;
    const target = named === null ? null : element;
    if (target === this.focused) return null;
    this.focused = target;
    return {
      at,
      event: {
        kind: "focus",
        stop: named?.stop ?? null,
        hidden: named?.hidden ?? false,
      },
    };
  }

  // ─── live regions ──────────────────────────────────────────────────────────

  /**
   * An announce event for each region the block left showing new text, where
   * the block came to leave it so ({@link heardAt}).
   */
  private announcements(records: MutationRecord[], moves: Move[]): Pending[] {
    const pending: Pending[] = [];
    for (const [region, positions] of this.collect(records)) {
      const event = this.announcement(region);
      if (event) {
        pending.push({ at: this.heardAt(region, positions, moves), event });
      }
    }
    return pending;
  }

  /**
   * Where in the block `region` came to say what it now says: at its last
   * change, unless it had already said it aloud at a focus move and at every
   * move after ({@link alreadySaid}). Then at its last change before the
   * first of those moves, so a change after it that says nothing new, such
   * as a restyle that shows nothing, an edit under `aria-live="off"`, the
   * same words re-rendered or an old entry trimmed, can't carry the event past
   * the move. Words put in a new order after the move are new. And never
   * before a move at which it had not said it yet, whatever showed it after,
   * even a change that touched no region, such as a stylesheet's. What a
   * region said at a move only places an event, and is never recorded: the
   * block hadn't rendered.
   */
  private heardAt(region: Element, positions: number[], moves: Move[]): number {
    // Read only once a move has something to compare: a block with no focus
    // move, or none since the region changed, places by its last change.
    let now: Said | undefined;
    let first = moves.length;
    let after = -Infinity;
    while (first > 0) {
      const then = moves[first - 1]!.said?.get(region);
      if (!then) break;
      now ??= audibleRead(region);
      if (!alreadySaid(then, now)) {
        // Just after that move, ahead of the next record.
        after = 2 * moves[first - 1]!.at + 0.5;
        break;
      }
      first--;
    }
    const before = first < moves.length ? 2 * moves[first]!.at : Infinity;
    const earlier = positions.filter((at) => at < before);
    return Math.max(after, ...(earlier.length ? earlier : positions));
  }

  /**
   * Which regions the block changed, and everywhere it did: every region
   * around a change, and every region in what it restyled or inserted.
   * Regions switched off included, so that what they show while off is
   * known once they turn live.
   */
  private collect(records: MutationRecord[]): Map<Element, number[]> {
    const changed = new Map<Element, number[]>();
    const restyledAt = new Map<Element, number[]>();
    const removed: Node[] = [];
    const touch: Touch = (regions, at) => {
      for (const region of regions) {
        const positions = changed.get(region);
        if (positions) positions.push(at);
        else changed.set(region, [at]);
      }
    };
    for (const [i, record] of records.entries()) {
      const at = 2 * i + 1;
      const target = record.target;
      touch(this.regionsHolding(target), at);
      if (record.type === "attributes") {
        // Walked once per block, for every time the page restyled it.
        const positions = restyledAt.get(target as Element);
        if (positions) positions.push(at);
        else restyledAt.set(target as Element, [at]);
      } else if (record.type === "childList") {
        this.childList(record, at, touch);
        removed.push(...record.removedNodes);
      }
    }
    // A region moved within the block is still there, holding what it held.
    for (const node of removed) this.forget(node);
    for (const [element, positions] of restyledAt) {
      const regions = this.regionsWithin(element);
      for (const at of positions) touch(regions, at);
    }
    return changed;
  }

  /**
   * The regions a child added or removed changes beyond its parent's: those
   * inside an added child, and, for a shadow host's child, which shows
   * through a slot if anywhere, the regions around the slot.
   */
  private childList(record: MutationRecord, at: number, touch: Touch): void {
    const slots = this.shadowOf(record.target)?.querySelectorAll("slot");
    if (slots && record.removedNodes.length) {
      for (const slot of slots) touch(this.regionsHolding(slot), at);
    }
    for (const node of record.addedNodes) {
      if (slots) {
        touch(this.regionsHolding(renderedIn(node) ?? record.target), at);
      }
      // `regionsWithin` starts at the node itself.
      if (safeNodeType(node) === Node.ELEMENT_NODE) {
        touch(this.regionsWithin(node as Element), at);
      }
    }
  }

  /**
   * Every region rendering `node`, nearest first, if the root holds it:
   * regions switched off as well, and the regions around a region. A change
   * under an `aria-live` inside a region is still the region's change,
   * though it announces nothing for the text that change shows
   * ({@link gains}).
   */
  private regionsHolding(node: Node): Element[] {
    const found: Element[] = [];
    // Text a slot renders belongs to the regions around the slot.
    let el =
      safeNodeType(node) === Node.ELEMENT_NODE
        ? (node as Element)
        : renderedIn(node);
    for (; el; el = renderingParent(el)) {
      if (regionLevel(el) !== null) found.push(el);
      if (el === this.root) return found;
    }
    return [];
  }

  /** Every region in `element`'s subtree that the root holds, open shadow
   *  trees included, and those switched off. */
  private regionsWithin(element: Element): Element[] {
    let scope: Element | null = null;
    if (this.inRoot(element)) scope = element;
    else if (holds(element, this.root)) scope = this.root;
    const found: Element[] = [];
    if (scope) {
      this.eachElement(scope, (el) => {
        if (regionLevel(el) !== null) found.push(el);
      });
    }
    return found;
  }

  /** `start`, if an element, and every element under it, into open shadow
   *  roots. */
  private eachElement(start: Node, each: (el: Element) => void): void {
    const walker = this.createTreeWalker.call(
      this.doc,
      start,
      NodeFilter.SHOW_ELEMENT,
    );
    let n: Node | null =
      safeNodeType(start) === Node.ELEMENT_NODE ? start : walker.nextNode();
    for (; n; n = walker.nextNode()) {
      each(n as Element);
      const shadow = this.shadowOf(n);
      if (shadow) this.eachElement(shadow, each);
    }
  }

  /** `node`'s open shadow root, if it is an element with one. */
  private shadowOf(node: Node): ShadowRoot | null {
    return safeNodeType(node) === Node.ELEMENT_NODE
      ? (this.shadowRoot.call(node) as ShadowRoot | null)
      : null;
  }

  /**
   * Forget the regions a removal took with it, as emptying one does: put
   * back holding the same text, a region is announced again. Not one the
   * block put back already, which only moved, nor an ancestor of the root
   * put back on the page.
   */
  private forget(node: Node): void {
    if (safeNodeType(node) !== Node.ELEMENT_NODE) return;
    if (this.onPage(node as Element)) return;
    if (this.isConnected.call(this.root) && holds(node, this.root)) return;
    this.eachElement(node, (el) => this.forgetRegion(el));
  }

  /** Is `element` the root, or rendered inside it? */
  private inRoot(element: Element): boolean {
    for (let el: Element | null = element; el; el = renderingParent(el)) {
      if (el === this.root) return true;
    }
    return false;
  }

  /**
   * The regions' texts at the start, those switched off included: only text
   * they gain is announced. One hidden from assistive tech above it holds its
   * text all the same.
   */
  private readBaseline(): void {
    for (const region of this.regionsWithin(this.root)) {
      const now = announcedRead(region);
      if (now.text) this.lastText.set(region, now.text);
      this.lastFrom.set(region, now.text ? now.from : heldFrom(region));
    }
  }

  /**
   * An announce event for `region`, if it now shows text it didn't show when
   * last read ({@link gains}): text written or inserted, or a part a restyle
   * reveals, but not text a removal or a restyle only takes away, nor a
   * change under an `aria-live="off"` inside it. The same text again says
   * nothing. Emptied, removed, or hidden by its own `hidden`, `display` or
   * `aria-hidden` or a container's, it forgets, so the same text shown again
   * is news again. Hidden from assistive tech above it (`aria-hidden` or
   * `inert` on an ancestor, as a modal does to the rest of the page), it
   * keeps what it showed: shown again, it announces only text it gained
   * meanwhile. Switched off, it announces nothing, but what it shows counts
   * as said once it turns live.
   */
  private announcement(region: Element): TimelineAnnounceEvent | null {
    const level = this.onPage(region) ? regionLevel(region) : null;
    if (!level) {
      this.forgetRegion(region);
      return null;
    }
    const now = announcedRead(region);
    if (!now.text) {
      if (heldFrom(region).size === 0) this.forgetRegion(region);
      return null;
    }
    const said =
      !isLive(level) ||
      this.lastText.get(region) === now.text ||
      !gains(region, now.from, this.lastFrom.get(region));
    this.lastText.set(region, now.text);
    this.lastFrom.set(region, now.from);
    if (said) return null;
    return {
      kind: "announce",
      role: getImplicitRole(region),
      text: now.text,
      live: level,
    };
  }

  private forgetRegion(region: Element): void {
    this.lastText.delete(region);
    this.lastFrom.delete(region);
  }
}

/**
 * Record what a keyboard and screen-reader user meets from now on, in order:
 * where focus goes, and what live regions announce, as events. Stop it with
 * `stop()`, which returns them all; `serializeTimeline` in `serialize`
 * writes them as lines.
 *
 * - A **focus** event names the focused node as the tab order singles it
 *   out, with `hidden` when assistive tech can't reach it, or no node when
 *   focus rests on `<body>` or `<html>`, or outside the root. The first
 *   event is where focus starts, unless it starts on nothing.
 * - An **announce** event is the text a live region gains: an element with
 *   `aria-live="polite"` or `"assertive"`, or a `status` (an `<output>` too),
 *   `alert` or `log`. Only text nodes are read. A region emptied says
 *   nothing, and so does the same text set again; emptied, removed or hidden
 *   first, by itself or a container, it says it again. One hidden by
 *   `aria-hidden` or `inert` above it keeps its text, and one switched to
 *   `aria-live="off"` takes in what it shows silently.
 * - With `{ interactions: true }`, **press**, **click** and **type** events
 *   say what the user did: a key that types no text, a `click` the page
 *   received, and typing into a field, collapsed to one event per field and
 *   naming the field, never the characters (ADR-0001). Each is placed among
 *   the page's changes as a focus move is.
 * - Events follow the order the page made its changes. What one synchronous
 *   run of the page's code does is read once: text set and cleared in it, or
 *   focus passing through an element, is no event. Anything an `await`
 *   separates is read separately, even an `await` of a resolved promise.
 *
 * Only what the root holds is recorded. Changes inside a shadow root aren't
 * seen as they happen: a `MutationObserver` doesn't reach them. Call
 * `stop()` once done, or the recorder keeps listening.
 *
 * @internal The timeline view's one recorder, for every surface (ADR-0002):
 * `testing`'s `recordTimeline` today. Not a stability promise.
 */
export function startTimeline(
  root: Element,
  options: TimelineOptions = {},
): TimelineRecording {
  const problem = timelineProblem(root, options);
  if (problem) throw new TypeError(`startTimeline: ${problem}`);
  const { focus = true, announcements = true, interactions = false } = options;
  const { onEvents } = options;
  const recorder = new TimelineRecorder(root, {
    ...{ focus, announcements, interactions, onEvents },
  });
  return { stop: () => recorder.stop() };
}
