/**
 * Native accessibility-tree producer — Chromium's own tree over CDP, normalized
 * into the same `ExtractionResult` / `SemanticNode` model the DOM producer emits.
 *
 * This is the second producer from the native-tree RFC ("one model, two
 * producers"): where `@real-a11y-dev/core`'s extractors walk the light DOM,
 * this reads `Accessibility.getFullAXTree` and turns it into a `SemanticNode`
 * tree. It exists because Chromium exposes structure no in-page walk can reach
 * — most visibly a `<video controls>`'s user-agent-shadow controls (play,
 * scrubber, mute), which live in a closed shadow root.
 *
 * Read-only (Phase 1). Every node gets `a11y` (the product) and, when the AX
 * node has a backing DOM element, a `dom` facet. There is deliberately **no
 * `interaction` facet** — dispatching through the native tree is the CDP
 * `ActionBackend` of a later phase; a read-only tree lies less by omitting it.
 *
 * Vocabulary (which AX nodes survive, sibling order, role map, name promotion)
 * comes from core's shared `normalizeNativeAX` — this file does NOT re-implement
 * it (that was the drift bug RFC finding R4 consolidated away). It only adds
 * the transport (CDP), the richer AX→a11y mapping (states/properties/value),
 * the DOM enrichment, and the redaction gates.
 *
 * ## Field values (ADR-0001)
 * A field's value is page content: `a11y.value` holds what a screen reader
 * announces, taken from Chromium's own AX value — a text field's text, a
 * `<select>`'s selected option, a range widget's `aria-valuetext` else its
 * number, a file input's names, an editor's text. What is **sensitive** is
 * withheld: a field whose markup says `type="password"` or carries a
 * credential or payment `autocomplete` token (core's
 * {@link isSensitiveFieldAttributes}, read off the `type` / `autocomplete`
 * attributes this producer's DOM walk already records) reads `[redacted]` when
 * it holds anything — never Chromium's masking bullets, which give away the
 * length. So does anything inside such a field (a month input's UA-shadow
 * spinbuttons) or around it, and a container Chromium named from contents that
 * include one: see `fieldSensitivity` (in `native-sensitivity.ts`). That holds for a field the tree
 * has no node of its own for, too: what stands in for it there is classified
 * by the field's own markup (core's `fieldStandIns`).
 *
 * Nothing here reads an element's live `.value`, and the `dom` facet still
 * copies only an allowlist of structural / a11y attributes (never `value`): the
 * value reaches the tree through `a11y.value` alone, classified first. Core's
 * normalizer never promotes a node's value into its NAME (an unlabeled
 * field's, or an editor's typed text — the extension's native path shares that
 * rule): a value belongs in `a11y.value` and nowhere else.
 *
 * ## Strict mode — `redactInput` (RFC finding R1's blanket rule)
 * {@link NativeTreeOptions.redactInput} withholds every field value, sensitive
 * or not, and every rich-text editor's content. What a user typed into an
 * editor is its value — but Chromium also names the nodes inside the editor
 * from it (a paragraph's text, a link's, a heading's), so the same text reaches
 * the tree a second way. The strict mode closes that path at the source,
 * before normalization can promote anything: see `redactEditableContent`.
 *
 * (Caveat, documented not hand-waved: `getFullAXTree` / `getDocument`
 * responses themselves carry field values in their CDP payload — Chromium masks
 * passwords, but not, e.g., a `cc-number` on a plain text input. That is
 * Chromium's wire content, received in this process; what this code controls,
 * it classifies before anything leaves `buildNativeTree`.)
 */

import {
  normalizeNativeAX,
  nativeAXStateValue,
  serializeNativeAX,
  buildCssPath,
  graftNativeFrame,
  NATIVE_AX_CHOICE_STATES,
  nativeAncestry,
  cleanAXText,
  domLabels,
  opensFieldInternals,
  treeSource,
  type NativeAXNode,
  type RawAXNameNode as RawAXNode,
  type SemanticNode,
  type ExtractionResult,
  type A11yInfo,
  type DomInfo,
} from "@real-a11y-dev/core";
import type { CDPSession, Page } from "playwright";

