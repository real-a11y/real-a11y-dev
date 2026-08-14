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
  /**
   * The role came from the element (`<select>` → combobox), not an authored
   * `role=`. Governs STRUCTURE — the nesting exemption and the invalid-role
   * check, since only an authored role can be invalid ARIA.
   *
   * Absent fails closed: treated as authored.
   */
  implicitRole?: boolean;
  /**
   * ARIA attributes the user agent supplies, so the author owes nothing and a
   * required-attribute check must not fire. Per-attribute, because an element
   * can supply one state and still owe another.
   *
   * Absent fails closed: treated as supplying nothing.
   *
   * Kept separate from {@link ValidatedNode.implicitRole} because "is the role
   * authored" and "does the UA supply this state" diverge — `<input
   * type="checkbox" role="switch">` is authored, non-redundant, and still has
   * UA-supplied checkedness.
   */
  uaSuppliedAttrs?: readonly string[];
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

/**
 * `ancestor>child` role pairs where an interactive-inside-interactive nesting
 * is the element's own required structure rather than an authoring mistake —
 * and so only exempt when BOTH sides got their role from the element.
 *
 * Exactly one entry, and deliberately not more: `<select>` owning `<option>`.
 * `<optgroup>` sits between them as a non-interactive `group`, so the walk
 * still resolves an option's nearest interactive ancestor to the select.
 *
 * `listbox>option` was here for `<select multiple>` and was **unreachable** —
 * the key is only built inside `INTERACTIVE.has(ancestor.role)` and `listbox`
 * is not in that set, so the lookup could never see it. Adding `listbox` to
 * `INTERACTIVE` to make it reachable would change what the nesting rule flags
 * everywhere; a `<select multiple>` needs no exemption today because its
 * options simply climb past it. Kept out until something actually needs it,
 * with a paired test, rather than left as a promise the code doesn't keep.
 */
const NATIVE_STRUCTURAL_NESTING = new Set(["combobox>option"]);

/** Per-node spec issues — drives the red/green dot and the inspector list. */
export function validateNode(
  n: ValidatedNode,
  nodesById: NodeMap,
): NodeIssue[] {
  const issues: NodeIssue[] = [];
  // Only an AUTHORED role can be an invalid ARIA role. An implicit one is
  // engine vocabulary — `<video controls>` extracts as `video`, which is not
  // in the ARIA role set — and reporting it told the user their browser's own
  // element was broken. It also returned early, so no other rule ran on those
  // nodes: a page containing a `<video>` could not use the matcher at all.
  if (!n.implicitRole && !isValidRole(n.role)) {
    issues.push({
      severity: "error",
      message: `"${n.role}" is not a valid ARIA role`,
    });
    return issues;
  }
  // Engine vocabulary has no ARIA schema to check against, so the remaining
  // per-node rules would all read as "missing" against an empty spec.
  if (!isValidRole(n.role)) return issues;
  const meta = roleMeta(n.role);

  if (meta.accessibleNameRequired && !n.name.trim()) {
    issues.push({
      severity: "error",
      message: `role "${n.role}" requires an accessible name`,
    });
  }

  // Required ARIA attributes are the AUTHOR's obligation — but only for the
  // ones no user agent supplies. `<input type="checkbox">` has checkedness
  // whether or not anyone wrote `aria-checked`, and a `<select>` has its popup
  // whether or not anyone wrote `aria-controls`, so demanding them reported
  // correct HTML as broken. See `uaSuppliedAttrs`, which is per-attribute
  // precisely because an element can supply one state and still owe another.
  const required = attributesForRole(n.role).filter((a) => a.required);
  for (const a of required) {
    if (n.uaSuppliedAttrs?.includes(a.name)) continue;
    const v = n.attrs[a.name];
    // `false` is a PRESENT value, not an absent one. `aria-expanded="false"`
    // is a collapsed combobox and `aria-checked="false"` an unchecked box —
    // the ordinary states. Counting them as missing made the most common
    // shape of correct authored markup unsatisfiable.
    if (v === undefined || v === "") {
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
          // `<select><option>` is combobox > option — the nesting IS how a
          // select is built, so flagging it told people to break correct
          // markup. The exemption is deliberately a named pair list rather
          // than "both roles are native": blanket-exempting native nesting
          // would also swallow `<button><a href>`, which is a real bug (and
          // invalid HTML), so no correct document would ever reach it.
          const nativeStructure =
            node.implicitRole &&
            ancestor.implicitRole &&
            NATIVE_STRUCTURAL_NESTING.has(`${ancestor.role}>${node.role}`);
          // An exempt pair must not END the walk, only skip this rung. The
          // `option` in `<div role="button"><select><option>` is legitimately
          // nested in its select — and illegitimately nested in the button
          // above it, which nothing would ever test if we stopped here. Every
          // entry added to the pair list widens what a `break` could swallow.
          if (nativeStructure) {
            ancestor = ancestor.parentId ? nodes.get(ancestor.parentId) : null;
            continue;
          }
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
