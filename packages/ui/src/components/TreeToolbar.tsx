import type { TreeViewMode, RoleFilter } from "@real-a11y-dev/core";
import { ROLE_FILTER_LABELS } from "@real-a11y-dev/core";

interface TreeToolbarProps {
  viewMode: TreeViewMode;
  onViewModeChange: (mode: TreeViewMode) => void;
  query: string;
  onQueryChange: (query: string) => void;
  matchCount: number;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  roleFilter: RoleFilter;
  onRoleFilterChange: (filter: RoleFilter) => void;
  /** When true, render the DevTools-style "select an element in the page" button. */
  enablePicker?: boolean;
  /** Current picker state — drives aria-pressed on the button. */
  pickModeOn?: boolean;
  /** Called when the user clicks the picker button. */
  onTogglePickMode?: () => void;
  /** When true, render the checkpoint button that drives diff highlighting. */
  enableDiff?: boolean;
  /** True while a baseline is captured — drives aria-pressed. */
  diffActive?: boolean;
  /** Called when the user clicks the checkpoint button (capture / clear). */
  onToggleDiff?: () => void;
}

export function TreeToolbar({
  viewMode,
  onViewModeChange,
  query,
  onQueryChange,
  matchCount,
  onExpandAll,
  onCollapseAll,
  roleFilter,
  onRoleFilterChange,
  enablePicker = false,
  pickModeOn = false,
  onTogglePickMode,
  enableDiff = false,
  diffActive = false,
  onToggleDiff,
}: TreeToolbarProps) {
  return (
    <>
      <div class="sn-toolbar" role="toolbar" aria-label="Tree controls">
        {/* DevTools-style picker: "select an element in the page". The
            actual click capture + cursor swap live in createPicker (in
            @real-a11y-dev/core). Same .sn-pick-btn class as the
            extension uses, so it picks up the shared toolbar style. */}
        {enablePicker && (
          <button
            class="sn-pick-btn"
            aria-pressed={pickModeOn}
            onClick={() => onTogglePickMode?.()}
            title={
              pickModeOn
                ? "Pick mode ON — click an element in the page to select it in the tree (Esc to cancel)"
                : "Pick an element in the page (Ctrl/Cmd+Shift+C)"
            }
            aria-label="Pick element in page"
          >
            {"⦿"}
          </button>
        )}

        {/* Checkpoint the tree, then interact: rows that appeared or changed
            since are marked in place. Toggling off clears the baseline.
            Its own class, not .sn-pick-btn — that selector is how the
            extension and tests reach the *picker* specifically; the two
            only share a look, which tree.css grants by grouping them. */}
        {enableDiff && (
          <button
            class="sn-checkpoint-btn"
            aria-pressed={diffActive}
            onClick={() => onToggleDiff?.()}
            title={
              diffActive
                ? "Checkpoint active — added and changed nodes are marked. Click to clear."
                : "Checkpoint the tree, then interact to see what changed"
            }
            aria-label="Checkpoint tree for diff"
          >
            {"⎌"}
          </button>
        )}

        {/* Search */}
        <input
          class="sn-search"
          type="search"
          placeholder="Search nodes..."
          aria-label="Search tree nodes"
          value={query}
          onInput={(e) => onQueryChange((e.target as HTMLInputElement).value)}
        />
        {(query || roleFilter) && (
          <span class="sn-search-count" aria-live="polite">
            {matchCount} match{matchCount !== 1 ? "es" : ""}
          </span>
        )}

        {/* View mode toggle */}
        <div class="sn-toggle-group" role="group" aria-label="Tree view mode">
          <button
            class="sn-toggle-btn"
            aria-pressed={viewMode === "dom"}
            onClick={() => onViewModeChange("dom")}
          >
            DOM
          </button>
          <button
            class="sn-toggle-btn"
            aria-pressed={viewMode === "a11y"}
            onClick={() => onViewModeChange("a11y")}
          >
            A11Y
          </button>
          <button
            class="sn-toggle-btn"
            aria-pressed={viewMode === "tab"}
            onClick={() => onViewModeChange("tab")}
          >
            TAB
          </button>
        </div>

        {/* Expand/Collapse — disabled in tab sequence view (flat list, no nesting) */}
        <button
          class="sn-toolbar-btn"
          onClick={onExpandAll}
          disabled={viewMode === "tab"}
          aria-label="Expand all nodes"
          title="Expand all"
        >
          +
        </button>
        <button
          class="sn-toolbar-btn"
          onClick={onCollapseAll}
          disabled={viewMode === "tab"}
          aria-label="Collapse all nodes"
          title="Collapse all"
        >
          -
        </button>
      </div>

      {/* Role filters — disabled in tab sequence view */}
      <div class="sn-filters" role="toolbar" aria-label="Filter by role">
        {(
          Object.keys(ROLE_FILTER_LABELS) as Array<Exclude<RoleFilter, null>>
        ).map((key) => (
          <button
            key={key}
            class="sn-filter-btn"
            aria-pressed={roleFilter === key}
            disabled={viewMode === "tab"}
            onClick={() => onRoleFilterChange(roleFilter === key ? null : key)}
          >
            {ROLE_FILTER_LABELS[key]}
          </button>
        ))}
      </div>
    </>
  );
}