import { attributeOf, readDomRoot, type DomNode } from "./dom-document.js";
import { editableRootBackendIds } from "./native-editable.js";
import { readFrames, type NativeFramePayload } from "./native-frames.js";
import { createLocatorIndex } from "./native-locator.js";
import {
  prepareRawNodes,
  type NativeDomInfo,
  type NativeTreeOptions,
} from "./native-sensitivity.js";
import { announcedValue } from "./native-value.js";

export type { NativeDomInfo, NativeFramePayload, NativeTreeOptions };

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
 * AX property names that map to boolean/stateful `a11y.states`.
 *
 * The shared ARIA-derived keys (`checked`, `expanded`, `pressed`, `selected`,
 * `disabled`, `required`, `invalid`) match what the DOM producer writes, so
 * those compare cleanly across producers. Native additionally exposes
 * Blink-computed state Chromium has but the in-page walk doesn't (`focusable`,
 * `focused`, `editable`, `settable`, `multiline`, `modal`, `busy`)
 * — a superset, not a conflict. Cross-producer state comparison is normalized
 * by the parity harness (RFC PR E), not relied on raw.
 */
const STATE_PROPS = new Set([
  "focusable",
  "focused",
  "editable",
  "settable",
  "checked",
  "expanded",
  "pressed",
  "selected",
  "disabled",
  "readonly",
  "required",
  "multiline",
  "invalid",
  "modal",
  "busy",
]);

/**
 * AX property names that map to descriptive `a11y.properties` (strings).
 *
 * `valuenow` / `valuetext` are deliberately NOT here. For a range widget they
 * ARE its value, and a value has one home — `a11y.value`, where the
 * sensitivity policy and `redactInput` both apply ({@link announcedValue}). A
 * copy here would route around both. `valuemin` / `valuemax` are authored
 * bounds (min/max attributes), not user data, so they stay.
 */
const DETAIL_PROPS = new Set([
  "level",
  "valuemin",
  "valuemax",
  "hasPopup",
  "keyshortcuts",
  "roledescription",
  "orientation",
  "autocomplete",
]);

/** Derive the id core's {@link normalizeNativeAX} assigns, so we can look a
 *  normalized node back up to its raw AX node (for states/properties). Kept in
 *  lockstep with core; the round-trip is asserted in the producer's tests. */
function nativeIdOf(raw: RawAXNode): string {
  return typeof raw.backendDOMNodeId === "number"
    ? `ax-dom-${raw.backendDOMNodeId}`
    : `ax-${raw.nodeId}`;
}

// ── Frames ──────────────────────────────────────────────────────────────────

/**
 * What joins a frame's locator to the locator of the `<iframe>` that shows
 * it: `body > iframe:nth-of-type(2) >>> form > input`. No single
 * `querySelector` can cross a frame, so a node inside one has no selector of
 * its own; the prefix keeps it from reading as a top-document path (and, in
 * a finding's fingerprint, from sharing an identity with one).
 */
const FRAME_LOCATOR_SEPARATOR = " >>> ";

/** One document of the tree — the page's, or a frame's — as the name-level
 *  redactions left it, and as core normalized it. */
interface NativeDocument {
  prepared: ReturnType<typeof prepareRawNodes>;
  normalized: NativeAXNode[];
}

/**
 * How {@link buildNativeTree} and {@link nativeAXView} assemble a recorded
 * read: {@link NativeTreeOptions}, plus the payloads of the page's
 * same-process frames, each to go under its `Iframe` row. Each frame is
 * classified as a document of its own, by the same `enrichment`: the one DOM
 * walk reaches their elements too.
 */
export interface NativeBuildOptions extends NativeTreeOptions {
  frames?: readonly NativeFramePayload[];
}

/**
 * Normalize the page's document and each frame's on its own, then graft each
 * frame under its `Iframe` row. Separately, because core treats every raw
 * node without a parent as a top-level root: concatenated, a frame's content
 * would land after the page instead of under its row. A frame whose row the
 * tree does not keep is dropped, along with the frames inside it.
 *
 * In strict mode, a frame whose row sits inside an editor (a `srcdoc` the
 * user wrote into a `contenteditable`) is that editor's content as a whole,
 * as {@link enrichFromDom} already treats it for locators. Chromium marks
 * nothing in the frame's own document `editable`, so its root is marked
 * here, and the editor rules (`redactEditableContent`) cover everything in it.
 *
 * Shared by {@link buildNativeTree} and {@link nativeAXView}, so the two can
 * never disagree about what a frame holds.
 */
