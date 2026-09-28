/**
 * The breadcrumb bar shown while a tree is scoped to a subtree, shared by
 * both producers' trees so scoping looks and behaves the same in each: ✕
 * leaves the scope, an ancestor crumb re-scopes to it, and the root crumb
 * leaves the scope just as ✕ does.
 */

export interface ScopeCrumb {
  id: string;
  label: string;
}

interface ScopeBarProps {
  /** Root first, the scoped node last. */
  path: ScopeCrumb[];
  /** The tree's own root: its crumb means "no scope", not "scope to root". */
  rootId: string;
  onScope: (id: string | null) => void;
}

export function ScopeBar({ path, rootId, onScope }: ScopeBarProps) {
  const currentId = path[path.length - 1]?.id;
  return (
    <div class="sn-scope-bar">
      <button
        class="sn-scope-exit"
        onClick={() => onScope(null)}
        title="Exit scope — show full tree (Escape)"
        aria-label="Exit scope"
      >
        {"✕"}
      </button>
      <nav class="sn-breadcrumb" aria-label="Scope path">
        {path.map((item, i) => (
          <span key={item.id} class="sn-breadcrumb-segment">
            {i > 0 && <span class="sn-breadcrumb-sep">{"›"}</span>}
            <button
              class={`sn-breadcrumb-item${item.id === currentId ? " sn-breadcrumb-item--current" : ""}`}
              onClick={() => {
                if (item.id === currentId) return;
                onScope(item.id === rootId ? null : item.id);
              }}
              aria-current={item.id === currentId ? "location" : undefined}
            >
              {item.label}
            </button>
          </span>
        ))}
      </nav>
    </div>
  );
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
 * Where focus goes when the scope bar's ✕ (or root crumb) removes the button
 * that held it: the tree if it's showing, otherwise the listbox a role filter
 * or the Tab view shows in its place — never `<body>`.
 */
export function focusActiveView(tree: HTMLElement | null): void {
  (tree ?? document.querySelector<HTMLElement>(".sn-filtered-list"))?.focus();
}

/**
 * The keyboard half of scoping, shared by both trees' keydown handlers.
 * `Ctrl`/`Cmd`+`Enter` scopes to the selected row (`Shift+Enter` is already a
 * slider's decrement); `Escape` leaves the scope, unless a pick is armed, in
 * which case Escape belongs to cancelling the pick.
 */
export function scopeKeyAction(
  e: KeyboardEvent,
  { scoped, pickArmed }: { scoped: boolean; pickArmed: boolean },
): "scope" | "exit" | null {
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
