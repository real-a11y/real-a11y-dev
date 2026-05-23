// Shared inline styles for vanilla pattern demos. Inlined per-pattern
// to keep each module self-contained (no shared stylesheet to load).
// Matches the visual language of the React example-patterns so the
// side-by-side demo feels consistent across consumer types.

export const styles = {
  border: "1px solid #ccc",
  bg: "#fff",
  bgSoft: "rgba(0,0,0,0.05)",
  bgSelected: "rgba(46, 121, 255, 0.12)",
  text: "#222",
  textMuted: "#666",
  accent: "#2e79ff",
  radius: "6px",
  font: "inherit",
};

/**
 * Apply a record of styles to an element. Tiny helper so the per-pattern
 * modules don't repeat `Object.assign(el.style, …)` everywhere.
 */
export function applyStyle(
  el: HTMLElement,
  s: Partial<CSSStyleDeclaration>,
): void {
  Object.assign(el.style, s);
}