function normalizeDocuments(
  rawNodes: RawAXNode[],
  enrichment: ReadonlyMap<number, NativeDomInfo>,
  options: NativeBuildOptions,
): { skeleton: NativeAXNode[]; documents: NativeDocument[] } {
  // The ids of every node read so far that is inside an editor.
  const inEditor = new Set<string>();
  const read = (nodes: RawAXNode[]): NativeDocument => {
    const prepared = prepareRawNodes(nodes, enrichment, options);
    for (const raw of prepared.insideEditor) inEditor.add(nativeIdOf(raw));
    return { prepared, normalized: normalizeNativeAX(prepared.nodes) };
  };
  const page = read(rawNodes);
  const skeleton = [...page.normalized];
  const documents = [page];
  for (const frame of options.frames ?? []) {
    const document = read(
      options.redactInput === true && inEditor.has(frame.ownerId)
        ? withEditableRoot(frame.rawNodes)
        : frame.rawNodes,
    );
    if (graftNativeFrame(skeleton, frame.ownerId, document.normalized)) {
      documents.push(document);
    }
  }
  return { skeleton, documents };
}

/** A frame's payload with its root marked `editable`, so everything in the
 *  frame counts as inside an editor. A copy: the input is never mutated. */
function withEditableRoot(rawNodes: RawAXNode[]): RawAXNode[] {
  return rawNodes.map((raw) =>
    raw.parentId
      ? raw
      : {
          ...raw,
          properties: [
            ...(raw.properties ?? []),
            { name: "editable", value: { type: "token", value: "richtext" } },
          ],
        },
  );
}

// ── Strict mode: rich-text editor content (`redactInput`) ──────────────────

/**
 * The `dom` attributes dropped inside an editable region: a URL the user typed
 * or pasted into a link or an image (an auto-linked `?token=` is the likeliest
 * secret in a message box), and an `id`, which some editors derive from a
 * heading's text. No sink prints these today; the strict mode holds by
 * construction rather than by that coincidence.
 */
const EDITABLE_CONTENT_ATTRIBUTES = new Set(["href", "src", "poster", "id"]);

/**
 * The flat, text-only view of Chromium's native tree that
 * `BrowserSession.nativeAX()` returns: indented `role "name"` lines (the same
 * shape the DOM producer's serializer prints, so the two are comparable) plus
 * the same lines as a flat list of role+name pairs, for order- and
 * indent-insensitive diffing.
 *
 * Vocabulary and names both come from core's shared `normalizeNativeAX`, after
 * the same name redactions as {@link buildNativeTree}, with each frame under
 * its `Iframe` row the same way — so this view and the `ExtractionResult` one
 * can never disagree about what is on a page.
 */
export function nativeAXView(
  rawNodes: RawAXNode[],
  enrichment: ReadonlyMap<number, NativeDomInfo> = new Map(),
  options: NativeBuildOptions = {},
): {
  tree: string;
  pairs: string[];
} {
  const { skeleton: nodes } = normalizeDocuments(rawNodes, enrichment, options);
  return {
    tree: serializeNativeAX(nodes),
    pairs: nodes.map((n) => (n.name ? `${n.role} "${n.name}"` : n.role)),
  };
}

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

/** {@link allowlistAttributes}' output minus what an editor's user supplied —
 *  see {@link EDITABLE_CONTENT_ATTRIBUTES}. */
function withoutEditableContent(
  attributes: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(attributes).filter(
      ([key]) => !EDITABLE_CONTENT_ATTRIBUTES.has(key),
    ),
  );
}

/** `attributes` without the markup `selected` flag when the option's selection
 *  is withheld — an `<option selected>` would otherwise say what a sensitive
 *  `<select>` holds even with its AX state dropped. */
function withoutSelection(
  attributes: Record<string, string>,
  withhold: boolean,
): Record<string, string> {
  if (!withhold || !("selected" in attributes)) return attributes;
  const { selected: _dropped, ...rest } = attributes;
  return rest;
}

/** Split an AX node's `properties` into `states` (bool/stateful) and
 *  `properties` (descriptive strings). Field values are never read here. */
