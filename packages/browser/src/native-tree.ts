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
  carriesChoiceState,
  dropChoiceStates,
  isChoiceState,
  normalizeNativeAX,
  nativeAXFacets,
  serializeNativeAX,
  graftNativeFrame,
  isNativeIframeRole,
  nativeAncestry,
  cleanAXText,
  treeSource,
  withNativeIdSuffix,
  type NativeAXNode,
  type RawAXNameNode as RawAXNode,
  type SemanticNode,
  type ExtractionResult,
  type A11yInfo,
  type DomInfo,
} from "@real-a11y-dev/core";
import type { Page } from "playwright";

import type { NativeFramePayload } from "./native-frames.js";
import { readNative } from "./native-read.js";
import {
  prepareRawNodes,
  type NativeDomInfo,
  type NativeTreeOptions,
} from "./native-sensitivity.js";
import { announcedValue } from "./native-value.js";

export type { NativeDomInfo, NativeFramePayload, NativeTreeOptions };
export { allowlistAttributes } from "./native-dom.js";

/** Derive the id core's {@link normalizeNativeAX} assigns, so we can look a
 *  normalized node back up to its raw AX node (for states/properties). Kept in
 *  lockstep with core; the round-trip is asserted in the producer's tests. */
function nativeIdOf(raw: RawAXNode): string {
  return typeof raw.backendDOMNodeId === "number"
    ? `ax-dom-${raw.backendDOMNodeId}`
    : `ax-${raw.nodeId}`;
}

// ── Frames ──────────────────────────────────────────────────────────────────

/** One document of the tree — the page's, or a frame's — as the name-level
 *  redactions left it, and as core normalized it (ids suffixed when it runs
 *  in another process), with the DOM walk it was classified by. */
interface NativeDocument {
  prepared: ReturnType<typeof prepareRawNodes>;
  normalized: NativeAXNode[];
  enrichment: ReadonlyMap<number, NativeDomInfo>;
  suffix: string;
}

/**
 * How {@link buildNativeTree} and {@link nativeAXView} assemble a recorded
 * read: {@link NativeTreeOptions}, plus the payloads of the page's frames,
 * each to go under its `Iframe` row. Each frame is classified as a document
 * of its own, by the DOM walk of the process it runs in: the page's
 * `enrichment` for a same-process frame, its own for one in another process
 * ({@link NativeFramePayload}).
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
  const read = (
    nodes: RawAXNode[],
    dom: ReadonlyMap<number, NativeDomInfo>,
    suffix: string,
  ): NativeDocument => {
    const prepared = prepareRawNodes(nodes, dom, options);
    for (const raw of prepared.insideEditor) {
      inEditor.add(`${nativeIdOf(raw)}${suffix}`);
    }
    const normalized = normalizeNativeAX(prepared.nodes).map((n) =>
      withNativeIdSuffix(n, suffix),
    );
    return { prepared, normalized, enrichment: dom, suffix };
  };
  const page = read(rawNodes, enrichment, "");
  const skeleton = [...page.normalized];
  const documents = [page];
  for (const frame of options.frames ?? []) {
    const document = read(
      options.redactInput === true && inEditor.has(frame.ownerId)
        ? withEditableRoot(frame.rawNodes)
        : frame.rawNodes,
      frame.enrichment ?? enrichment,
      frame.suffix ?? "",
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

/** `attributes` without the markup that says which choice is made when the
 *  node's choice states are `withheld` (core's `dropChoiceStates`): an
 *  `<option selected>` would otherwise say what a sensitive `<select>` holds
 *  even with its AX state dropped, and, where a choice is made, a radio's
 *  `checked` which of a popup's radios is chosen. A checkbox keeps its own
 *  (core's `isChoiceState`). */
