/**
 * Subtree scoping, shared by both producers' trees and the lists that follow
 * them. `ScopeBar.tsx` renders the breadcrumb; everything that decides what a
 * scope contains, what a key does to it and how a scoped node reads lives
 * here, so the DOM tree (`App.tsx`) and the native one (`NativeTreeView.tsx`)
 * can't drift apart on it.
 */

export interface ScopeCrumb {
  id: string;
  label: string;
}

/**
 * Both trees' accessible-name suffix for the scope key, so a screen-reader
 * user hears the same shortcut in either one. `scopeKeyAction` accepts Ctrl
 * and Cmd alike.
 */
export const SCOPE_KEY_HINT = "Ctrl or Cmd+Enter to scope to a row";

/** How a scoped node reads in the breadcrumb, the announcement and the
 *  export's `Scope:` line: `role "name"`, or just the role when unnamed. */
export function describeNode(role: string, name: string | undefined): string {
  return name ? `${role} "${name}"` : role;
}

/** The search box's match count, saying when it covers only the scope. */
export function matchCountLabel(count: number, scoped: boolean): string {
  return `${count} match${count !== 1 ? "es" : ""}${scoped ? " in this scope" : ""}`;
}

/** Whether a row has children to scope into. */
export function hasChildren(
  node: { childIds?: string[] } | undefined,
): boolean {
  return (node?.childIds?.length ?? 0) > 0;
}

/**
 * ArrowLeft on the scope root, when there is nothing to collapse, would
 * select its parent — a row the scoped tree doesn't render, leaving no row
 * selected and every key after it dead. Both trees stop there instead.
 */
export function arrowLeftStopsAtScopeRoot(
  selectedId: string | null,
  scopeRootId: string | null,
  isOpen: boolean,
): boolean {
  return scopeRootId !== null && selectedId === scopeRootId && !isOpen;
}

/**
 * Crumbs from `rootId` down to `scopeId`, walking `parentOf`. Stops at the
 * first id it can't label, so a half-loaded tree gives a short path rather
 * than a crumb with no text.
 */
export function scopePath(
  scopeId: string,
  parentOf: (id: string) => string | null | undefined,
  labelOf: (id: string) => string | undefined,
): ScopeCrumb[] {
  const path: ScopeCrumb[] = [];
  for (let id: string | null | undefined = scopeId; id; id = parentOf(id)) {
    const label = labelOf(id);
    if (label === undefined) break;
    path.unshift({ id, label });
  }
  return path;
}

/**
 * Whether `id` is `scopeId` itself or one of its descendants. A reveal that
 * lands outside the scope (a pick, a focus sync, a jump chip) has to
 * leave the scope first, or it selects a row the scoped tree never renders.
 */
export function isInScope(
  id: string,
  scopeId: string,
  parentOf: (id: string) => string | null | undefined,
): boolean {
  for (let cur: string | null | undefined = id; cur; cur = parentOf(cur)) {
    if (cur === scopeId) return true;
  }
  return false;
}

/**
 * The scoped subtree as its own map: `rootId` and everything under it. Lets
 * a whole-tree helper (the DOM search filter's match count) run over just the
 * scope without a scope-aware variant of its own.
 */
export function subtreeNodes<T extends { childIds?: string[] }>(
  nodes: Map<string, T>,
  rootId: string,
): Map<string, T> {
  const out = new Map<string, T>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    const node = nodes.get(id);
    if (!node || out.has(id)) continue;
    out.set(id, node);
    for (const childId of node.childIds ?? []) stack.push(childId);
  }
  return out;
}

export type ScopeAction = "scope" | "exit";

/**
 * The keyboard half of scoping, shared by both trees' keydown handlers and
 * the lists'. `Ctrl`/`Cmd`+`Enter` scopes to the selected row (`Shift+Enter`
 * is already a slider's decrement); `Escape` leaves the scope, unless a pick
 * is armed, in which case Escape belongs to cancelling the pick.
 */
export function scopeKeyAction(
  e: KeyboardEvent,
  { scoped, pickArmed }: { scoped: boolean; pickArmed: boolean },
): ScopeAction | null {
  if (
    e.key === "Enter" &&
    (e.ctrlKey || e.metaKey) &&
    !e.shiftKey &&
    !e.altKey
  ) {
    return "scope";
  }
  if (
    e.key === "Escape" &&
    scoped &&
    !pickArmed &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    !e.shiftKey
  ) {
    return "exit";
  }
  return null;
}

/**
 * A list's share of the scope keys (a role filter's list, the Tab view),
 * which show a scoped subtree as flat items. `Escape` leaves the scope, as
 * in the tree. `Ctrl`/`Cmd`+`Enter` is consumed and does nothing: a list item
 * isn't a container to scope into, and letting the key fall through to plain
 * Enter would activate the item on the page by surprise. Returns whether the
 * key was handled.
 */
export function handleListScopeKey(
  e: KeyboardEvent,
  {
    scoped,
    pickArmed = false,
    onExitScope,
  }: { scoped: boolean; pickArmed?: boolean; onExitScope?: () => void },
): boolean {
  const action = scopeKeyAction(e, {
    scoped: scoped && onExitScope !== undefined,
    pickArmed,
  });
  if (!action) return false;
  e.preventDefault();
  if (action === "exit") onExitScope!();
  return true;
}