function axFacets(raw: RawAXNode): Pick<A11yInfo, "states" | "properties"> {
  const states: A11yInfo["states"] = {};
  const properties: A11yInfo["properties"] = {};
  for (const p of raw.properties ?? []) {
    const v = p.value?.value;
    if (v === undefined || v === null || typeof v === "object") continue;
    // Chromium computes a list item's `level` from its nesting depth; no
    // author set it, and the DOM producer never reports one (only headings,
    // and the roles whose level Core-AAM requires computed, carry a level).
    // Kept in lockstep with the other native transport.
    if (p.name === "level" && raw.role?.value === "listitem") continue;
    if (STATE_PROPS.has(p.name)) {
      states[p.name] = nativeAXStateValue(p.value!);
    } else if (DETAIL_PROPS.has(p.name)) {
      properties[p.name] = String(v);
    }
  }
  return { states, properties };
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
 */
async function enrichFromDom(
  client: CDPSession,
  editableRoots: ReadonlySet<number> = new Set(),
): Promise<Map<number, NativeDomInfo>> {
  const out = new Map<number, NativeDomInfo>();
  const root = await readDomRoot(client);
  const labelsOf = domLabels(root);

  const locators = createLocatorIndex();

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
    let locator: string | undefined;
    if (typeof node.backendNodeId === "number" && node.nodeName) {
      const ariaValueText = attributeOf(node, "aria-valuetext");
      const labels = labelsOf(node.backendNodeId) ?? [];
      const path = buildCssPath(node, locators.adapter);
      locator =
        frame === undefined
          ? path
          : path
            ? `${frame}${FRAME_LOCATOR_SEPARATOR}${path}`
            : frame;
      out.set(node.backendNodeId, {
        tagName: node.nodeName.toLowerCase(),
        attributes: allowlistAttributes(node.attributes ?? []),
        locator,
        ...(ariaValueText !== null ? { ariaValueText } : {}),
        ...(host !== undefined ? { fieldHost: host } : {}),
        ...(labels.length > 0 ? { labels } : {}),
      });
    }
    const below =
      inside ||
      (typeof node.backendNodeId === "number" &&
        editableRoots.has(node.backendNodeId));
    for (const child of node.children ?? []) walk(child, below, host, frame);
    if (node.contentDocument) {
      walk(node.contentDocument, below, undefined, locator || frame);
    }
    for (const sub of node.shadowRoots ?? []) {
      walk(
        sub,
        below,
        host ??
          (opensFieldInternals(node.nodeName, sub.shadowRootType)
            ? node.backendNodeId
            : undefined),
        frame,
      );
    }
    // A `::before` or `::after` Chromium lays out as a box has a node of its
    // own in the tree: recorded as seen, with no element to describe.
    for (const pseudo of node.pseudoElements ?? []) {
      if (typeof pseudo.backendNodeId !== "number") continue;
      out.set(pseudo.backendNodeId, {
        tagName: (pseudo.nodeName ?? "").toLowerCase(),
        attributes: {},
        pseudo: true,
        ...(host !== undefined ? { fieldHost: host } : {}),
      });
    }
  };
  walk(root, false, undefined, undefined);
  return out;
}

/**
 * Both CDP reads a native tree is built from, over one session: the
 * accessibility tree of the page and of each of its same-process frames
 * ({@link readFrames}), then one DOM walk, which reaches those frames'
 * documents too. The frames are read first so that strict mode knows their
 * editable regions before the walk.
 */
async function readNative(
  client: CDPSession,
  options: NativeTreeOptions,
): Promise<{
  rawNodes: RawAXNode[];
  frames: NativeFramePayload[];
  enrichment: Map<number, NativeDomInfo>;
}> {
  await client.send("Accessibility.enable");
  const { nodes: rawNodes } = (await client.send(
    "Accessibility.getFullAXTree",
  )) as { nodes: RawAXNode[] };
  const frames = await readFrames(client, rawNodes);
  const editableRoots = new Set<number>();
  if (options.redactInput === true) {
    for (const nodes of [rawNodes, ...frames.map((f) => f.rawNodes)]) {
      for (const id of editableRootBackendIds(nodes)) editableRoots.add(id);
    }
  }
  const enrichment = await enrichFromDom(client, editableRoots);
  return { rawNodes, frames, enrichment };
}

