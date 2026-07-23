/**
 * The shared vocabulary for normalizing Chromium's native accessibility tree
 * (CDP `Accessibility.getFullAXTree`) into this engine's role/name language.
 *
 * ONE copy, on purpose. Four consumers grew private copies of these tables
 * during the native-tree RFC spikes (#197) and they immediately drifted —
 * different drop-lists, different sibling ordering. Every consumer of the
 * native tree (the browser package's producer, the extension's debugger
 * mode, the desktop navigator, parity harnesses) must import this module
 * instead of re-declaring it.
 *
 * Pure by design: no CDP, no DOM globals — it transforms already-fetched AX
 * JSON, so it runs in Node, jsdom, browsers, and MV3 service workers alike.
 * Anything transport-bound (fetching the tree, resolving backend nodes,
 * redaction-in-page) lives in `@real-a11y-dev/browser`, not here.
 *
 * Versioned because Chromium's tree shifts across milestones: bump
 * {@link NATIVE_AX_VOCABULARY_VERSION} whenever a table change alters
 * normalized output, so mode-stamped snapshots can name the vocabulary that
 * produced them.
 */

/** Bump on any table/rule change that alters normalized output. */
export const NATIVE_AX_VOCABULARY_VERSION = 1;

/**
 * Chromium AX roles that are structural noise relative to this engine's
 * tree: text runs the serializer folds into names, generic wrappers, and
 * Blink-internal containers. Dropped nodes are flattened — their kept
 * descendants re-parent to the nearest kept ancestor.
 */
export const NATIVE_AX_DROP_ROLES: ReadonlySet<string> = new Set([
  "StaticText",
  "InlineTextBox",
  "LineBreak",
  "LabelText",
  "ListMarker",
  "listmarker",
  "generic",
  "none",
  "presentation",
  "RootWebArea",
  "Ignored",
]);

/**
 * Blink AX role → the role this engine prints, where the two differ.
 * `Video`/`Audio` are Chromium-internal (no ARIA media roles exist); the DOM
 * producer already computes `video`/`audio` for media elements, so mapping
 * keeps the two producers speaking one language.
 */
export const NATIVE_AX_ROLE_MAP: Readonly<Record<string, string>> = {
  Video: "video",
  Audio: "audio",
  image: "img",
};

/** Map a raw Blink AX role to the engine's printed role. */
export function mapNativeAXRole(role: string): string {
  return NATIVE_AX_ROLE_MAP[role] ?? role;
}

/**
 * Roles whose accessible name Chromium often leaves on a `StaticText` /
 * `LabelText` child instead of the node itself. Dropping those children
 * without promoting the text loses real content (`listitem "Alpha"` became a
 * bare `listitem` in the spikes) — see `promoteNameFromDroppedDescendants`
 * in the normalizer.
 */
export const NATIVE_AX_NAME_SOURCE_ROLES: ReadonlySet<string> = new Set([
  "StaticText",
  "LabelText",
]);
