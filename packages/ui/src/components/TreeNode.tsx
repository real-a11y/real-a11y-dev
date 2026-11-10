import type {
  ActionType,
  DomSemanticNode,
  TreeViewMode,
} from "@real-a11y-dev/core";
import { getPrimaryAction, ACTION_LABELS } from "@real-a11y-dev/core";

import { JUMP_KEYS } from "../hooks/jumpKeys.js";
import { treeRowDomId, useInstanceId } from "../hooks/useInstanceId.js";
import { isKeyState } from "../key-states.js";
import { shownDomAttributes } from "../semantic-tree-diff.js";
import {
  changeRowClass,
  marksForReaders,
  type Flash,
  type RowChangeMarks,
} from "../tree-changes.js";

import { KeyStatesForReaders } from "./KeyStatesForReaders.js";
import { RowChangeTags } from "./RowChangeTags.js";
import type { ControlsLink } from "./TreePanel.js";

interface TreeNodeProps {
  node: DomSemanticNode;
  viewMode: TreeViewMode;
  isSelected: boolean;
  /**
   * True for the row currently mid-flash after a cross-link jump landed on
   * it. Adds an `sn-node--flash` class that drives a brief background
   * animation.
   */
  isFlashing?: boolean;
  /**
   * Whether the row shows open. A read can open rows before they are open
   * on their nodes (`useTreeChanges`), so the panel says; `node.ui.expanded`
   * where it doesn't.
   */
  expanded?: boolean;
  /**
   * What the panel's change marks show on this row (`tree-changes.ts`):
   * the new or changed row's edge and tag, what changed on it underlined or
   * outlined, and what it stands in for under it. Left out while the panel
   * marks no changes.
   */
  changeMarks?: RowChangeMarks;
  /** The row's flash, while it has one. */
  changeFlash?: Flash;
  /** What the marks are compared with (`TreeChangesProp.since`). */
  changesSince?: string;
  /**
   * 1-based position of this row within its visible sibling group, and the
   * group's total size. Rendered as `aria-posinset`/`aria-setsize` so screen
   * readers can perceive the full set even though the list is virtualized and
   * offscreen sibling rows are absent from the DOM.
   */
  posinset?: number;
  setsize?: number;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  /**
   * Called when the row's action surface is invoked (button click). The
   * optional `action` overrides the primary-action lookup the panel does
   * by default — used by the slider/spinbutton ▲/▼ pair so each button
   * dispatches its own increment/decrement instead of the primary.
   */
  onActivate: (id: string, action?: ActionType) => void;
  onHover: (id: string | null) => void;
  /**
   * Cross-links rendered on the trigger row of a disclosure pair (this
   * node controls these elements). Pre-resolved by TreePanel.
   */
  controlsLinks?: ControlsLink[];
  /**
   * Cross-links rendered on the controlled-element row (these triggers
   * control this node). Pre-resolved by TreePanel.
   */
  controlledByLinks?: ControlsLink[];
  /** Called when the user clicks a cross-link chip. */
  onJumpToNode?: (id: string) => void;
  /**
   * Per-panel instance token. Prefixed onto the row's DOM id so two panels
   * mounted in the same document never collide — `aria-activedescendant` is a
   * document-wide IDREF. Optional: when omitted, a stable per-row-mount token
   * is generated so external `<TreeNode>` callers keep working without a new
   * required prop.
   */
  idPrefix?: string;
}

/** What changed on a row, by field (`FieldChange.field`). */
type Changed = ReadonlySet<string> | undefined;

/** The class that marks a part of the row as what changed: underlined, or
 *  outlined for a badge (tree-changes.css). */
function part(changed: Changed, field: string): string {
  return changed?.has(field) ? " sn-change-part" : "";
}

function renderDomLabel(node: DomSemanticNode, changed: Changed) {
  const { tagName, textContent } = node.dom;
  const displayAttrs = shownDomAttributes(node);

  return (
    <>
      <span class="sn-tag">
        {"<"}
        {tagName}
      </span>
      {/* A label the row is too narrow for ends in an ellipsis, so each
          part that can (see tree.css) carries its whole text as a tooltip. */}
      {displayAttrs.map((attr) => (
        <span
          key={attr.key}
          class={`sn-attr${part(changed, `attributes.${attr.key}`)}`}
          title={`${attr.key}="${attr.val}"`}
        >
          {" "}
          <span class="sn-attr-key">{attr.key}</span>
          {"="}
          <span class="sn-attr-val">"{attr.val}"</span>
        </span>
      ))}
      <span class="sn-tag">{">"}</span>
      {textContent && (
        <span
          class={`sn-text-content${part(changed, "text")}`}
          title={textContent}
        >
          {textContent}
        </span>
      )}
    </>
  );
}