/**
 * Read Chromium's native accessibility tree for `page` and normalize it into
 * an {@link ExtractionResult} stamped `source.producer === "native"`.
 *
 * Uses its own CDP session (created and detached here), so it composes with the
 * page-bundle DOM path without interfering. Read-only: nodes carry `a11y` and
 * (when resolvable) `dom`, never `interaction` or `ui`. Field values follow
 * ADR-0001 unless `options.redactInput` is set — see {@link NativeTreeOptions}.
 */
export async function nativeTree(
  page: Page,
  options: NativeTreeOptions = {},
): Promise<ExtractionResult> {
  const client = await page.context().newCDPSession(page);
  try {
    const { rawNodes, frames, enrichment } = await readNative(client, options);
    const chrome = page.context().browser()?.version();
    return buildNativeTree(rawNodes, enrichment, chrome, {
      ...options,
      frames,
    });
  } finally {
    await client.detach().catch(() => {});
  }
}

/**
 * {@link nativeAXView} for a live page — both CDP reads, so the view's names
 * pass the same sensitivity classification as {@link nativeTree}'s.
 */
export async function nativeAXViewOf(
  page: Page,
  options: NativeTreeOptions = {},
): Promise<{ tree: string; pairs: string[] }> {
  const client = await page.context().newCDPSession(page);
  try {
    const { rawNodes, frames, enrichment } = await readNative(client, options);
    return nativeAXView(rawNodes, enrichment, { ...options, frames });
  } finally {
    await client.detach().catch(() => {});
  }
}

/**
 * Pure AX→`ExtractionResult` assembly, split out so it can be unit-tested on a
 * recorded `getFullAXTree` payload with no browser. `enrichment` maps a backend
 * DOM node id to its (already allowlist-filtered) tag + attributes; a
 * DOM-backed node missing from it has any value withheld, since there is
 * nothing to classify it by. `options.frames` are the page's same-process
 * frames ({@link NativeBuildOptions}), each under its `Iframe` row.
 */
