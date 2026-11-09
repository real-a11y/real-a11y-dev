/**
 * What changed in Chrome's tree between two reads of the same page, by the
 * ui package's diff (`tree-changes-diff.ts`) and Chrome's tree's own rules:
 * what differs on a row, and which ids last. `compareRead`
 * (`use-native-changes.ts`) decides which two trees to compare, and
 * `NativeTreeView.tsx` marks the result on the tree.
 *
 * Two reads of one document name an element the same way: a node's id is
 * built from its element's backend node id (`ax-dom-<n>`), which lasts as
 * long as the element does. A node with no element of its own, such as text
 * a stylesheet generates, is named by its AX node id instead (`ax-<n>`),
 * which Chromium hands out afresh whenever it builds the page's
 * accessibility tree again, as it may between two reads. Such a node is never
 * compared, and is new or gone only as part of a subtree that is.
 */

import { splitNativeNodeId } from "@real-a11y-dev/core";
import {
  diffTreeRows,
  noteFieldChange,
  type DialogRules,
  type FieldChange,
  type TreeChanges,
} from "@real-a11y-dev/semantic-navigator-ui";

import type { NativeNode } from "./native-actions.js";

/**
 * Whether a later read names this node the same way: true for an id built
 * from an element's backend node id, false for one built from an AX node id
 * (see the file header). Anything else, such as a test's own ids, counts as
 * lasting.
 */
export function isLastingNativeId(id: string): boolean {
  const { localId } = splitNativeNodeId(id);
  return !localId.startsWith("ax-") || localId.startsWith("ax-dom-");
}

/** A text the row shows only when it has some: an empty one is none. */
function shownText(text: string | undefined): string | undefined {
  return text === "" ? undefined : text;
}

/** A state as the row's badges show it: an `expanded` of false reads
 *  "collapsed", but any other state that is off shows no badge, as if it
 *  were absent. */
function shownState(
  key: string,
  value: string | boolean | undefined,
): string | boolean | undefined {
  return value === false && key !== "expanded" ? undefined : value;
}

/** Each key once, `a`'s first. */
function keysOf(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): string[] {
  return [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])];
}

/** The rows `node` controls, as one comparable value. */
function controlsOf(node: NativeNode): string | undefined {
  return node.controls && node.controls.length > 0
    ? [...node.controls].sort().join(" ")
    : undefined;
}

/**
 * What differs between two reads of one row, as the row shows it. Focus is
 * left out: it moves on every click, and the panel follows it on its own.
 * So is what the row never shows, such as the raw value a retype starts
 * from, or the numbers Focus sync gives it.
 */
export function compareNativeNodes(
  before: NativeNode,
  after: NativeNode,
): FieldChange[] {
  const changes: FieldChange[] = [];
  const add = (
    field: string,
    from: string | boolean | undefined,
    to: string | boolean | undefined,
  ) => noteFieldChange(changes, field, from, to);
  add("role", before.role, after.role);
  add("name", shownText(before.name), shownText(after.name));
  add(
    "description",
    shownText(before.description),
    shownText(after.description),
  );
  // An empty value shows (`= ""`), unlike an empty name.
  add("value", before.value, after.value);
  add(
    "placeholder",
    shownText(before.placeholder),
    shownText(after.placeholder),
  );
  for (const key of keysOf(after.states, before.states)) {
    if (key === "focused") continue;
    add(
      `states.${key}`,
      shownState(key, before.states?.[key]),
      shownState(key, after.states?.[key]),
    );
  }
  for (const key of keysOf(after.properties, before.properties)) {
    add(`properties.${key}`, before.properties?.[key], after.properties?.[key]);
  }
  add("controls", controlsOf(before), controlsOf(after));
  return changes;
}

/** Chrome's tree's rows, for the ui package's diff and its dialogs. */
export const NATIVE_TREE_RULES: DialogRules<NativeNode> = {
  compare: compareNativeNodes,
  lasting: isLastingNativeId,
  label: (node) => ({ role: node.role, name: node.name }),
  role: (node) => node.role,
};

/**
 * What changed between `before` and `after`, two reads of one document:
 * `after` drawn from `rootId`, and `before` from `beforeRootId`, the same
 * root unless the document's root moved between them (see `rootIdOf`). A
 * node that moved is neither new nor gone: it is the same element, and only
 * what it shows is compared.
 */
export function diffNativeTrees(
  before: ReadonlyMap<string, NativeNode>,
  after: ReadonlyMap<string, NativeNode>,
  rootId: string,
  beforeRootId = rootId,
): TreeChanges {
  return diffTreeRows(
    { nodes: before, rootId: beforeRootId },
    { nodes: after, rootId },
    NATIVE_TREE_RULES,
  );
}
