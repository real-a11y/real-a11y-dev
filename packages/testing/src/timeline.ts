// A timeline of what a keyboard and screen-reader user meets during an
// interaction: where focus goes, and what live regions announce, in order.
// `capture()` + `a11yDiff()` see the page at two moments; this records what
// happens between them.

import {
  buildA11yTree,
  extractDomTree,
  getImplicitRole,
  liveRegionLevel,
  pageText,
  renderingParent,
  resolveFocusedElement,
  safeContains,
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

/**
 * Attributes that can show or hide a region's text, or make an element a
 * region at all: revealing a pre-filled `role="alert"` changes nothing else.
 * The extension's live-region observer watches the same ones.
 */
const LIVE_REGION_ATTRIBUTES = [
  "hidden",
  "inert",
  "class",
  "style",
  "aria-hidden",
  "open",
  "role",
  "aria-live",
];

/** The politeness each live role implies, for the `{live=…}` suffix. */
const ROLE_LEVELS: ReadonlyMap<string, "polite" | "assertive"> = new Map([
  ["alert", "assertive"],
  ["status", "polite"],
  ["log", "polite"],
]);

/** One recorded line, `focus     …` or `announce  …`. */
function line(kind: "focus" | "announce", text: string): string {
  return `${kind.padEnd(10)}${text}`;
}

/** What a flush was run for, which decides where a focus change goes. */
type Trigger = "focusin" | "focusout" | "mutation";

/** A line, and the index of the first mutation record that caused it. */
interface Pending {
  at: number;
  text: string;
}

class TimelineRecorder {
  // Through the prototypes: a page's `<form name="addEventListener">` shadows
  // the document's own, and `<img name="createTreeWalker">` likewise. Read
  // here, not at module scope, so importing this package in plain Node, with
  // no DOM, doesn't throw.
  private readonly addListener = EventTarget.prototype.addEventListener;
  private readonly removeListener = EventTarget.prototype.removeEventListener;
  private readonly createTreeWalker = Document.prototype.createTreeWalker;
  private readonly lines: string[] = [];
  /** Each region's text when it last announced; gone once it empties. */
  private readonly lastText = new WeakMap<Element, string>();
  private readonly doc: Document;
  private readonly observer: MutationObserver;
  /** The focused element as last read, inside the root or not. */
  private seen: Element | null = null;
  /** The element the last focus line named, or null for `(none)`. */
  private focused: Element | null = null;
  /** Focus left an element and nothing has read where it went yet. */
  private blurred = false;
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
    this.observer = new MutationObserver((records) => {
      if (!this.box) this.handle(records, "mutation");
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
            attributeFilter: LIVE_REGION_ATTRIBUTES,
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
    }
  }

  stop(): A11ySnapshotBox {
    if (this.box) return this.box;
    this.flush("mutation");
    this.observer.disconnect();
    if (this.options.focus) {
      this.removeListener.call(this.doc, "focusin", this.onFocusIn, true);
      this.removeListener.call(this.doc, "focusout", this.onFocusOut, true);
    }
    this.box = boxSnapshot(
      this.lines.length ? this.lines.join("\n") : "(nothing recorded)",
    );
    return this.box;
  }

  // Focus has arrived: everything the page changed before it comes first.
  private readonly onFocusIn = (): void => this.flush("focusin");

  // Focus is leaving. The page's changes so far come before that, but where
  // focus went is read only once this step settles: a move fires `focusin`
  // straight after, a `blur()` nothing at all.
  private readonly onFocusOut = (): void => {
    this.flush("focusout");
    this.blurred = true;
    queueMicrotask(() => this.flush("mutation"));
  };

  /** Take the records the observer holds and handle them now. */
  private flush(trigger: Trigger): void {
    if (this.box) return;
    this.handle(this.observer.takeRecords(), trigger);
  }

  /**
   * Turn one batch of mutation records, plus where focus is now, into lines,
   * each at the first record that caused it. Text is read once per batch:
   * set and cleared within one synchronous block, it was never there.
   */
  private handle(records: MutationRecord[], trigger: Trigger): void {
    const regions = new Map<Element, number>();
    let dropAt = records.length;
    records.forEach((record, at) => {
      if (this.options.announcements) this.collect(record, at, regions);
      if (dropAt === records.length && this.removesFocused(record)) {
        dropAt = at;
      }
    });
    const pending: Pending[] = [];
    for (const [region, at] of regions) {
      const text = this.announcement(region);
      if (text) pending.push({ at, text });
    }
    if (this.options.focus && trigger !== "focusout") {
      // A focus that arrives (`focusin`) came after every record before it;
      // one lost to a blur came before every record since, the first one
      // included; one lost to a removal came with that record.
      let at = dropAt;
      if (trigger === "focusin") at = records.length;
      else if (this.blurred) at = -1;
      this.blurred = false;
      const change = this.focusChange(at);
      if (change) pending.push(change);
    }
    // Stable, so lines from one record keep the order they were read in.
    pending.sort((a, b) => a.at - b.at);
    for (const p of pending) this.lines.push(p.text);
  }

  // ─── focus ─────────────────────────────────────────────────────────────────

  /** Did this record take the element the last focus line named with it? */
  private removesFocused(record: MutationRecord): boolean {
    const focused = this.focused;
    if (!focused || record.type !== "childList") return false;
    for (const node of record.removedNodes) {
      if (safeContains(node, focused)) return true;
    }
    return false;
  }

  /** A focus line, if focus now rests somewhere other than the last line said. */
  private focusChange(at: number): Pending | null {
    const element = resolveFocusedElement(this.doc);
    // Same element as last read: no move, and no extraction to find that out.
    if (element === this.seen) return null;
    this.seen = element;
    const label = element ? this.focusLabel() : null;
    const target = label === null ? null : element;
    if (target === this.focused) return null;
    this.focused = target;
    return { at, text: line("focus", label ?? "(none)") };
  }

  /**
   * The focused node as a tab stop prints it, or null when the root's tree
   * doesn't hold it. A focused node the a11y view folds away (a `<div
   * tabindex="-1">` with no name) is still where the user is, so it falls
   * back to the DOM view's node.
   */
  private focusLabel(): string | null {
    const dom = extractDomTree(this.root);
    const id = dom.focusedId;
    if (!id) return null;
    const a11y = buildA11yTree(dom.nodes, dom.rootId, id, dom.source);
    const node = a11y.nodes.get(id) ?? dom.nodes.get(id);
    return node
      ? serializeTabStop(node, { redact: this.options.redact })
      : null;
  }

  // ─── live regions ──────────────────────────────────────────────────────────

  /** Note every region in the root this record may have changed the text of. */
  private collect(
    record: MutationRecord,
    at: number,
    regions: Map<Element, number>,
  ): void {
    const touch = (region: Element | null) => {
      if (region && !regions.has(region)) regions.set(region, at);
    };
    touch(this.regionHolding(record.target));
    if (record.type === "attributes") {
      this.regionsWithin(record.target as Element).forEach(touch);
      return;
    }
    record.addedNodes.forEach((node) => {
      if (safeNodeType(node) === Node.ELEMENT_NODE) {
        this.regionsWithin(node as Element).forEach(touch);
      }
    });
  }

  /** The nearest live region rendering `node`, if the root holds it. */
  private regionHolding(node: Node): Element | null {
    let element: Element | null;
    if (safeNodeType(node) === Node.ELEMENT_NODE) element = node as Element;
    else {
      // Text a slot renders belongs to the region around the slot.
      element = (node as Partial<Text>).assignedSlot ?? safeParentElement(node);
    }
    for (let el = element; el; el = renderingParent(el)) {
      if (liveRegionLevel(el)) return this.inRoot(el) ? el : null;
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
      if (liveRegionLevel(n as Element)) found.push(n as Element);
    }
    return found;
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
      if (text) this.lastText.set(region, text);
    }
  }

  /**
   * An announce line for `region`, if it now holds text it didn't hold when it
   * last announced. Emptied or hidden, it forgets: the same text shown again
   * is news again.
   */
  private announcement(region: Element): string | null {
    const level = this.inRoot(region) ? liveRegionLevel(region) : null;
    const text = level ? announcedText(region) : "";
    if (!level || !text) {
      this.lastText.delete(region);
      return null;
    }
    if (this.lastText.get(region) === text) return null;
    this.lastText.set(region, text);
    const role = getImplicitRole(region);
    const live = ROLE_LEVELS.get(role) === level ? "" : ` {live=${level}}`;
    const said = redactString(text, this.options.redact);
    return line("announce", `${role} "${said}"${live}`);
  }
}

