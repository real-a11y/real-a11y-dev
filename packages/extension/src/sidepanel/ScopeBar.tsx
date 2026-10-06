/**
 * The breadcrumb bar shown while a tree is scoped to a subtree, shared by
 * both producers' trees so scoping looks and behaves the same in each: ✕
 * leaves the scope, an ancestor crumb re-scopes to it, and the root crumb
 * leaves the scope just as ✕ does. The scoping logic itself is in `scope.ts`.
 */

import type { ScopeCrumb } from "./scope.js";

interface ScopeBarProps {
  /** Root first, the scoped node last. */
  path: ScopeCrumb[];
  /** The tree's own root: its crumb means "no scope", not "scope to root". */
  rootId: string;
  onScope: (id: string | null) => void;
  /**
   * Where focus goes after leaving the scope (✕ or the root crumb), which
   * unmounts the button that held it: whichever view is showing — the tree,
   * or the list a role filter or the Tab view shows in its place. Read at
   * click time, never `<body>`.
   */
  focusAfterExit?: () => HTMLElement | null;
}

export function ScopeBar({
  path,
  rootId,
  onScope,
  focusAfterExit,
}: ScopeBarProps) {
  const currentId = path[path.length - 1]?.id;
  const exit = () => {
    onScope(null);
    focusAfterExit?.()?.focus();
  };
  return (
    <div class="sn-scope-bar">
      <button
        class="sn-scope-exit"
        onClick={exit}
        title="Exit scope — show full tree (Escape)"
        aria-label="Exit scope"
      >
        {"✕"}
      </button>
      <nav class="sn-breadcrumb" aria-label="Scope path">
        {path.map((item, i) => (
          <span key={item.id} class="sn-breadcrumb-segment">
            {i > 0 && (
              <span class="sn-breadcrumb-sep" aria-hidden="true">
                {"›"}
              </span>
            )}
            <button
              class={`sn-breadcrumb-item${item.id === currentId ? " sn-breadcrumb-item--current" : ""}`}
              onClick={() => {
                if (item.id === currentId) return;
                if (item.id === rootId) exit();
                else onScope(item.id);
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
