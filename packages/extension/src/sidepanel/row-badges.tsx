/**
 * The badges a row of either tree carries after its name: its states, and a
 * frame's "embedded" mark. Shared, so the in-page tree and Chrome's tree
 * colour a state the same way (`tree.css`: red for disabled, green for an
 * on state, amber for a mixed one, orange for required, grey for the rest)
 * and say the same of a frame.
 */

/** A state badge: its text, and the class that colours it. */
export interface StateBadge {
  label: string;
  cls: string;
}

/** The class that colours the badge for state `key` at `value`. */
export function stateBadgeClass(key: string, value: string | boolean): string {
  if (key === "disabled" && value === true) return "sn-state--disabled";
  if ((key === "checked" || key === "pressed") && value === "mixed") {
    return "sn-state--mixed";
  }
  if (
    (key === "checked" || key === "pressed" || key === "selected") &&
    value === true
  ) {
    return "sn-state--on";
  }
  if (key === "required" && value === true) return "sn-state--required";
  return "sn-state--info";
}

/** The in-page tree's state badges: the states it shows, by name. */
export function domStateBadges(
  states: Record<string, string | boolean>,
): StateBadge[] {
  const badges: StateBadge[] = [];
  const add = (label: string, key: string) =>
    badges.push({ label, cls: stateBadgeClass(key, states[key]!) });
  if (states["disabled"] === true) add("disabled", "disabled");
  if (states["checked"] === true) add("checked", "checked");
  if (states["checked"] === "mixed") add("mixed", "checked");
  if (states["pressed"] === true) add("pressed", "pressed");
  if (states["selected"] === true) add("selected", "selected");
  if (states["expanded"] === true) add("expanded", "expanded");
  if (states["expanded"] === false) add("collapsed", "expanded");
  if (states["required"] === true) add("required", "required");
  if (states["readonly"] === true) add("readonly", "readonly");
  if (states["busy"] === true) add("busy", "busy");
  if (states["current"]) add(`current: ${states["current"]}`, "current");
  return badges;
}

/**
 * Chrome's tree's state badges: every state the read kept but a false one,
 * then every AX property (heading level, hasPopup, value bounds, …) as
 * `key=value`. The two are separate collections on the wire
 * (`native-core.ts`'s `axFacets`); unlike a state, a property is never a
 * bare flag. A heading's level is left out: it has the `H2` badge instead.
 */
export function nativeStateBadges(
  states: Record<string, string | boolean> | undefined,
  properties: Record<string, string> | undefined,
  { headingLevel }: { headingLevel?: string } = {},
): StateBadge[] {
  const badges: StateBadge[] = [];
  for (const [key, value] of Object.entries(states ?? {})) {
    const cls = stateBadgeClass(key, value);
    if (key === "expanded") {
      badges.push({ label: value === true ? "expanded" : "collapsed", cls });
    } else if (key === "checked" && value === "mixed") {
      badges.push({ label: "mixed", cls });
    } else if (value === true) {
      badges.push({ label: key, cls });
    } else if (value !== false) {
      badges.push({ label: `${key}=${value}`, cls });
    }
  }
  for (const [key, value] of Object.entries(properties ?? {})) {
    if (key === "level" && headingLevel) continue;
    badges.push({ label: `${key}=${value}`, cls: "sn-state--info" });
  }
  return badges;
}

/** A row's state badges, or nothing when it has none. */
export function StateBadges({ badges }: { badges: StateBadge[] }) {
  if (badges.length === 0) return null;
  return (
    <span class="sn-state-badges">
      {badges.map((b) => (
        <span key={b.label} class={`sn-state-badge ${b.cls}`}>
          {b.label}
        </span>
      ))}
    </span>
  );
}

/**
 * A frame's row that nothing was read into: a frame the tree couldn't
 * reach, or an empty one. A frame whose content was read has it under its
 * row instead, and no mark.
 */
export function EmbeddedBadge() {
  return (
    <span
      class="sn-iframe-badge"
      title="Embedded page — no content read from it"
    >
      embedded
      <span class="sn-sr-only"> page — nothing was read from it</span>
    </span>
  );
}
