import type { TreeViewMode, RoleFilter } from "@real-a11y-dev/core";
import { ROLE_FILTER_LABELS } from "@real-a11y-dev/core";
import type { Ref } from "preact";
import { useCallback, useRef, useState } from "preact/hooks";

import { useDismissible } from "../hooks/useDismissible.js";
import { useInstanceId } from "../hooks/useInstanceId.js";

import { ShowFullNamesSetting } from "./ShowFullNamesSetting.js";

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
  /** Ref to the search input — used by the `/` keyboard shortcut. */
  searchInputRef?: Ref<HTMLInputElement>;
  /** Whether the tree shows names in full — drives the Settings checkbox. */
  showFullNames?: boolean;
  /**
   * Called when the Settings checkbox is turned on or off. Without it the
   * toolbar has no Settings: the switch it holds would change nothing.
   */
  onShowFullNamesChange?: (showFullNames: boolean) => void;
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
  searchInputRef,
  showFullNames = false,
  onShowFullNamesChange,
}: TreeToolbarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  useDismissible(settingsOpen, closeSettings, settingsRef, settingsButtonRef);
  // Per panel, since two panels can share a document (light-DOM mounts).
  const settingsId = `sn-settings-${useInstanceId("set")}`;

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
          ref={searchInputRef}
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

        {/* Settings. A disclosure, not a menu: what it opens is a switch and
            the line that explains it, as the extension's Settings does. A
            gear rather than the extension's "Settings ▾", which sits in a
            header: this toolbar has no room to spare beside the search. */}
        {onShowFullNamesChange && (
          <div class="sn-dropdown" ref={settingsRef}>
            <button
              ref={settingsButtonRef}
              class="sn-toolbar-btn sn-settings-btn"
              aria-expanded={settingsOpen}
              aria-controls={settingsOpen ? settingsId : undefined}
              aria-label="Settings"
              title="Settings"
              onClick={() => setSettingsOpen((open) => !open)}
            >
              {"⚙"}
            </button>
            {settingsOpen && (
              <div
                id={settingsId}
                class="sn-dropdown-popup sn-settings-menu"
                data-sn-popup
                role="group"
                aria-label="Settings"
              >
                <ShowFullNamesSetting
                  checked={showFullNames}
                  onChange={onShowFullNamesChange}
                  hintId={`${settingsId}-full-names-hint`}
                />
              </div>
            )}
          </div>
        )}
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
