/**
 * The DOM half of a native read: one batched walk of a document, recording
 * per backend node what the accessibility tree can't say (tag, allowlisted
 * attributes, locator, labels, the field a UA-shadow node belongs to). Split
 * out of `native-tree.ts`, so a frame read in its own session
 * (`native-read.ts`) walks its document the same way.
 */

import {
  buildCssPath,
  domChoiceReads,
  domLabels,
  opensFieldInternals,
} from "@real-a11y-dev/core";
import type { CDPSession } from "playwright";

import { attributeOf, readDomRoot, type DomNode } from "./dom-document.js";
import { createLocatorIndex } from "./native-locator.js";
import type { NativeDomInfo } from "./native-sensitivity.js";

/** Structural / accessibility attributes we surface on the `dom` facet.
 *  Deliberately an ALLOWLIST — `value` and any other content-bearing or
 *  potentially-sensitive attribute is simply never copied (R1). */
const DOM_ATTR_ALLOWLIST = new Set([
  "id",
  "type",
  "role",
  "href",
  "alt",
  "title",
  "placeholder",
  "aria-label",
  "aria-describedby",
  "name",
  "for",
  "controls",
  "autoplay",
  "loop",
  "muted",
  "poster",
  "src",
  "lang",
  "dir",
  "disabled",
  "readonly",
  "required",
  "checked",
  "selected",
  "multiple",
  "open",
  "hidden",
  "autocomplete",
]);

/**
 * What joins a frame's locator to the locator of the `<iframe>` that shows
 * it: `body > iframe:nth-of-type(2) >>> form > input`. No single
 * `querySelector` can cross a frame, so a node inside one has no selector of
 * its own; the prefix keeps it from reading as a top-document path (and, in
 * a finding's fingerprint, from sharing an identity with one).
 */
export const FRAME_LOCATOR_SEPARATOR = " >>> ";

/**
 * Filter a CDP flat attribute list (`[name, value, name, value, …]`) down to
 * {@link DOM_ATTR_ALLOWLIST}. This is the R1 redaction gate: any attribute not
 * on the allowlist — most importantly `value` — is dropped, so no field value
 * ever reaches a node's `dom` facet. Exported so the gate is directly
 * unit-testable.
 */
export function allowlistAttributes(flat: string[]): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const key = flat[i];
    if (DOM_ATTR_ALLOWLIST.has(key)) attributes[key] = flat[i + 1];
  }
  return attributes;
}

/** The field a node in `node`'s shadow root `sub` belongs to: `host` if
 *  the node already is inside one, else `node` itself when `sub` is where a
 *  form control draws what it holds (core's `opensFieldInternals`). */
function shadowHost(
  node: DomNode,
  sub: DomNode,
  host: number | undefined,
): number | undefined {
  if (host !== undefined) return host;
  return opensFieldInternals(node.nodeName, sub.shadowRootType)
    ? node.backendNodeId
    : undefined;
}

/** What {@link enrichFromDom} records: each backend node's info, and (in
 *  strict mode) the backend ids below an editable region. */
export interface NativeDom {
  info: Map<number, NativeDomInfo>;
  inEditable: ReadonlySet<number>;
}

/**
 * One CDP round-trip: the whole DOM tree (backendNodeId + tagName +
 * attributes) → a `backendDOMNodeId → { tagName, attributes, locator }` map.
 * Attributes are filtered to {@link DOM_ATTR_ALLOWLIST} as they are read, so no
 * field value is ever placed on a node (R1). This is the batched enrichment of
 * RFC finding R3 — no per-node `resolveNode` / `callFunctionOn`.
 *
 * The locator is computed *here*, during this same walk, because this is the
 * only place the native path ever sees document structure. Findings run in
 * Node with no live element, so without this they carry no "where" at all —
 * and `audit` is documented as rule · severity · locator. Computing it here
 * costs nothing extra: the parent/child links are already in hand.
 *
 * Below an `editableRoots` element the walk ignores `id`s, so a locator inside
 * an editor anchors on the nearest id outside it (typically the host's own):
 * an editor may derive a heading's `id` from its typed text. Only strict mode
 * passes any.
 *
 * The walk enters every same-process frame's document (`contentDocument`),
 * where a path stops at the frame's own `<html>`; such a locator starts with
 * its `<iframe>`'s and {@link FRAME_LOCATOR_SEPARATOR}.
 *
 * A frame in another process is walked in its own session, from `start`: the
 * locator of its `<iframe>` in the parent document (`frame`), and whether
 * that `<iframe>` sits inside an editable region there (`inside`).
 */
