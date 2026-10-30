/**
 * What a row of Chrome's tree (`NativeTreeView.tsx`) offers: its action
 * button's label, its actions in the shared filtered list's vocabulary, and
 * what type-ahead matches it by. Pure, over the native read's nodes.
 */

import type { ActionType } from "@real-a11y-dev/core";

import type { TabCapability } from "../native/capability.js";
import {
  ACTABLE,
  isSteppableRole,
  isTypableRole,
  nativeSelectOptions,
  type NativeNode,
} from "../native/native-actions.js";

import { describeStates, type FilteredListItem } from "./FilteredList.js";

/** A node is worth a click/Enter action, a select action, or both never — the
 *  same three-way split `DogfoodPanel.tsx` renders from, reused here so a
 *  fix to one never silently diverges from the other. `selects` says the row
 *  selects: an option, or a real `<select>`, which opens the option picker
 *  as the DOM tree's does (see `nativeSelectIds`). */
export function primaryLabel(
  node: NativeNode,
  selects: boolean,
): string | undefined {
  if (isTypableRole(node.role, node.states)) return "Type";
  if (selects) return "Select";
  if (ACTABLE.has(node.role)) return "Click";
  return undefined;
}

/** The ids of the rows backed by a real `<select>`, with option rows to pick
 *  from. Worked out once per tree read rather than per row and key press. */
export function nativeSelectIds(nodes: Map<string, NativeNode>): Set<string> {
  const ids = new Set<string>();
  for (const node of nodes.values()) {
    if (nativeSelectOptions(node, nodes).length > 0) ids.add(node.id);
  }
  return ids;
}

/** What a native row can do, in `interaction.actions`' vocabulary, so the
 *  shared filtered list can decide Enter/Activate and the stepper keys the
 *  same way it does for a DOM row. Mirrors `primaryLabel`'s precedence. */
export function nativeActions(
  node: NativeNode,
  selects: boolean,
): ActionType[] {
  const actions: ActionType[] = [];
  if (isTypableRole(node.role, node.states)) actions.push("type");
  else if (selects) actions.push("select");
  else if (ACTABLE.has(node.role)) actions.push("click");
  if (isSteppableRole(node.role)) actions.push("increment", "decrement");
  return actions;
}

export function toListItem(
  node: NativeNode,
  selects: boolean,
): FilteredListItem {
  const level = parseInt(node.properties?.["level"] ?? "", 10);
  return {
    id: node.id,
    label: node.name || `(${node.role})`,
    level: Number.isNaN(level) ? undefined : level,
    states: describeStates(node.states),
    actions: nativeActions(node, selects),
  };
}

/** What type-ahead matches a row by — its name, else its role — the same
 *  fallback `useTreeKeyboard`'s `treeNodeTypeAheadLabel` uses for a DOM row
 *  (a native node has no text content of its own to fall between them). */
export function typeAheadLabel(node: NativeNode): string {
  return node.name?.trim() || node.role;
}

/** What the tree says in place of rows when it shows none. */
export function emptyTreeText(
  capability: TabCapability | undefined,
  nodeCount: number,
  hasFilter: boolean,
  query: string,
): string {
  if (capability && !capability.native)
    return "Native unavailable on this page";
  if (nodeCount === 0) return "No native tree loaded yet — hit refresh";
  if (hasFilter) return `No matches${query ? ` for "${query}"` : ""}`;
  return "Empty tree";
}
