import { ariaAttributeOfProperty, type A11yInfo } from "@real-a11y-dev/core";

/**
 * The `aria-*` attributes a node's computed states and properties stand for,
 * as the validator reads them.
 *
 * A state's key is its attribute without `aria-`. So is a property's, and a
 * property key with no attribute (`captions`) is not written back. Both come
 * from the node, not from the page, so a native node validates like a DOM one.
 */
export function computedAriaAttributes(
  a11y: Pick<A11yInfo, "states" | "properties">,
): Record<string, string | boolean> {
  const attrs: Record<string, string | boolean> = {};
  for (const [k, v] of Object.entries(a11y.states)) attrs[`aria-${k}`] = v;
  for (const [k, v] of Object.entries(a11y.properties)) {
    const attr = ariaAttributeOfProperty(k);
    if (attr !== null) attrs[attr] = v;
  }
  return attrs;
}
