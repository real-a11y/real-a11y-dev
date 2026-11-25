/**
 * The sensitivity half of the native-tree producer (ADR-0001): which fields
 * hold what a screen reader must not repeat, the value a node announces, and
 * the name-level redactions applied to the raw AX nodes before core
 * normalizes them. Split out of `native-tree.ts`, which assembles the tree.
 */

import {
  isSensitiveFieldAttributes,
  holdsEnteredValue,
  fieldStandIns,
  givesValueAway,
  holdsUnclassifiedValue,
  dropBuiltInFileInputNames,
  indexNativeAX,
  isNativePasswordMask,
  sensitiveChoiceReach,
  withholdPopupChoiceNames,
  valueRegions,
  withholdFieldInternals,
  withholdRegionNames,
  type FieldHostOf,
  type FieldStandIn,
  type LabelsOf,
  type RawAXNameNode as RawAXNode,
  type NativeAXIndex,
  type ValueRegions,
} from "@real-a11y-dev/core";

import { redactEditableContent, strictValueRoots } from "./native-editable.js";

/**
 * How {@link nativeTree} / {@link buildNativeTree} treat what users entered.
 */
export interface NativeTreeOptions {
  /**
   * Strict mode (ADR-0001's `redactInput`): withhold every field value — not
   * just the sensitive ones — and all rich-text editor content. No node
   * carries `a11y.value`, and inside a `contenteditable` / `designMode` region
   * a name Chromium computed from the typed text reads `[redacted]`. Default
   * `false`: values are shown the way a screen reader announces them, and only
   * sensitive fields are withheld.
   */
  redactInput?: boolean;
  /**
   * On a session pinned to origins (`BrowserSessionOptions.allowedOrigins`,
   * the CLI's `--audit-origin`), the origins a frame's document may come
   * from. A frame loaded from any other origin is not read, nor the frames
   * inside it, and its row stays empty: the pin checks only the page's own
   * URL, and a frame would otherwise put another origin's authenticated
   * content in the tree. A `srcdoc`, `about:blank` or `data:` frame holds
   * its parent's markup and is read. Absent: every frame is read.
   * `BrowserSession` fills it from the pin of the page it opened.
   */
  frameOrigins?: readonly string[];
}

/**
 * What the batched DOM walk records per backend node. `locator` is optional
 * because {@link buildNativeTree} is a pure function anyone can hand a map to —
 * a recorded fixture or a hand-built one has no document to walk. The live walk
 * always fills it.
 */
export interface NativeDomInfo {
  tagName: string;
  attributes: Record<string, string>;
  locator?: string;
  /**
   * The element's `aria-valuetext`, which a range widget announces instead of
   * its number — and which Chromium does not report over CDP. Read only into
   * `a11y.value` (so the value policy and strict mode govern it), never onto
   * the `dom` facet.
   */
  ariaValueText?: string;
  /**
   * The backend id of the `<input>`, `<textarea>` or `<select>` whose
   * user-agent shadow root holds the node, where the control draws what it
   * holds (core's `opensFieldInternals`). Its text never reaches the tree
   * (core's `withholdFieldInternalText`, which says why), and when the tree
   * has no node of the control's own, the node stands in for it, classified
   * by the control's markup (core's `fieldStandIns`).
   */
  fieldHost?: number;
  /**
   * The backend ids of the `<label>`s Chromium reads for this form control
   * when another name takes it in (core's `domLabels`). Chromium's tree has
   * no trace of them for a hidden control, yet an `aria-labelledby` pointing
   * at one still reads them, and a field's value in one with them (core's
   * `valueRegions`). Absent for an element with none.
   */
  labels?: readonly number[];
  /**
   * Set where a sensitive field's choice is made by a relation Chromium's tree
   * drops (core's `domChoiceTargets`): in what such a field, or a combobox
   * around one, names in `aria-controls` or `aria-owns`, when that is an
   * element Chromium leaves out, as a `role="presentation"` wrapper around
   * the listbox. Its `controls` then has no target at all.
   */
  choiceTarget?: true;
  /**
   * Set where the element's markup marks it chosen in a way Chromium's tree
   * may not say (core's `domChoiceReads`): `aria-current`, or `aria-pressed`
   * on a role with no pressed state. A sensitive popup holding one lends its
   * choice to the names that read it.
   */
  chosen?: true;
  /**
   * A pseudo-element (`::before`, `::after`, `::marker`): content the page's
   * CSS generates, with no element of its own. The walk records it so its
   * node in the tree counts as seen, and gives it no `dom` facet.
   */
  pseudo?: boolean;
}

