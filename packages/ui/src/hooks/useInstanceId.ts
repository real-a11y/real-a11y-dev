import { useRef } from "preact/hooks";

let nextInstance = 0;

/**
 * Stable, id-safe token for the lifetime of a component mount.
 *
 * Used to prefix `aria-activedescendant` targets so two panels rendered into
 * the same document (light-DOM inspector mounts) never emit duplicate row ids.
 */
export function useInstanceId(label = "p"): string {
  const ref = useRef<string>("");
  if (!ref.current) {
    nextInstance += 1;
    ref.current = `${label}${nextInstance}`;
  }
  return ref.current;
}

/** DOM id for a tree row — must match the container's aria-activedescendant. */
export function treeRowDomId(instanceId: string, nodeId: string): string {
  return `snrow-${instanceId}-${nodeId}`;
}

/** DOM id for an index-based listbox option (filtered / tab-sequence). */
export function listOptionDomId(
  surface: string,
  instanceId: string,
  index: number,
): string {
  return `sn-ui-${surface}-opt-${instanceId}-${index}`;
}