function renderA11yLabel(
  node: DomSemanticNode,
  keyStates: Badge[],
  changed: Changed,
) {
  const { role, name } = node.a11y;
  const level = node.a11y.properties["level"];
  // Show a muted preview of descendant text only when the element is a
  // leaf in the a11y tree (no kept children) AND its text content isn't
  // already represented by the accessible name. The leaf gate prevents
  // duplication: if children survived as their own rows, their text is
  // already visible — repeating it at the parent (e.g. table/rowgroup
  // concatenating every cell, paragraph repeating its strong/em
  // children) is just noise. The leaf case covers the cases the preview
  // was designed for: `<code>` whose role=presentation token spans were
  // flattened, an `<svg>` containing `<text>`, decorative wrappers
  // around copy.
  const { descendantText } = node.dom;
  const isLeaf = node.childIds.length === 0;
  const showPreview =
    isLeaf && descendantText !== "" && descendantText !== name;

  return (
    <>
      {/* The role and name stay together on a narrow row, which clips the
          name and drops what follows it (tree.css, "Long labels"). Each part
          that can end in an ellipsis carries its whole text as a tooltip
          (see renderDomLabel). */}
      <span class="sn-head">
        <span class={`sn-role${part(changed, "role")}`}>{role}</span>
        {level && (
          <span class={`sn-text-muted${part(changed, "properties.level")}`}>
            {" "}
            level {level}
          </span>
        )}
        {name && (
          <span class={`sn-name${part(changed, "name")}`} title={name}>
            {name}
          </span>
        )}
        <KeyStatesForReaders labels={keyStates.map((b) => b.label)} />
      </span>
      {showPreview && (
        <span
          class={`sn-name-preview${part(changed, "text")}`}
          title={descendantText}
        >
          {descendantText}
        </span>
      )}
    </>
  );
}

interface Badge {
  label: string;
  className: string;
  /** The change that names it (`semantic-tree-diff.ts`). */
  field: string;
}

/** The interaction badges: what the element takes, a click or focus. */
function interactionBadges(node: DomSemanticNode): Badge[] {
  const badges: Badge[] = [];
  if (node.interaction.isInteractive) {
    badges.push({
      label: "interactive",
      className: "sn-badge--interactive",
      field: "states.interactive",
    });
  }
  if (node.interaction.isFocusable) {
    badges.push({
      label: "focusable",
      className: "sn-badge--interactive",
      field: "states.focusable",
    });
  }
  return badges;
}

/**
 * A row's state badges: all of them, or only its key states (`isKeyState`),
 * which the A11Y view shows after the label, where nothing clips them, or
 * only the rest.
 */
function stateBadges(
  node: DomSemanticNode,
  which: "all" | "key" | "rest",
): Badge[] {
  const badges: Badge[] = [];
  for (const [key, val] of Object.entries(node.a11y.states)) {
    if (which !== "all" && isKeyState(key) !== (which === "key")) continue;
    const field = `states.${key}`;
    if (val === true) {
      badges.push({ label: key, className: "sn-badge--state", field });
    } else if (val !== false && val !== "") {
      badges.push({
        label: `${key}=${val}`,
        className: "sn-badge--state",
        field,
      });
    }
  }
  return badges;
}

function renderBadges(
  badges: Badge[],
  {
    className = "sn-badges",
    hidden = false,
    changed,
  }: { className?: string; hidden?: boolean; changed?: Changed } = {},
) {
  if (badges.length === 0) return null;

  return (
    <span class={className} aria-hidden={hidden || undefined}>
      {badges.map((b) => (
        <span
          key={b.label}
          class={`sn-badge ${b.className}${part(changed, b.field)}`}
        >
          {b.label}
        </span>
      ))}
    </span>
  );
}