// ── Field values (ADR-0001) ─────────────────────────────────────────────────

/**
 * The labels the DOM walk found for each element (`NativeDomInfo.labels`), as
 * core's `valueRegions` asks for them: an element it never saw is
 * `undefined`, as for `FieldHostOf`.
 */
function labelsIn(enrichment: ReadonlyMap<number, NativeDomInfo>): LabelsOf {
  return (id) => {
    const info = enrichment.get(id);
    return info && (info.labels ?? []);
  };
}

/** Where the sensitive fields are, and what their values reach. */
export interface FieldSensitivity {
  regions: ValueRegions;
  /** A value on this node must read `[redacted]`. */
  withholdsValue(raw: RawAXNode): boolean;
  /**
   * Every field the policy classifies as sensitive, by raw id, before
   * {@link regions} prunes the ones with nothing to lend a name. A list box
   * holds no AX value, so it is pruned there, but which of its options is
   * selected is its value all the same.
   */
  sensitiveFields: ReadonlySet<string>;
  /**
   * Raw ids of the nodes where a sensitive field's choice is made: its popup,
   * a combobox around it, a multi-row one itself (core's
   * `sensitiveChoiceReach`). A choice state there says what the field holds.
   */
  choiceReach: ReadonlySet<string>;
  /** Backend ids the DOM walk marked `choiceTarget`. */
  choiceTargets: ReadonlySet<number>;
  /** Backend ids the DOM walk marked `chosen`. */
  chosen: ReadonlySet<number>;
}

/** What the DOM walk recorded for `raw`'s backing element, if it saw one. */
function enrichmentOf(
  raw: RawAXNode,
  enrichment: ReadonlyMap<number, NativeDomInfo>,
): NativeDomInfo | undefined {
  return typeof raw.backendDOMNodeId === "number"
    ? enrichment.get(raw.backendDOMNodeId)
    : undefined;
}

/** Whether the element's own markup says it holds a credential or payment value. */
function markupIsSensitive(enriched: NativeDomInfo): boolean {
  return isSensitiveFieldAttributes(enriched.tagName, {
    type: enriched.attributes.type,
    autocomplete: enriched.attributes.autocomplete,
  });
}

/** The nodes that are sensitive fields by their markup, mask or lack of one. */
function sensitiveFieldIds(
  rawNodes: RawAXNode[],
  enrichment: ReadonlyMap<number, NativeDomInfo>,
): Set<string> {
  const fields = new Set<string>();
  for (const raw of rawNodes) {
    const enriched = enrichmentOf(raw, enrichment);
    if (
      holdsUnclassifiedValue(raw, enriched !== undefined) ||
      isNativePasswordMask(raw.value?.value) ||
      (enriched !== undefined && markupIsSensitive(enriched))
    ) {
      fields.add(raw.nodeId);
    }
  }
  return fields;
}

/**
 * Classify every node against the sensitivity policy — core's
 * {@link isSensitiveFieldAttributes}, over the tag and the `type` /
 * `autocomplete` attributes the DOM walk recorded. A field counts as sensitive
 * when its markup says so, when it holds Chromium's password mask, or when it
 * is DOM-backed, holds a value, and the DOM walk never saw it — a node the
 * page added between the two reads, or a caller that passed no enrichment:
 * unclassified is withheld, for its value and for every name built from it.
 *
 * A value is then withheld when its node IS such a field; is INSIDE one (a
 * `<input type="month" autocomplete="cc-exp">` exposes its month and year as
 * UA-shadow `spinbutton`s backed by a `<div>`: their own markup says nothing,
 * their ancestor says everything); or CONTAINS one (an editor or ARIA combobox
 * around a credential field may build its value from it).
 *
 * A field the tree has no node of its own for (a disabled one with
 * `role="none"`) is classified by its own markup all the same, and withholds
 * through what stands in for it there, its inner box or its parts (core's
 * `fieldStandIns`). One the DOM walk can't name is unclassified.
 */
