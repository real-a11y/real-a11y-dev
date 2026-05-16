import type {
  ActionType,
  SemanticNode,
  TreeViewMode,
} from "@real-a11y-dev/core";
import { getPrimaryAction, ACTION_LABELS } from "@real-a11y-dev/core";

import type { ControlsLink } from "./TreePanel.js";

interface TreeNodeProps {
  node: SemanticNode;
  viewMode: TreeViewMode;
  isSelected: boolean;
  /**
   * True for the row currently mid-flash after a cross-link jump landed on
   * it. Adds an `sn-node--flash` class that drives a brief background
   * animation.
   */
  isFlashing?: boolean;
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
}

function renderDomLabel(node: SemanticNode) {
  const { tagName, attributes, textContent } = node.dom;
  const displayAttrs: Array<{ key: string; val: string }> = [];

  if (attributes["id"]) displayAttrs.push({ key: "id", val: attributes["id"] });
  if (attributes["class"]) {
    const classes = attributes["class"].split(/\s+/).slice(0, 3).join(" ");
    displayAttrs.push({ key: "class", val: classes });
  }
  if (attributes["href"])
    displayAttrs.push({ key: "href", val: attributes["href"] });
  if (attributes["role"])
    displayAttrs.push({ key: "role", val: attributes["role"] });
  if (attributes["aria-label"])
    displayAttrs.push({ key: "aria-label", val: attributes["aria-label"] });

  return (
    <>
      <span class="sn-tag">
        {"<"}
        {tagName}
      </span>
      {displayAttrs.map((attr) => (
        <span key={attr.key}>
          {" "}
          <span class="sn-attr-key">{attr.key}</span>
          {"="}
          <span class="sn-attr-val">"{attr.val}"</span>
        </span>
      ))}
      <span class="sn-tag">{">"}</span>
      {textContent && <span class="sn-text-content">{textContent}</span>}
    </>
  );
}

function renderA11yLabel(node: SemanticNode) {
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
      <span class="sn-role">{role}</span>
      {level && <span class="sn-text-muted"> level {level}</span>}
      {name && <span class="sn-name">{name}</span>}
      {showPreview && <span class="sn-name-preview">{descendantText}</span>}
    </>
  );
}

function renderBadges(node: SemanticNode) {
  const badges: Array<{ label: string; className: string }> = [];

  if (node.interaction.isInteractive) {
    badges.push({ label: "interactive", className: "sn-badge--interactive" });
  }

  if (node.interaction.isFocusable) {
    badges.push({ label: "focusable", className: "sn-badge--interactive" });
  }

  // State badges
  for (const [key, val] of Object.entries(node.a11y.states)) {
    if (val === true) {
      badges.push({ label: key, className: "sn-badge--state" });
    } else if (val !== false && val !== "") {
      badges.push({ label: `${key}=${val}`, className: "sn-badge--state" });
    }
  }

  if (badges.length === 0) return null;

  return (
    <span class="sn-badges">
      {badges.map((b) => (
        <span key={b.label} class={`sn-badge ${b.className}`}>
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
) {
  const arrow = direction === "forward" ? "→ " : "← ";
  const reverseClass =
    direction === "reverse" ? " sn-controls-link--reverse" : "";
  const inferredClass = link.inferred ? " sn-controls-link--inferred" : "";
  const verb = direction === "forward" ? "controls" : "is controlled by";
  const title = link.inferred
    ? `Likely ${verb} ${link.label} (inferred from aria-haspopup; no aria-controls set)`
    : `Jump to ${link.label} — ${verb} this element`;
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
  onSelect,
  onToggle,
  onActivate,
  onHover,
  controlsLinks,
  controlledByLinks,
  onJumpToNode,
}: TreeNodeProps) {
  const hasChildren = node.childIds.length > 0;
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

  const classNames = [
    "sn-node",
    isSelected && "sn-node--selected",
    isFlashing && "sn-node--flash",
    !node.ui.matchesFilter && "sn-node--filtered-out",
    node.dom.isHidden && "sn-node--hidden",
    node.interaction.isInteractive && "sn-node--interactive",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      class={classNames}
      role="treeitem"
      aria-expanded={hasChildren ? node.ui.expanded : undefined}
      aria-selected={isSelected}
      aria-level={node.depth + 1}
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
        {hasChildren ? (node.ui.expanded ? "\u25BE" : "\u25B8") : ""}
      </button>

      {/* Label */}
      <span class="sn-label">
        {viewMode === "dom" ? renderDomLabel(node) : renderA11yLabel(node)}
        {renderBadges(node)}
        {/* Cross-link chips for disclosure pairs (button ↔ menu, tab ↔ panel) */}
        {onJumpToNode &&
          controlsLinks?.map((link) =>
            renderControlsChip(link, "forward", onJumpToNode),
          )}
        {onJumpToNode &&
          controlledByLinks?.map((link) =>
            renderControlsChip(link, "reverse", onJumpToNode),
          )}
      </span>

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
          range control (▼ ▲) rather than as two unrelated buttons. */}
      {showStepPair && (
        <span class="sn-action-pair">
          <button
            class="sn-action sn-action--step"
            tabIndex={-1}
            aria-label={ACTION_LABELS.decrement}
            title={ACTION_LABELS.decrement}
            onClick={(e) => {
              e.stopPropagation();
              onActivate(node.id, "decrement");
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
              onActivate(node.id, "increment");
            }}
          >
            {"▲"}
          </button>
        </span>
      )}
    </div>
  );
}
