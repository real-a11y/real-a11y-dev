/**
 * What CDP's DOM agent says of form fields, for the native read, split out of
 * `native-core.ts`: the fields inside an element ({@link fieldsWithin}),
 * whether a field's markup says it is sensitive ({@link isSensitiveMarkup}),
 * and one walk of a session's documents for what Chromium's tree can't say
 * of them ({@link fieldWalks}).
 */

import {
  domChoiceReads,
  domLabels,
  isSensitiveFieldAttributes,
  opensFieldInternals,
  type LabelsOf,
} from "@real-a11y-dev/core";

import type { CdpTransport } from "./native-core.js";
import type { CdpDomNode } from "./page-keys.js";

/** CDP's `DOM.Node`, as far as {@link fieldsWithin} reads it. */
interface DescribedNode {
  backendNodeId: number;
  localName?: string;
  shadowRootType?: string;
  children?: DescribedNode[];
  shadowRoots?: DescribedNode[];
}

const FIELD_TAGS = new Set(["input", "textarea", "select"]);

/**
 * The backend ids of the `<input>`, `<textarea>` and `<select>` elements at or
 * inside element `backendNodeId`, from CDP's DOM agent — through author shadow
 * roots, whose content names things too, but not into a field's own
 * user-agent internals or a frame's document. `undefined` when the agent
 * can't describe it.
 */
export async function fieldsWithin(
  transport: CdpTransport,
  backendNodeId: number,
): Promise<number[] | undefined> {
  try {
    const { node } = await transport.send<{ node: DescribedNode }>(
      "DOM.describeNode",
      { backendNodeId, depth: -1, pierce: true },
    );
    const fields: number[] = [];
    const stack = [node];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (FIELD_TAGS.has(cur.localName ?? "")) fields.push(cur.backendNodeId);
      stack.push(...(cur.children ?? []));
      for (const root of cur.shadowRoots ?? []) {
        if (root.shadowRootType !== "user-agent") stack.push(root);
      }
    }
    return fields;
  } catch {
    return undefined;
  }
}

/** A field whose markup says it is sensitive (core's
 *  `isSensitiveFieldAttributes`), as `DOM.getDocument` describes it. Any
 *  `type` or `autocomplete` attribute counts: a namespaced one reads the same
 *  name, and the first need not be the one the field goes by. */
export function isSensitiveMarkup(node: CdpDomNode): boolean {
  const tag = node.localName ?? "";
  if (!FIELD_TAGS.has(tag)) return false;
  const attributes = node.attributes ?? [];
  for (let i = 0; i + 1 < attributes.length; i += 2) {
    const name = attributes[i];
    const value = attributes[i + 1];
    if (
      (name === "type" && isSensitiveFieldAttributes(tag, { type: value })) ||
      (name === "autocomplete" &&
        isSensitiveFieldAttributes(tag, { autocomplete: value }))
    ) {
      return true;
    }
  }
  return false;
}

/** What a walk of a session's documents found, by backend id: every DOM node
 *  it saw, for each in a form control's own internals that control, every
 *  field whose markup says it is sensitive, every node one sits in, and each
 *  form control's labels. */
export interface FieldInternals {
  seen: ReadonlySet<number>;
  hosts: ReadonlyMap<number, number>;
  sensitive: ReadonlySet<number>;
  /**
   * Every node a sensitive field sits inside as Chromium lays the page out:
   * through shadow roots, open or closed, and what a `<slot>` shows, but
   * never out of a frame's document. A field below a hidden wrapper has no
   * node in Chromium's tree at all, so only the document places it.
   */
  holdsSensitive: ReadonlySet<number>;
  /**
   * Each form control's `<label>`s (core's `domLabels`). Chromium's tree has
   * no trace of them for a hidden control, yet an `aria-labelledby` pointing
   * at one still reads them, and a sensitive field's value in one with them
   * (core's `valueRegions`).
   */
  labelsOf: LabelsOf;
  /**
   * Where a sensitive field's choice is made by a relation Chromium's tree
   * drops (core's `domChoiceTargets`): what such a field, or a combobox
   * around one, names in `aria-controls` / `aria-owns` when Chromium leaves
   * that element out, as a `role="presentation"` wrapper around the listbox.
   */
  choiceTargets: ReadonlySet<number>;
  /**
   * What marks itself chosen where Chromium's tree doesn't say (core's
   * `domChoiceReads`): `aria-current`, or `aria-pressed` on a role with no
   * pressed state.
   */
  chosen: ReadonlySet<number>;
}

/** The documents `transport` reads, whole, or `undefined` when the DOM agent
 *  can't list them. */
async function readDocumentTree(
  transport: CdpTransport,
): Promise<CdpDomNode | undefined> {
  try {
    await transport.send("DOM.enable");
    return (
      await transport.send<{ root?: CdpDomNode }>("DOM.getDocument", {
        depth: -1,
        pierce: true,
      })
    ).root;
  } catch {
    return undefined;
  }
}