function fieldSensitivity(
  rawNodes: RawAXNode[],
  index: NativeAXIndex,
  enrichment: ReadonlyMap<number, NativeDomInfo>,
  standIns: readonly FieldStandIn[],
): FieldSensitivity {
  const fields = sensitiveFieldIds(rawNodes, enrichment);
  const sensitiveFields: ReadonlySet<string> = new Set(fields);
  // Only a field that can give its value away withholds names around it: an
  // empty one has nothing to give (see givesValueAway, which counts an ignored
  // field, whose value Chromium never sends, as able to).
  for (const id of fields) {
    const field = index.byId.get(id);
    if (!field || !givesValueAway(field, index.byId)) fields.delete(id);
  }
  // Stand-ins only come back when they give the field's value away.
  for (const { host, nodeIds, masked } of standIns) {
    const enriched = host === undefined ? undefined : enrichment.get(host);
    if (masked || enriched === undefined || markupIsSensitive(enriched)) {
      for (const id of nodeIds) fields.add(id);
    }
  }
  const regions = valueRegions(index, fields, standIns, labelsIn(enrichment));
  const choiceTargets = new Set<number>();
  const chosen = new Set<number>();
  for (const [id, info] of enrichment) {
    if (info.choiceTarget) choiceTargets.add(id);
    if (info.chosen) chosen.add(id);
  }
  return {
    regions,
    sensitiveFields,
    choiceReach: sensitiveChoiceReach(index, sensitiveFields, choiceTargets),
    choiceTargets,
    chosen,
    withholdsValue: (raw) =>
      regions.inside(raw) ||
      regions.containing.has(raw.nodeId) ||
      (typeof raw.backendDOMNodeId === "number" &&
        !enrichment.has(raw.backendDOMNodeId)),
  };
}

// ── Assembly ────────────────────────────────────────────────────────────────

/**
 * Every name-level redaction, applied to the raw nodes before core normalizes
 * them — the only point at which a name still says which node it came from.
 * Sensitive fields always ({@link withholdRegionNames} over
 * {@link fieldSensitivity}), and the choice made in one's popup (core's
 * `withholdPopupChoiceNames`: names only, so a field in a panel the field controls
 * keeps its own value); in strict mode, every field value and all editor
 * content too ({@link withholdRegionNames} over {@link strictValueRoots}, then
 * {@link redactEditableContent}). And always, the text a form control draws
 * inside itself, which the DOM walk marks (`fieldHost`; core's
 * `withholdFieldInternals`).
 */
export function prepareRawNodes(
  rawNodesAsRead: RawAXNode[],
  enrichment: ReadonlyMap<number, NativeDomInfo>,
  options: NativeTreeOptions,
): {
  nodes: RawAXNode[];
  sensitivity: FieldSensitivity;
  insideEditor: Set<RawAXNode>;
} {
  // First: it needs the name trace, which strict mode's passes drop.
  const rawNodes = dropBuiltInFileInputNames(rawNodesAsRead);
  const index = indexNativeAX(rawNodes);
  // A node the DOM walk never saw is `undefined`: see core's FieldHostOf.
  const hostOf: FieldHostOf = (backendDOMNodeId) => {
    const info = enrichment.get(backendDOMNodeId);
    return info === undefined ? undefined : (info.fieldHost ?? null);
  };
  // Read before any text is blanked: a stand-in counts by what it holds.
  const standIns = fieldStandIns(index, hostOf);
  const sensitivity = fieldSensitivity(rawNodes, index, enrichment, standIns);
  const named = withholdPopupChoiceNames(
    withholdRegionNames(rawNodes, sensitivity.regions),
    index,
    [...sensitivity.sensitiveFields],
    {
      labelsOf: labelsIn(enrichment),
      choiceTargets: sensitivity.choiceTargets,
      chosen: sensitivity.chosen,
    },
  );
  // Last: it blanks text runs only, which no step above keeps by identity.
  if (options.redactInput !== true) {
    return {
      nodes: withholdFieldInternals(named, hostOf),
      sensitivity,
      insideEditor: new Set(),
    };
  }
  // A button's internals hold its label, the page's, not what a user entered.
  const entered = standIns.filter(({ host }) => {
    const info = host === undefined ? undefined : enrichment.get(host);
    return !info || holdsEnteredValue(info.tagName, info.attributes.type);
  });
  const roots = strictValueRoots(rawNodes, index, entered);
  const strict = withholdRegionNames(
    named,
    valueRegions(index, roots, entered, labelsIn(enrichment)),
  );
  const { nodes, inside } = redactEditableContent(strict);
  return {
    nodes: withholdFieldInternals(nodes, hostOf),
    sensitivity,
    insideEditor: inside,
  };
}
