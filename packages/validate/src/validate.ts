/**
 * ARIA semantics validation over an accessibility tree. Two layers:
 *   - `validateNode` — per-node rules (valid role, required name/attrs, direct
 *     required context): everything checkable from one node and its parent.
 *   - `validateTree` — relationship rules that need the whole tree: interactive
 *     nesting, presentational-children misuse, and required-owned containers.
 *
 * Both operate on the minimal `ValidatedNode` shape, so any tree can be checked
 * — the builder's authored model today, and (with a thin adapter) a core
 * `SemanticNode` tree from imported HTML, a live page, or a CI gate tomorrow.
 */
import {
  isValidRole,
  roleMeta,
  attributesForRole,
  isPresentationalChildren,
  requiredOwnedRoles,
} from "./aria-schema.js";

/** The minimal node shape the validators need — a structural subset of the
 *  builder's `BuilderNode` and of an adapted core `SemanticNode`. */
export interface ValidatedNode {
  id: string;
  parentId: string | null;
  role: string;
  name: string;
  attrs: Record<string, string | boolean>;
}

export interface NodeIssue {
  severity: "error" | "warn";
  message: string;
}

type NodeMap = ReadonlyMap<string, ValidatedNode>;

/** Focusable, operable widget roles — nesting one inside another is invalid. */
const INTERACTIVE = new Set([
  "button",
  "link",
  "checkbox",
  "radio",
  "switch",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "tab",
  "textbox",
  "searchbox",
  "combobox",
  "slider",
  "spinbutton",
  // NB: treeitem is intentionally excluded — tree items legitimately nest (a
  // treeitem owns a group of child treeitems), so treeitem-in-treeitem is valid
  // structure, not a nested-control error.
]);

/** Per-node spec issues — drives the red/green dot and the inspector list. */
export function validateNode(
  n: ValidatedNode,
  nodesById: NodeMap,
): NodeIssue[] {
  const issues: NodeIssue[] = [];
  if (!isValidRole(n.role)) {
    issues.push({
      severity: "error",
      message: `"${n.role}" is not a valid ARIA role`,
    });
    return issues;
  }
  const meta = roleMeta(n.role);

  if (meta.accessibleNameRequired && !n.name.trim()) {
    issues.push({
      severity: "error",
      message: `role "${n.role}" requires an accessible name`,
    });
  }

  const required = attributesForRole(n.role).filter((a) => a.required);
  for (const a of required) {
    const v = n.attrs[a.name];
    if (v === undefined || v === "" || v === false) {
      issues.push({ severity: "error", message: `missing required ${a.name}` });
    }
  }

  if (meta.requiredContextRole.length > 0) {
    const parent = n.parentId ? nodesById.get(n.parentId) : null;
    const ok = parent && meta.requiredContextRole.includes(parent.role);
    if (!ok) {
      issues.push({
        severity: "warn",
        message: `should be inside ${meta.requiredContextRole.join(" / ")}`,
      });
    }
  }
  return issues;
}

function childrenOf(nodes: NodeMap, id: string): ValidatedNode[] {
  return [...nodes.values()].filter((n) => n.parentId === id);
}

function descendants(nodes: NodeMap, id: string): ValidatedNode[] {
  const out: ValidatedNode[] = [];
  const walk = (pid: string) => {
    for (const n of childrenOf(nodes, pid)) {
      out.push(n);
      walk(n.id);
    }
  };
  walk(id);
  return out;
}

/**
 * Tree-level relationship issues keyed by node id — the checks `validateNode`
 * can't do because they need the whole tree, not one node.
 */
export function validateTree(nodes: NodeMap): Map<string, NodeIssue[]> {
  const issues = new Map<string, NodeIssue[]>();
  const add = (id: string, issue: NodeIssue) => {
    const list = issues.get(id);
    if (list) list.push(issue);
    else issues.set(id, [issue]);
  };

  for (const node of nodes.values()) {
    // 1. Interactive nested inside interactive (link inside button, …).
    if (INTERACTIVE.has(node.role)) {
      let ancestor = node.parentId ? nodes.get(node.parentId) : null;
      while (ancestor) {
        if (INTERACTIVE.has(ancestor.role)) {
          add(node.id, {
            severity: "error",
            message: `interactive "${node.role}" is nested inside "${ancestor.role}" — nested controls aren't operable by assistive tech`,
          });
          break;
        }
        ancestor = ancestor.parentId ? nodes.get(ancestor.parentId) : null;
      }
    }

    // 2. A role whose children are presentational (button, link, tab…) must not
    //    hold interactive or composite content — it's dropped from the tree.
    if (isPresentationalChildren(node.role)) {
      const offender = descendants(nodes, node.id).find(
        (d) => INTERACTIVE.has(d.role) || requiredOwnedRoles(d.role).length > 0,
      );
      if (offender) {
        add(node.id, {
          severity: "error",
          message: `"${node.role}" content is presentational — the nested "${offender.role}" won't be exposed`,
        });
      }
    }

    // 3. A container that must own specific roles, but doesn't.
    const owned = requiredOwnedRoles(node.role);
    if (owned.length > 0) {
      const kids = childrenOf(nodes, node.id);
      if (!kids.some((k) => owned.includes(k.role))) {
        add(node.id, {
          severity: "warn",
          message: `"${node.role}" should contain ${owned.join(" / ")}`,
        });
      }
    }
  }

  return issues;
}
