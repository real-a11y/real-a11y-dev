/**
 * The types of a native-tree read: the enriched node, the one capability a
 * CDP transport must offer, an out-of-process frame's session, and what a
 * read takes and returns. Split out of `native-core.ts`, which re-exports
 * them, so every caller still finds them there.
 */

import type {
  A11yInfo,
  NativeAXNode,
  NativeFrameRef,
} from "@real-a11y-dev/core";

import type { FrameAnswers, PageKeysRead } from "./page-keys.js";

/** A normalized native node with the states/properties/description
 *  enrichment attached, plus the field facets `fieldFacets` resolves. */
export type EnrichedNativeNode = NativeAXNode &
  Pick<A11yInfo, "states" | "properties" | "description"> & {
    /**
     * What a screen reader announces for this node (ADR-0001) — Chromium's
     * own AX value (a `<select>`'s selected option LABEL, an editor's text),
     * or a range widget's `aria-valuetext` — whitespace-collapsed and capped
     * at 240 characters. A sensitive field that holds anything reads
     * {@link NATIVE_REDACTED_VALUE}. Absent when there is none, and whenever
     * `pageReadValue` could not classify the element.
     */
    value?: string;
    /**
     * Set when `value` is the redaction marker — a sensitive field that
     * holds something — so a consumer never has to compare `value` against
     * the marker text, which an editor could hold as ordinary content.
     */
    redacted?: boolean;
    /**
     * The raw live DOM value of a non-sensitive `<input>`/`<textarea>`/
     * `<select>` (`"es"` where `value` is `"Spain"`), uncollapsed and
     * uncapped — what a retype starts from, so an unedited submit writes
     * back exactly what was there. Never shown in the tree, and never set
     * for a sensitive field.
     */
    rawValue?: string;
    /** The field's static placeholder hint (`<input>`/`<textarea>` only) —
     *  page-authored text, not user input, so unlike `value` it is never
     *  redacted. Present only for a value-bearing role that actually has
     *  one set. */
    placeholder?: string;
    /** Native ids of the nodes this one controls (`aria-controls`, as
     *  Chromium resolves it) that are themselves in the tree — see
     *  {@link nativeControls}. Absent when there are none. */
    controls?: string[];
    /**
     * Whether this field's value (and which of its options is chosen) must
     * be withheld from anything shown: true for a sensitive field, for one
     * inside a sensitive field or around a withheld one, and for one the
     * in-page read could not classify. False only for a field classified as
     * not sensitive, with no withheld field in it. Absent on a node that was
     * never read as a field, which a consumer treats as withheld too — see
     * {@link fieldValueWithheld}.
     */
    valueWithheld?: boolean;
    /** Its element's number in its document's walk (`page-keys.ts`), which
     *  the content script in that document's frame reports focus by. Only
     *  when the read numbered that document. */
    pageKey?: number;
    /** The frame whose document numbered `pageKey`, as the extension knows
     *  it, when that isn't the top frame (0). */
    pageFrame?: number;
    /** On an `Iframe` row: the frame it shows, when the read numbered that
     *  frame's document. Focus inside the frame on an element with no row
     *  above it in the frame selects this row. */
    embedsPageFrame?: number;
  };

/** The single capability the native path needs from any CDP transport. */
export interface CdpTransport {
  send<T = unknown>(method: string, params?: object): Promise<T>;
  /**
   * The sessions of this document's out-of-process frames — a cross-origin
   * `<iframe>` runs in another renderer, which this transport's own session
   * can't read or act in. Frames are announced asynchronously, so `until`
   * says when the caller has the ones it expects: the call waits, briefly,
   * for that before answering. `undefined` — at once, with no wait — when
   * this document's frames can't be announced at all (Chromium refused the
   * auto-attach, or the frame went away): no call will ever announce one,
   * so a caller waiting for more must stop. Optional: a transport that
   * can't reach them (a test fake) leaves those frames unread, and their
   * rows show as embedded. `waitMs` shortens the wait for a caller that
   * expects little.
   */
  frameSessions?(
    until?: (frameIds: readonly string[]) => boolean,
    waitMs?: number,
  ): Promise<FrameSession[] | undefined>;
}

/**
 * An out-of-process frame, and a transport into its own session. Its
 * `frameId` is also its target id, stable while its document lives, unlike
 * the session, which lasts only as long as one attach. Its `documentId` is
 * the document the frame shows now (its loader id): unlike `frameId`, it
 * changes when the frame navigates — to another site, into another process,
 * where the backend ids read before name other elements.
 */
export interface FrameSession extends NativeFrameRef {
  /** The child session's own id, which its events arrive under, where the
   *  transport has one. */
  sessionId?: string;
  transport: CdpTransport;
}

export interface NativeTreeResult {
  /** Normalized nodes (shared core vocabulary) plus states/properties, document order. */
  nodes: EnrichedNativeNode[];
  /** Indented `role "name"` serialization, the same grammar as `serializeTree`'s. */
  serialized: string;
  /** Raw AX node count before normalization — a dogfood size signal. */
  rawCount: number;
  /** Node count Chromium actually produced, after normalization but before
   *  `rootIdOf`'s synthetic root (if any) is pushed onto `nodes` — the other
   *  half of the `rawCount`/`keptCount` dogfood size signal. `nodes.length`
   *  itself is NOT this number on a multi-root page: it includes the
   *  synthesized wrapper, which Chromium never produced. */
  keptCount: number;
  /** The id of the tree's single root — see {@link rootIdOf}. Empty string
   *  for an empty tree. */
  rootId: string;
  /** The top frame's document (its loader id) as the read began: a new one
   *  on every navigation, a reload included, unlike the URL. Absent when
   *  Chromium didn't say. */
  documentId?: string;
  /** Rows carry `pageKey`s: the read numbered a document, the top one or a
   *  frame's, and the content script's numbering of it agreed. See
   *  {@link ReadNativeTreeOptions.pageKeys}. */
  pageKeyed?: boolean;
}

export interface ReadNativeTreeOptions {
  /**
   * Have the content script in every frame number its own document for this
   * read (`NATIVE_PAGE_KEYS`), and answer with what the frames answered.
   * The read says when its own walks are in, so that a frame still walking
   * by then, one busy in a long task, holds it up only a moment longer, and
   * which frames it put in the tree, to be asked first. Left out, the read
   * numbers nothing.
   */
  pageKeys?: (read: PageKeysRead) => Promise<FrameAnswers>;
}