export function buildNativeTree(
  rawNodes: RawAXNode[],
  enrichment: Map<number, NativeDomInfo> = new Map(),
  chrome?: string,
  options: NativeBuildOptions = {},
): ExtractionResult {
  const redactInput = options.redactInput === true;
  // Core owns the vocabulary: which nodes survive, sibling order, role map,
  // name promotion, id derivation. We only decorate the survivors — after the
  // name-level redactions, so nothing core promotes can carry what they
  // withhold.
  const { skeleton, documents } = normalizeDocuments(
    rawNodes,
    enrichment,
    options,
  );
  // Each survivor's raw node, with the classification of the document it is
  // in. Within one renderer process backend and AX node ids are unique, so
  // one lookup spans every document read.
  const sourceById = new Map<
    string,
    { raw: RawAXNode; prepared: NativeDocument["prepared"] }
  >();
  const rawByNodeId = new Map<string, RawAXNode>();
  for (const { prepared } of documents) {
    for (const raw of prepared.nodes) {
      sourceById.set(nativeIdOf(raw), { raw, prepared });
      rawByNodeId.set(raw.nodeId, raw);
    }
  }

  // A `<select>`'s value is also which of its options is `selected`: an
  // option's state would say what a withheld value is. Dropped for an option
  // inside a sensitive field, and in strict mode for one inside any choice
  // field (a combobox or listbox).
  const inChoiceField = (raw: RawAXNode): boolean => {
    for (const cur of nativeAncestry(raw, rawByNodeId)) {
      const role = cur.role?.value;
      if (cur !== raw && (role === "combobox" || role === "listbox"))
        return true;
    }
    return false;
  };

  const nodes = new Map<string, SemanticNode>();
  for (const nn of skeleton) {
    const source = sourceById.get(nn.id);
    const raw = source?.raw;
    const { states, properties } = raw
      ? axFacets(raw)
      : { states: {}, properties: {} };
    // One decision for both places the selection shows: the AX state and the
    // option's markup `selected` attribute on the `dom` facet.
    const withholdSelection =
      !!source &&
      (source.prepared.sensitivity.regions.inside(source.raw) ||
        (redactInput && inChoiceField(source.raw)));
    if (withholdSelection) {
      for (const state of NATIVE_AX_CHOICE_STATES) delete states[state];
    }

    const enriched =
      nn.backendDOMNodeId !== null
        ? enrichment.get(nn.backendDOMNodeId)
        : undefined;

    // What a screen reader announces — never in strict mode, and `[redacted]`
    // for anything the sensitivity policy covers.
    const value =
      source && !redactInput
        ? announcedValue(
            source.raw,
            nn.role,
            enriched,
            source.prepared.sensitivity.withholdsValue(source.raw),
          )
        : undefined;

    const a11y: A11yInfo = {
      role: nn.role,
      // Core never promotes a node's value into its name, so this is safe to
      // take as-is: a value lives in `value`, below, or nowhere.
      name: nn.name,
      description: raw?.description?.value
        ? cleanAXText(String(raw.description.value))
        : "",
      ...(value !== undefined ? { value } : {}),
      states,
      properties,
      isExposedToAT: true,
    };

    const dom: DomInfo | undefined =
      enriched && enriched.pseudo !== true
        ? {
            tagName: enriched.tagName,
            attributes: withoutSelection(
              source?.prepared.insideEditor.has(source.raw)
                ? withoutEditableContent(enriched.attributes)
                : enriched.attributes,
              withholdSelection,
            ),
            textContent: null,
            descendantText: "",
            isHidden: false,
            ...(enriched.locator ? { locator: enriched.locator } : {}),
          }
        : undefined;

    const node: SemanticNode = {
      id: nn.id,
      parentId: null, // wired below
      childIds: nn.childIds,
      depth: nn.depth,
      a11y,
      // Read-only: no `interaction` (that is the CDP ActionBackend's phase) and
      // no panel-only `ui`. `dom` present only when a DOM node backed this.
      ...(dom ? { dom } : {}),
    };
    nodes.set(nn.id, node);
  }

  // Second pass: wire parentId from the skeleton's childIds (document order).
  for (const nn of skeleton) {
    for (const childId of nn.childIds) {
      const child = nodes.get(childId);
      if (child) child.parentId = nn.id;
    }
  }

  // Core's `normalizeNativeAX` drops the `RootWebArea` and generic/ignored
  // html/body wrappers, so ANY page whose body has more than one kept child —
  // a normal `<header>`/`<main>`/`<footer>` layout, not just cross-frame
  // payloads — yields multiple parent-less roots. `linearize`/`serializeTree`
  // only traverse `rootId`'s subtree, so picking the first root would silently
  // truncate every sibling. Synthesize a single `document` root that adopts
  // all parent-less nodes, matching the DOM producer (always exactly one root).
  const roots = [...nodes.values()].filter((n) => n.parentId === null);
  let rootId: string;
  if (roots.length === 1) {
    rootId = roots[0].id;
  } else if (roots.length > 1) {
    rootId = "ax-root";
    const synthetic: SemanticNode = {
      id: rootId,
      parentId: null,
      childIds: roots.map((r) => r.id),
      depth: 0,
      a11y: {
        role: "document",
        name: "",
        description: "",
        states: {},
        properties: {},
        isExposedToAT: true,
      },
    };
    for (const r of roots) r.parentId = rootId;
    nodes.set(rootId, synthetic);
  } else {
    rootId = "";
  }

  // Recompute depths from the real root so `node.depth` is always the
  // distance from `rootId` (wrapping shifted the former roots down a level).
  if (rootId) {
    const setDepth = (id: string, depth: number) => {
      const node = nodes.get(id);
      if (!node) return;
      node.depth = depth;
      for (const childId of node.childIds) setDepth(childId, depth + 1);
    };
    setDepth(rootId, 0);
  }

  // Chromium marks the focused node with the `focused` AX property, which
  // lands in `a11y.states`. Promote it to the tree-level pointer the DOM
  // producer sets, because that is what every focus-aware consumer reads:
  // `serializeTree`'s `[focused]` marker and `serializeTreeDiff`'s focus-move
  // line both take nodes looked up by `focusedId`. Without this a native tree
  // knows where focus is and can't say so — a `focus` action reports a bare
  // `a11y.states.focused` flip instead of the focus move it actually was.
  const focused = [...nodes.values()].find(
    (n) => n.a11y.states.focused === true,
  );

  return {
    nodes,
    rootId,
    ...(focused ? { focusedId: focused.id } : {}),
    source: treeSource("native", { chrome, redactInput }),
  };
}