export async function enrichFromDom(
  client: CDPSession,
  editableRoots: ReadonlySet<number> = new Set(),
  start: { frame?: string; inside?: boolean } = {},
): Promise<NativeDom> {
  const out = new Map<number, NativeDomInfo>();
  const inEditable = new Set<number>();
  const root = await readDomRoot(client);
  const labelsOf = domLabels(root);

  const locators = createLocatorIndex();

  // Record `node` (an element, a document, a shadow root), backend id `id`,
  // and return its locator: its path, after its frame's `<iframe>` locator if
  // it has one. The node itself, never a copy: the locator index knows nodes
  // by identity.
  const record = (
    node: DomNode,
    id: number,
    host: number | undefined,
    frame: string | undefined,
  ): string | undefined => {
    if (!node.nodeName) return undefined;
    const ariaValueText = attributeOf(node, "aria-valuetext");
    const labels = labelsOf(id) ?? [];
    const path = buildCssPath(node, locators.adapter);
    const locator =
      frame === undefined
        ? path
        : path
          ? `${frame}${FRAME_LOCATOR_SEPARATOR}${path}`
          : frame;
    out.set(id, {
      tagName: node.nodeName.toLowerCase(),
      attributes: allowlistAttributes(node.attributes ?? []),
      locator,
      ...(ariaValueText !== null ? { ariaValueText } : {}),
      ...(host !== undefined ? { fieldHost: host } : {}),
      ...(labels.length > 0 ? { labels } : {}),
    });
    return locator;
  };

  // A `::before` or `::after` Chromium lays out as a box has a node of its
  // own in the tree: recorded as seen, with no element to describe.
  const recordPseudo = (pseudo: DomNode, host: number | undefined): void => {
    if (typeof pseudo.backendNodeId !== "number") return;
    out.set(pseudo.backendNodeId, {
      tagName: (pseudo.nodeName ?? "").toLowerCase(),
      attributes: {},
      pseudo: true,
      ...(host !== undefined ? { fieldHost: host } : {}),
    });
  };

  // `host`: the form control whose user-agent shadow root, where it draws its
  // value, holds this node (`NativeDomInfo.fieldHost`). `frame`: the locator
  // of the `<iframe>` whose document holds it, if any.
  const walk = (
    node: DomNode,
    inside: boolean,
    host: number | undefined,
    frame: string | undefined,
  ): void => {
    locators.link(node, inside);
    const id = node.backendNodeId;
    if (inside && id !== undefined) inEditable.add(id);
    const locator =
      id === undefined ? undefined : record(node, id, host, frame);
    const below = inside || (id !== undefined && editableRoots.has(id));
    for (const child of node.children ?? []) walk(child, below, host, frame);
    if (node.contentDocument) {
      walk(node.contentDocument, below, undefined, locator || frame);
    }
    for (const sub of node.shadowRoots ?? []) {
      walk(sub, below, shadowHost(node, sub, host), frame);
    }
    for (const pseudo of node.pseudoElements ?? []) recordPseudo(pseudo, host);
  };
  walk(root, start.inside === true, undefined, start.frame);
  // Where a sensitive field's choice is made by a relation Chromium's tree
  // drops, and what marks itself chosen where the tree doesn't say: see
  // NativeDomInfo.choiceTarget and .chosen.
  const reads = domChoiceReads(root);
  for (const id of reads.targets) {
    const info = out.get(id);
    if (info) info.choiceTarget = true;
  }
  for (const id of reads.chosen) {
    const info = out.get(id);
    if (info) info.chosen = true;
  }
  return { info: out, inEditable };
}
