/**
 * ARIA schema — a thin wrapper over `aria-query`, the canonical WAI-ARIA data
 * package (the same source eslint-jsx-a11y and Testing Library trust). We do NOT
 * hand-maintain a role list — it would drift from the spec.
 *
 * This is the reason the validation layer is its own package rather than part of
 * `@real-a11y-dev/core`: core stays dependency-free, and the `aria-query`
 * dependency (and the rules built on it) lives here.
 */
import { roles as ariaRolesRaw, aria as ariaPropsRaw } from "aria-query";

/**
 * `@types/aria-query` ships a conservative `ARIARoleDefinition` that omits
 * fields the *runtime* data actually carries (`accessibleNameRequired`,
 * `requireContextRole`/`requiredContextRole`). We re-type the maps to their
 * true runtime shape so we can read them without `any`.
 */
interface RoleDef {
  abstract: boolean;
  props?: Record<string, unknown>;
  requiredProps?: Record<string, unknown>;
  accessibleNameRequired?: boolean;
  requireContextRole?: string[];
  requiredContextRole?: string[];
  requiredOwnedElements?: string[][];
  superClass?: string[][];
  childrenPresentational?: boolean;
}
interface PropDef {
  type?: string;
  values?: (string | boolean)[];
}
const ariaRoles = ariaRolesRaw as unknown as {
  get(key: string): RoleDef | undefined;
  keys(): string[];
};
const ariaProps = ariaPropsRaw as unknown as {
  get(key: string): PropDef | undefined;
};

export type AttrType =
  | "boolean"
  | "tristate"
  | "token"
  | "tokenlist"
  | "integer"
  | "number"
  | "string"
  | "id"
  | "idlist";

export interface AttrSpec {
  name: string; // e.g. "aria-checked"
  required: boolean;
  type: AttrType;
  values?: string[]; // for token / tristate
}

export interface RoleMeta {
  accessibleNameRequired: boolean;
  requiredContextRole: string[]; // e.g. tab → ["tablist"]
  superClass: string[];
}

/**
 * Concrete, author-usable roles only. Abstract roles (`widget`, `roletype`,
 * `input`, …) are structural in the ARIA taxonomy and must never be set on a
 * real node, so we filter them out — this is the "official roles only" rule.
 */
export const CONCRETE_ROLES: string[] = [...ariaRoles.keys()]
  .filter((r) => {
    const def = ariaRoles.get(r);
    return (
      def &&
      !def.abstract &&
      !r.startsWith("doc-") &&
      !r.startsWith("graphics-")
    );
  })
  .sort();

/** ARIA attributes that represent dynamic *state* (mapped to `a11y.states`); the
 *  rest are treated as *properties* (`a11y.properties`) — mirroring core's split. */
export const STATE_ATTRS = new Set([
  "aria-busy",
  "aria-checked",
  "aria-current",
  "aria-disabled",
  "aria-expanded",
  "aria-grabbed",
  "aria-hidden",
  "aria-invalid",
  "aria-pressed",
  "aria-selected",
]);

function attrType(name: string): { type: AttrType; values?: string[] } {
  const def = ariaProps.get(name);
  const type = (def?.type as AttrType) ?? "string";
  const values = def?.values?.map(String);
  return { type, values };
}

/** The aria-* attributes legal on a role, required ones first and flagged. */
export function attributesForRole(role: string): AttrSpec[] {
  const def = ariaRoles.get(role);
  if (!def) return [];
  const required = new Set(Object.keys(def.requiredProps ?? {}));
  const all = new Set<string>([
    ...Object.keys(def.requiredProps ?? {}),
    ...Object.keys(def.props ?? {}),
  ]);
  return [...all]
    .map((name) => ({ name, required: required.has(name), ...attrType(name) }))
    .sort(
      (a, b) =>
        Number(b.required) - Number(a.required) || a.name.localeCompare(b.name),
    );
}

export function roleMeta(role: string): RoleMeta {
  const def = ariaRoles.get(role);
  return {
    accessibleNameRequired: Boolean(def?.accessibleNameRequired),
    requiredContextRole:
      def?.requiredContextRole ?? def?.requireContextRole ?? [],
    superClass: def?.superClass?.flat() ?? [],
  };
}

export function isValidRole(role: string): boolean {
  return CONCRETE_ROLES.includes(role);
}

/**
 * Roles that specifically belong under `parentRole`, per ARIA — either because
 * the child's `requiredContextRole` names this parent (e.g. `listitem`→`list`,
 * `tab`→`tablist`, `option`→`listbox`) or the parent's `requiredOwnedElements`
 * expects them (e.g. `menu`→`menuitem`). Empty for containers with no
 * constraint (`main`, `document`, `generic`…), where any role is fine.
 */
export function suggestedChildRoles(parentRole: string | null): string[] {
  if (!parentRole) return [];
  const out = new Set<string>();

  // Children that require this parent as their context.
  for (const r of CONCRETE_ROLES) {
    const def = ariaRoles.get(r);
    const ctx = def?.requiredContextRole ?? def?.requireContextRole;
    if (ctx && ctx.includes(parentRole)) out.add(r);
  }
  // Elements this parent is expected to own (last role of each ownership chain).
  const owned = ariaRoles.get(parentRole)?.requiredOwnedElements;
  if (Array.isArray(owned)) {
    for (const chain of owned) {
      const role = chain[chain.length - 1];
      if (role && CONCRETE_ROLES.includes(role)) out.add(role);
    }
  }
  return [...out].sort();
}

/**
 * True when a role's descendants are *presentational* (button, link, tab,
 * option…): the browser drops their roles, so nesting interactive or composite
 * content inside is a bug — it won't be exposed to assistive tech.
 */
export function isPresentationalChildren(role: string): boolean {
  return Boolean(ariaRoles.get(role)?.childrenPresentational);
}

/**
 * The roles a container is required to own — the last role of each ownership
 * chain (e.g. `tablist`→[`tab`], `list`→[`listitem`], `table`→[`row`,
 * `rowgroup`]). Empty for roles with no ownership requirement.
 */
export function requiredOwnedRoles(role: string): string[] {
  const owned = ariaRoles.get(role)?.requiredOwnedElements;
  if (!Array.isArray(owned)) return [];
  const out = new Set<string>();
  for (const chain of owned) {
    const r = chain[chain.length - 1];
    if (r) out.add(r);
  }
  return [...out];
}
