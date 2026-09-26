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
export const NATIVE_AX_VOCABULARY_VERSION = 5;

/**
 * Chromium AX roles that are structural noise relative to this engine's
 * tree: text runs the serializer folds into names, presentational wrappers,
 * and Blink-internal containers. Dropped nodes are flattened — their kept
 * descendants re-parent to the nearest kept ancestor.
 *
 * `none`/`presentation` stay here unconditionally: the author explicitly
 * removed the element's semantics, so we honor that even when Chromium still
 * computes a name for it. `generic` is the exception — see
 * `NATIVE_AX_DROP_UNLESS_NAMED`.
 */
export const NATIVE_AX_DROP_ROLES: ReadonlySet<string> = new Set([
  "StaticText",
  "InlineTextBox",
  "LineBreak",
  "LabelText",
  "ListMarker",
  "listmarker",
  "none",
  "presentation",
  "RootWebArea",
  "Ignored",
]);

/**
 * Roles that are structural noise ONLY when unnamed. A bare `generic` (a
 * div/span with no role) is dropped and flattened like any other wrapper — but
 * a *named* generic is a meaningful labelled container and must survive. The
 * motivating case: Chromium exposes YouTube's player wrapper as
 * `generic "YouTube Video Player"`, grouping the media controls beneath it.
 * Dropping it flattens the scrubber/play/mute nodes up to the surrounding
 * region — losing the grouping a screen-reader user relies on, and diverging
 * from the DOM producer, which keeps the named container. So a `generic` is
 * kept iff it carries a non-empty accessible name.
 */
export const NATIVE_AX_DROP_UNLESS_NAMED: ReadonlySet<string> = new Set([
  "generic",
]);

/**
 * Roles dropped only when BARE: no name, not focusable, and none of
 * {@link NATIVE_AX_EXPOSING_PROPERTIES}. These are HTML-AAM's
 * `sectionheader`/`sectionfooter` (a `<header>`/`<footer>` inside `main` or
 * sectioning content). HTML-AAM says user agents MAY leave them unexposed
 * under exactly those conditions; Chromium exposes them anyway. The DOM
 * producer's a11y view flattens a bare one, so dropping it here keeps the
 * two producers agreeing — a named or focusable one survives in both.
 */
export const NATIVE_AX_DROP_WHEN_BARE: ReadonlySet<string> = new Set([
  "sectionheader",
  "sectionfooter",
]);

/**
 * CDP AX property names that come from a global ARIA attribute carrying
 * information of its own — any one of them makes a
 * {@link NATIVE_AX_DROP_WHEN_BARE} node worth keeping. `focusable` is checked
 * separately (it is a boolean state, not an attribute reference).
 */
export const NATIVE_AX_EXPOSING_PROPERTIES: ReadonlySet<string> = new Set([
  "describedby",
  "controls",
  "details",
  "flowto",
  "owns",
  "keyshortcuts",
  "roledescription",
  "live",
  "errormessage",
  // Global states `aria-busy` / `aria-disabled` — the DOM side keeps on the
  // same two (`a11y.states.busy`, the `aria-disabled` key attribute).
  "busy",
  "disabled",
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
 * in the normalizer. (A node's DIRECT `StaticText` children are read by
 * `directText` there first, and that step reads only `StaticText`: a
 * `LabelText` is a `<label>` element, not the node's own text. See
 * {@link NATIVE_AX_OWN_TEXT_ROLES}.)
 */
export const NATIVE_AX_NAME_SOURCE_ROLES: ReadonlySet<string> = new Set([
  "StaticText",
  "LabelText",
]);

/**
 * Prose roles whose text IS their content, so they take a name from their own
 * `StaticText` children even when they also have kept children — a paragraph
 * that mixes sentences with a `link` or `code` (see `directText` in the
 * normalizer). Chromium leaves these unnamed because ARIA prohibits naming
 * them (paragraph, code, strong…) or never computes one from content
 * (listitem, blockquote…), not because anything is missing.
 *
 * Deliberately NOT here: every role named by its author only — dialog,
 * alertdialog, img, the landmarks, form, and widgets. Chromium's empty name
 * on those IS the finding: `<div role="dialog">Delete this project?
 * <button>Cancel</button></div>` has no accessible name, and the audit rules
 * (`dialog-labeled`, `image-alt`, `no-unlabeled-interactive`) read exactly that
 * emptiness. Naming them from their loose text would pass an unlabeled dialog.
 * The ones the audit reads never take a name from text even as a leaf — see
 * {@link NATIVE_AX_AUTHOR_NAMED_ROLES}.
 *
 * Raw Blink role strings (Chromium 151), like the other tables here.
 */
export const NATIVE_AX_OWN_TEXT_ROLES: ReadonlySet<string> = new Set([
  "paragraph",
  "blockquote",
  "listitem",
  "term",
  "definition",
  "caption",
  "Figcaption",
  "code",
  "strong",
  "emphasis",
  "mark",
  "deletion",
  "insertion",
  "subscript",
  "superscript",
  "time",
]);

/**
 * Roles named by their author only, where Chromium's EMPTY name is the
 * information. An image, a dialog, a landmark or a form field with no
 * `aria-label`, `aria-labelledby`, `alt`, `<label>` or `title` is unlabeled,
 * and the audit rules (`image-alt`, `dialog-labeled`,
 * `no-unlabeled-interactive`) report exactly that emptiness. So none of these
 * takes a name from the text inside it: not as a leaf, not from its direct
 * text, not from deeper in its dropped subtree. `<span role="img">🎉</span>` is
 * `image ""` with a `StaticText "🎉"` child, and prints as a bare `img`, not
 * `img "🎉"`. The text is dropped with its StaticText, as it already is beside
 * kept children: the native tree prints names, and this text is not one.
 *
 * The form fields are the name-from-author roles in the audit's interactive
 * set. The text inside one is a typed value, or a `<label>` that labels
 * nothing — never its name. Name-from-content roles (button, link, checkbox,
 * tab…) are not here: Chromium names those from their content itself, and
 * leaves one empty only when that content is hidden or absent.
 *
 * Also not here: author-named roles that no rule reads the name of, and whose
 * text is their content — alert, status, group, article, list, tree. They
 * keep their text as a name, which is the only place the tree keeps it.
 *
 * Checked against Chromium 151: each comes back unnamed with its text on a
 * child, except `region` and `role="form"`, which Chromium does not expose at
 * all until they are named. They are listed anyway, so a milestone that starts
 * exposing them unnamed can't slip one past. Raw Blink role strings.
 */
export const NATIVE_AX_AUTHOR_NAMED_ROLES: ReadonlySet<string> = new Set([
  "image",
  "dialog",
  "alertdialog",
  // Landmarks, and HTML-AAM's scoped header/footer.
  "banner",
  "complementary",
  "contentinfo",
  "form",
  "main",
  "navigation",
  "region",
  "search",
  "sectionheader",
  "sectionfooter",
  // Form fields.
  "combobox",
  "listbox",
  "searchbox",
  "slider",
  "spinbutton",
  "textbox",
]);
