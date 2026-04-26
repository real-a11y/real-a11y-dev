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
}: TreeToolbarProps) {
  return (
    <>
      <div class="sn-toolbar" role="toolbar" aria-label="Tree controls">
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
            onClick={() =>
              onRoleFilterChange(roleFilter === key ? null : key)
            }
          >
            {ROLE_FILTER_LABELS[key]}
          </button>
        ))}
      </div>
    </>
  );
}
