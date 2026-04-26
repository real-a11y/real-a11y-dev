import type { SemanticNode, TreeViewMode } from "@real-a11y-dev/core";
import { getPrimaryAction, ACTION_LABELS } from "@real-a11y-dev/core";

interface TreeNodeProps {
  node: SemanticNode;
  viewMode: TreeViewMode;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onActivate: (id: string) => void;
  onHover: (id: string | null) => void;
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

  return (
    <>
      <span class="sn-role">{role}</span>
      {level && <span class="sn-text-muted"> level {level}</span>}
      {name && <span class="sn-name">{name}</span>}
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

export function TreeNode({
  node,
  viewMode,
  isSelected,
  onSelect,
  onToggle,
  onActivate,
  onHover,
}: TreeNodeProps) {
  const hasChildren = node.childIds.length > 0;
  const primaryAction = getPrimaryAction(node.interaction.actions);

  const classNames = [
    "sn-node",
    isSelected && "sn-node--selected",
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
    </div>
  );
}