function renderControlsChip(
  link: ControlsLink,
  direction: "forward" | "reverse",
  onJumpToNode: (id: string) => void,
  /** The key that reaches this chip, if one does (see `nextJump`). */
  keys?: string,
) {
  const arrow = direction === "forward" ? "→ " : "← ";
  const reverseClass =
    direction === "reverse" ? " sn-controls-link--reverse" : "";
  const inferredClass = link.inferred ? " sn-controls-link--inferred" : "";
  const verb = direction === "forward" ? "controls" : "is controlled by";
  const what = link.inferred
    ? `Likely ${verb} ${link.label} (inferred from aria-haspopup; no aria-controls set)`
    : `Jump to ${link.label} — ${verb} this element`;
  const title = keys ? `${what} (${keys})` : what;
  return (
    <button
      key={`${direction}-${link.id}`}
      class={`sn-controls-link${reverseClass}${inferredClass}`}
      tabIndex={-1}
      onClick={(e) => {
        e.stopPropagation();
        onJumpToNode(link.id);
      }}
      title={title}
    >
      {arrow}
      {link.label}
    </button>
  );
}

export function TreeNode({
  node,
  viewMode,
  isSelected,
  isFlashing,
  expanded = node.ui.expanded,
  changeMarks,
  changeFlash,
  changesSince,
  posinset,
  setsize,
  onSelect,
  onToggle,
  onActivate,
  onHover,
  controlsLinks,
  controlledByLinks,
  onJumpToNode,
  idPrefix,
}: TreeNodeProps) {
  // Always call the hook (Rules of Hooks); prefer the caller's prefix when
  // TreePanel wires aria-activedescendant to the same token.
  const autoPrefix = useInstanceId("tn");
  const prefix = idPrefix ?? autoPrefix;

  const hasChildren = node.childIds.length > 0;
  // The A11Y view's key states, which it shows after the label and a screen
  // reader hears after the name; the DOM view shows them with the rest.
  const keyStates = viewMode === "dom" ? [] : stateBadges(node, "key");
  const actions = node.interaction.actions;
  // Slider / spinbutton rows surface a paired ▲/▼ control instead of a
  // single primary-action button — so users can step the value in either
  // direction (and the Screen Curtain still works because the panel
  // drives the keystroke end-to-end). When the pair is shown, suppress
  // the primary button to avoid duplicating "Increment" alongside ▲.
  const showStepPair =
    actions.includes("increment") && actions.includes("decrement");
  const primaryAction = showStepPair
    ? null
    : getPrimaryAction(node.interaction.actions);
  // What changed on the row, and what a screen reader hears of its marks,
  // last in its label (see `marksForReaders`).
  const changed =
    changeMarks?.changes && new Set(changeMarks.changes.map((c) => c.field));
  const said = changeMarks && marksForReaders(changeMarks);

  const classNames = [
    "sn-node",
    isSelected && "sn-node--selected",
    isFlashing && "sn-node--flash",
    changeMarks && changeRowClass(changeMarks, changeFlash),
    !node.ui.matchesFilter && "sn-node--filtered-out",
    node.dom.isHidden && "sn-node--hidden",
    node.interaction.isInteractive && "sn-node--interactive",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      // id is the aria-activedescendant target set on the role="tree" container.
      // Node ids are selector-/id-safe (`sn-<n>` / `f<n>-sn-<n>`); the per-panel
      // prefix keeps the id unique when two panels share a document.
      id={treeRowDomId(prefix, node.id)}
      class={classNames}
      role="treeitem"
      aria-expanded={hasChildren ? expanded : undefined}
      aria-selected={isSelected}
      aria-level={node.depth + 1}
      aria-posinset={posinset}
      aria-setsize={setsize}
      data-node-id={node.id}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(node.id);
      }}
      onDblClick={(e) => {
        e.stopPropagation();
        if (hasChildren) onToggle(node.id);
      }}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
    >
      {/* Indent guides */}
      <span class="sn-indent">
        {Array.from({ length: node.depth }, (_, i) => (
          <span key={i} class="sn-indent-unit" />
        ))}
      </span>

      {/* Expand/collapse toggle */}
      <button
        class={`sn-toggle ${!hasChildren ? "sn-toggle--leaf" : ""}`}
        tabIndex={-1}
        aria-hidden="true"
        onClick={(e) => {
          e.stopPropagation();
          if (hasChildren) onToggle(node.id);
        }}
      >
        {hasChildren ? (expanded ? "\u25BE" : "\u25B8") : ""}
      </button>

      {/* Label */}
      <span class="sn-label">
        {viewMode === "dom"
          ? renderDomLabel(node, changed)
          : renderA11yLabel(node, keyStates, changed)}
        {/* The A11Y view shows a row's key states after the label; the DOM
            view shows them here with the rest. */}
        {renderBadges(
          [
            ...interactionBadges(node),
            ...stateBadges(node, viewMode === "dom" ? "all" : "rest"),
          ],
          { changed },
        )}
        {/* Cross-link chips for disclosure pairs (button ↔ menu, tab ↔ panel) */}
        {onJumpToNode &&
          controlsLinks?.map((link) =>
            renderControlsChip(
              link,
              "forward",
              onJumpToNode,
              JUMP_KEYS.forward,
            ),
          )}
        {onJumpToNode &&
          controlledByLinks?.map((link, i) =>
            // Alt+Shift+J reaches the first row that controls this one.
            renderControlsChip(
              link,
              "reverse",
              onJumpToNode,
              i === 0 ? JUMP_KEYS.back : undefined,
            ),
          )}
        {said && <span class="sn-sr-only">{said}</span>}
      </span>

      {/* Key states: after the label, which can clip them, rather than in
          it. A row too narrow for them widens instead (tree.css, "Long
          labels"). A screen reader hears them after the name instead
          (KeyStatesForReaders). */}
      {renderBadges(keyStates, {
        className: "sn-badges sn-key-states",
        hidden: true,
        changed,
      })}

      {/* The change marks' tags, after the key states, where nothing clips
          them either. */}
      {changeMarks && (
        <RowChangeTags marks={changeMarks} since={changesSince} />
      )}

      {/* Action button */}
      {primaryAction && (
        <button
          class="sn-action"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            onActivate(node.id);
          }}
        >
          {ACTION_LABELS[primaryAction]}
        </button>
      )}

      {/* Slider / spinbutton: paired ▼/▲ stepper. The order is
          decrement-then-increment so the visible glyphs read as a single
          range control (▼ ▲) rather than as two unrelated buttons.

          The onClick handler is defensive about focus management because
          this only fails in the same-document case (the React-app inline
          panel) where focus is one shared resource between the panel
          button and the page slider. Radix Slider re-focuses its thumb
          in an effect after its state update commits — with the panel
          and slider in the same document that yanks focus away from the
          button the user just clicked, leaving the focus ring on the
          slider thumb. The extension and Storybook variants don't see
          this because the panel and slider live in separate documents
          and each owns its own document.activeElement.

          Three layers of defense (any one of them is enough on its own,
          but together they cover every timing the widget might use):
            1. `btn.focus()` before dispatch — primes the dispatcher's
               previouslyFocused capture so its own restore aims here.
            2. `setTimeout(0)` re-focus — wins against synchronous and
               microtask refocus by the widget.
            3. `requestAnimationFrame` re-focus — wins against widgets
               that schedule focus through React commit + effect (Radix
               Slider falls into this bucket).
          All three no-op when focus is already on the button, so rapid
          clicks behave correctly. */}
      {showStepPair && (
        <span class="sn-action-pair">
          <button
            class="sn-action sn-action--step"
            tabIndex={-1}
            aria-label={ACTION_LABELS.decrement}
            title={ACTION_LABELS.decrement}
            onClick={(e) => {
              e.stopPropagation();
              const btn = e.currentTarget as HTMLButtonElement;
              btn.focus({ preventScroll: true });
              onActivate(node.id, "decrement");
              const reclaim = () => {
                if (btn.isConnected && document.activeElement !== btn) {
                  btn.focus({ preventScroll: true });
                }
              };
              setTimeout(reclaim, 0);
              requestAnimationFrame(reclaim);
            }}
          >
            {"▼"}
          </button>
          <button
            class="sn-action sn-action--step"
            tabIndex={-1}
            aria-label={ACTION_LABELS.increment}
            title={ACTION_LABELS.increment}
            onClick={(e) => {
              e.stopPropagation();
              const btn = e.currentTarget as HTMLButtonElement;
              btn.focus({ preventScroll: true });
              onActivate(node.id, "increment");
              const reclaim = () => {
                if (btn.isConnected && document.activeElement !== btn) {
                  btn.focus({ preventScroll: true });
                }
              };
              setTimeout(reclaim, 0);
              requestAnimationFrame(reclaim);
            }}
          >
            {"▲"}
          </button>
        </span>
      )}
    </div>
  );
}
