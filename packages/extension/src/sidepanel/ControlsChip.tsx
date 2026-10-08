/**
 * One `aria-controls` jump chip, shared by both producers' trees: `forward`
 * points at a row this one controls, `reverse` back at a row that controls
 * it. An `inferred` link came from the `aria-haspopup` heuristic
 * (`indexControlLinks`), not from `aria-controls`, and says so. Outside the
 * Tab order like every row control; `keyHint` names the key that reaches it.
 */

/** How long a row a jump lands on stays highlighted, in both trees. */
export const JUMP_FLASH_MS = 700;

/** A chip's label never runs past this many characters of the name. */
const CHIP_NAME_MAX = 24;

export function ControlsChip({
  role,
  name,
  direction,
  inferred,
  keyHint,
  onJump,
}: {
  /** The other row's role, as its own row shows it. */
  role: string;
  name: string;
  direction: "forward" | "reverse";
  inferred: boolean;
  /** The key that follows this link, for the tooltip, e.g. "Alt+J". */
  keyHint?: string;
  onJump: () => void;
}) {
  const reverse = direction === "reverse";
  const title = inferred
    ? reverse
      ? `Likely controlled by this ${role} (inferred; no aria-controls set on the trigger)`
      : `Likely controls this ${role} (inferred from aria-haspopup + aria-expanded; no aria-controls set)`
    : reverse
      ? `Jump to the ${role} that controls this element`
      : `Jump to the ${role} this element controls`;
  return (
    <button
      class={`sn-controls-link${reverse ? " sn-controls-link--reverse" : ""}${inferred ? " sn-controls-link--inferred" : ""}`}
      tabIndex={-1}
      onClick={(e) => {
        e.stopPropagation();
        onJump();
      }}
      title={keyHint ? `${title} (${keyHint})` : title}
    >
      {reverse ? "← " : "→ "}
      {role}
      {name &&
        ` "${name.length > CHIP_NAME_MAX ? name.slice(0, CHIP_NAME_MAX) + "…" : name}"`}
    </button>
  );
}