/**
 * What a screen reader could say for `region`: core's read of a live region
 * (never raw `textContent`, which also holds a `<textarea>`'s markup default
 * and hidden text), line by line as the page lays it out, so two paragraphs
 * don't run together, then joined into one line.
 */
function announcedText(region: Element): string {
  return pageText(region, { announced: true, lines: true })
    .replace(/[ \t\n\r\f]+/g, " ")
    .trim();
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
 *   announce  status "Draft deleted."
 *   focus     button "New draft"
 * `);
 * ```
 *
 * - A **focus** line names the focused node as a tab stop prints it,
 *   `role "name" {states}`. `(none)` means focus rests on `<body>` or
 *   `<html>`, or on something the root's tree doesn't hold. The first line is
 *   where focus starts, unless it starts on nothing.
 * - An **announce** line is the text a live region gains: an element with
 *   `aria-live="polite"` or `"assertive"`, or a `status`, `alert` or `log`.
 *   It names the region's role, and `{live=…}` when `aria-live` sets a
 *   politeness the role doesn't imply. A region emptied prints nothing, and so
 *   does the same text set again; emptied first, it prints again.
 * - Lines follow the order the page made its changes. Text set and cleared
 *   within one synchronous block was never rendered, and prints nothing.
 *
 * Only what the root holds is recorded, so pass `document.body` to hear the
 * whole page. Changes inside a shadow root aren't seen: a `MutationObserver`
 * doesn't reach them.
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