function withoutChoiceMarkup(
  attributes: Record<string, string>,
  withheld: "choice" | "field" | "none",
  role: string,
): Record<string, string> {
  if (withheld === "none") return attributes;
  const { selected: _selected, ...rest } = attributes;
  const all = withheld === "choice" || role === "option";
  if (!all || !isChoiceState("checked", role)) return rest;
  const { checked: _checked, ...kept } = rest;
  return kept;
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
    const { rawNodes, frames, enrichment } = await readNative(
      page,
      client,
      options,
    );
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
    const { rawNodes, frames, enrichment } = await readNative(
      page,
      client,
      options,
    );
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
 * nothing to classify it by. `options.frames` are the page's frames
 * ({@link NativeBuildOptions}), each under its `Iframe` row.
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
  // Each survivor's raw node, with the document it is in: its
  // classification, its DOM walk, and its own nodes by AX id. Ids repeat
  // across processes, so a node is found by its suffixed id, and everything
  // else about it within its own document.
  const sourceById = new Map<
    string,
    { raw: RawAXNode; document: NativeDocument }
  >();
  const rawByNodeIdOf = new Map<NativeDocument, Map<string, RawAXNode>>();
  for (const document of documents) {
    const byNodeId = new Map<string, RawAXNode>();
    for (const raw of document.prepared.nodes) {
      sourceById.set(`${nativeIdOf(raw)}${document.suffix}`, {
        raw,
        document,
      });
      byNodeId.set(raw.nodeId, raw);
    }
    rawByNodeIdOf.set(document, byNodeId);
  }

  // A `<select>`'s value is also which of its options is `selected`: an
  // option's state would say what a withheld value is. Dropped for an option
  // inside a sensitive field, including a sensitive list box that holds no AX
  // value and so names nothing, and in strict mode for one inside any choice
  // field (a combobox or listbox).
  const inChoiceField = (
    raw: RawAXNode,
    document: NativeDocument,
    sensitiveOnly: boolean,
  ): boolean => {
    const { sensitiveFields } = document.prepared.sensitivity;
    for (const cur of nativeAncestry(raw, rawByNodeIdOf.get(document)!)) {
      const role = cur.role?.value;
      if (cur === raw || (role !== "combobox" && role !== "listbox")) continue;
      if (!sensitiveOnly || sensitiveFields.has(cur.nodeId)) return true;
    }
    return false;
  };

  // One decision for both places a choice shows: the AX states (core's
  // `isChoiceState`) and the markup `selected` / `checked` on the `dom`
  // facet. Only a node that carries either has one to withhold, and the
  // ancestry walk is only needed for one. Either alone counts: Chromium
  // leaves the AX state off a disabled option (a disabled `<select>`, one in
  // a disabled `<fieldset>`), while the markup attribute stays. Where a
  // sensitive field's choice is made (`choiceReach`) every choice state goes;
  // elsewhere inside a sensitive field (a region read fail-closed, as an
  // editor around a card input), and in strict mode inside any choice field,
  // only what core's `dropChoiceStates` drops in a `"field"`, as the DOM
  // producer's `withholdsState` decides.
  const choiceWithheld = (
    source: { raw: RawAXNode; document: NativeDocument },
    role: string,
    states: A11yInfo["states"],
    enriched: NativeDomInfo | undefined,
  ): "choice" | "field" | "none" => {
    const attributes = enriched?.attributes ?? {};
    const carries =
      carriesChoiceState(states, role) ||
      "selected" in attributes ||
      ("checked" in attributes && isChoiceState("checked", role));
    if (!carries) return "none";
    const { sensitivity } = source.document.prepared;
    if (sensitivity.choiceReach.has(source.raw.nodeId)) return "choice";
    const inField =
      sensitivity.regions.inside(source.raw) ||
      ((redactInput || sensitivity.sensitiveFields.size > 0) &&
        inChoiceField(source.raw, source.document, !redactInput));
    return inField ? "field" : "none";
  };

  const nodes = new Map<string, SemanticNode>();
  for (const nn of skeleton) {
    const source = sourceById.get(nn.id);
    const raw = source?.raw;
    const { states, properties } = raw
      ? nativeAXFacets(raw)
      : { states: {}, properties: {} };
    // The node's element, as the DOM walk of its own process recorded it.
    const enriched =
      source && nn.backendDOMNodeId !== null
        ? source.document.enrichment.get(nn.backendDOMNodeId)
        : undefined;

    const withheld = source
      ? choiceWithheld(source, nn.role, states, enriched)
      : "none";
    if (withheld !== "none") dropChoiceStates(states, nn.role, withheld);

    // What a screen reader announces — never in strict mode, and `[redacted]`
    // for anything the sensitivity policy covers.
    const value =
      source && !redactInput
        ? announcedValue(
            source.raw,
            nn.role,
            enriched,
            source.document.prepared.sensitivity.withholdsValue(source.raw),
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
            attributes: withoutChoiceMarkup(
              source?.document.prepared.insideEditor.has(source.raw)
                ? withoutEditableContent(enriched.attributes)
                : enriched.attributes,
              withheld,
              nn.role,
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
  // With focus inside a frame Chromium can mark the `<iframe>`'s row too: the
  // node inside it is the one focused.
  const focusedNodes = [...nodes.values()].filter(
    (n) => n.a11y.states.focused === true,
  );
  const focused =
    focusedNodes.find((n) => !isNativeIframeRole(n.a11y.role)) ??
    focusedNodes[0];

  return {
    nodes,
    rootId,
    ...(focused ? { focusedId: focused.id } : {}),
    source: treeSource("native", { chrome, redactInput }),
  };
}