/** `node`'s backend id when `sub`, a shadow root of it, is a form control's
 *  own internals (core's `opensFieldInternals`). */
function internalsHost(node: CdpDomNode, sub: CdpDomNode): number | undefined {
  return opensFieldInternals(node.localName, sub.shadowRootType)
    ? node.backendNodeId
    : undefined;
}

/** Up from each of `fields`, through everything it sits in (`parentOf`, and
 *  the slot that shows it, `slotOf`), climbing from each node once. */
function elementsHolding(
  fields: ReadonlySet<number>,
  parentOf: ReadonlyMap<number, number>,
  slotOf: ReadonlyMap<number, number>,
): Set<number> {
  const holding = new Set<number>();
  const up: number[] = [];
  const climb = (id: number) => {
    const parent = parentOf.get(id);
    if (parent !== undefined) up.push(parent);
    const slot = slotOf.get(id);
    if (slot !== undefined) up.push(slot);
  };
  for (const id of fields) climb(id);
  while (up.length > 0) {
    const id = up.pop()!;
    if (holding.has(id)) continue;
    holding.add(id);
    climb(id);
  }
  return holding;
}

/**
 * Walk the documents `transport` reads for the DOM nodes in a form control's
 * own internals: the user-agent shadow root of an `<input>`, `<textarea>` or
 * `<select>` (core's `opensFieldInternals`), where it draws what it holds.
 * Core's `withholdFieldInternalText` keeps their text out of the tree, since
 * nothing in the AX tree tells such a node from a `<div>`, and when the tree
 * has no node of the control's own, `fieldStandIns` finds what stands in for
 * it. The same walk finds every sensitive field by its markup, and every
 * element one sits in (`holdsSensitive`), which the in-page read can't see
 * past a shadow root. One walk serves the session's top document and every
 * frame it reads in the same renderer, which `DOM.getDocument` lists under
 * its `<iframe>`. A node one of them added since is one the walk never saw:
 * its text fails closed, and so does a row of its own; a field added since
 * inside a node the walk saw counts from the next read. `undefined` when the
 * DOM agent can't list them: text fails closed throughout, and a field with
 * no row of its own is left to the in-page read's light-DOM look.
 */
async function fieldInternals(
  transport: CdpTransport,
): Promise<FieldInternals | undefined> {
  const root = await readDocumentTree(transport);
  if (!root) return undefined;
  const seen = new Set<number>();
  const hosts = new Map<number, number>();
  const sensitive = new Set<number>();
  // What each node sits in as Chromium lays it out: its parent, a shadow
  // root's host, and the `<slot>` that shows it. A frame's document sits in
  // nothing here: its fields are its own.
  const parentOf = new Map<number, number>();
  const slotOf = new Map<number, number>();
  // Each node, and the control whose internals hold it.
  const stack: Array<[CdpDomNode, number | undefined]> = [[root, undefined]];
  while (stack.length > 0) {
    const [node, host] = stack.pop()!;
    const id = node.backendNodeId;
    seen.add(id);
    if (isSensitiveMarkup(node)) sensitive.add(id);
    if (host !== undefined) hosts.set(id, host);
    // eslint-disable-next-line no-restricted-properties -- a field of CDP's plain object, not the element's: nothing on the page shadows it
    const slot = node.assignedSlot;
    if (slot) slotOf.set(id, slot.backendNodeId);
    for (const child of node.children ?? []) {
      if (child.nodeType === 1) parentOf.set(child.backendNodeId, id);
      stack.push([child, host]);
    }
    if (node.contentDocument) stack.push([node.contentDocument, undefined]);
    for (const sub of node.shadowRoots ?? []) {
      parentOf.set(sub.backendNodeId, id);
      stack.push([sub, host ?? internalsHost(node, sub)]);
    }
    // A `::before` or `::after` Chromium lays out as a box has a node of its
    // own in the tree, seen here like any other.
    for (const pseudo of node.pseudoElements ?? []) stack.push([pseudo, host]);
  }
  const holdsSensitive = elementsHolding(sensitive, parentOf, slotOf);
  const reads = domChoiceReads(root);
  return {
    seen,
    hosts,
    sensitive,
    holdsSensitive,
    labelsOf: domLabels(root),
    choiceTargets: reads.targets,
    chosen: reads.chosen,
  };
}

/** {@link fieldInternals}, walked once per session for the whole of a read. */
export function fieldWalks(): (
  transport: CdpTransport,
) => Promise<FieldInternals | undefined> {
  const walks = new Map<CdpTransport, Promise<FieldInternals | undefined>>();
  return (transport) => {
    let walk = walks.get(transport);
    if (walk === undefined) {
      walk = fieldInternals(transport);
      walks.set(transport, walk);
    }
    return walk;
  };
}
