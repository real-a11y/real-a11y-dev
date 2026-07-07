// ARIA semantics validation for the Semantic Navigator accessibility tree.

// The rules — per-node + tree-level relationship checks.
export { validateNode, validateTree } from "./validate.js";
export type { ValidatedNode, NodeIssue } from "./validate.js";

// The aria-query schema layer the rules (and authoring UIs) are built on.
export {
  CONCRETE_ROLES,
  STATE_ATTRS,
  attributesForRole,
  roleMeta,
  isValidRole,
  suggestedChildRoles,
  isPresentationalChildren,
  requiredOwnedRoles,
} from "./aria-schema.js";
export type { AttrType, AttrSpec, RoleMeta } from "./aria-schema.js";
