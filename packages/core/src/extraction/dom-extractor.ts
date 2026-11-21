import type { SemanticNode, ExtractionResult } from "../types.js";

import { collapseAscii, trimAscii } from "../utils/ascii-whitespace.js";
import { ElementRefMap, ELEMENT_REF_MAP_SHAPE } from "../utils/element-ref.js";
import { getNodeId } from "../utils/id-generator.js";
import { realmSingleton } from "../utils/realm-singleton.js";
import { treeSource } from "../utils/tree-source.js";

import { getAriaStates } from "./aria-states.js";
import { isAriaHiddenValue } from "./aria-tokens.js";
import { AUTHOR_NAMED_ROLES } from "./author-named-roles.js";
import {
  readsSensitivePopup,
  withholdPopupDescription,
  withReadIndexes,
} from "./choice-withholding.js";
import {
  safeGetAttribute,
  safeGetElementById,
  safeNodeType,
  safeOwnerDocument,
  safeTagName,
} from "./clobber-safe.js";
import { isEditingHost } from "./editing.js";
import { getActions } from "./element-actions.js";
import {
  EMBEDDED_VALUE_ROLES,
  embeddedValue,
  getAnnouncedValue,
  type DescendantTextMemo,
  getDescendantText,
  lendsValueOnly,
  MEDIA_TAGS,
  TEXT_INPUT_TYPES,
} from "./field-text.js";
import { flatChildNodes, flatChildren, idScope } from "./flat-tree.js";
import { isFocusable } from "./focusability.js";
import { readGeneratedText } from "./generated-content.js";
import * as host from "./host-names.js";
import { getKeyAttributes } from "./key-attributes.js";
import { associatedLabels, wrappingLabelText } from "./label-text.js";
import { hasCaptionsTrack } from "./media-tracks.js";
export { isTextVisible } from "./name-spacing.js";
import { isNameFromContentHost } from "./name-hosts.js";
import {
  childTextWalk,
  hiddenChildText,
  isImplicitDetailsGroup,
  NAME_BARRIER_ROLES,
  NAMED_WIDGET_ROLES,
  needsSpaceAround,
  rootTextVisible,
  isAriaHiddenChild,
  referenceWalk,
  type TextVisibility,
} from "./name-spacing.js";
import { PANEL_HOST_ATTRIBUTE } from "./overlay-reach.js";
import { resolveEffectiveRoot } from "./overlay-scope.js";
import { scopeReferenceIndex } from "./reference-index.js";
import {
  getCachedComputedStyle,
  getImplicitRole,
  getHeadingLevel,
  isHiddenFromAT,
  isSubtreeHidden,
  type StyleCache,
} from "./role-map.js";
import { REDACTED_VALUE } from "./sensitivity.js";
import { warnSkippedElement } from "./skipped-element.js";
import { isVisuallyHidden } from "./sr-only.js";
import {
  nameText,
  newNameRun,
  withhold,
  withholdsLentValue,
  withholdStates,
  type NameRun,
  type RedactInputOption,
} from "./strict-mode.js";
import { getOwnText, readsTextRuns } from "./text-runs.js";

// The text-run reads live in text-runs.ts; this stays importable from here,
// where the live extractor already finds it.
export { textRunHost } from "./text-runs.js";

// The states an element carries live in aria-states.ts; these stay importable
// from here, where every caller already finds them.
export { expandedState, nativeStates } from "./aria-states.js";
export { KEY_ATTRIBUTES } from "./key-attributes.js";
export {
  OVERLAY_CANDIDATE_SELECTOR,
  containsOverlaySignal,
  countsAsOverlay,
  isModal,
  isOverlaySignal,
  resolveEffectiveRoot,
} from "./overlay-scope.js";

export { PANEL_HOST_ATTRIBUTE } from "./overlay-reach.js";
export type { RedactInputOption } from "./strict-mode.js";

// A field's text and value reads live in field-text.ts; these stay importable
// from here, where every caller already finds them.
export {
  fieldValueOwner,
  finishAnnouncedValue,
  getAnnouncedValue,
  getDescendantText,
  ignoresChildText,
  PAGE_STATE_VALUE_ROLES,
  RANGE_VALUE_ROLES,
  STATE_ONLY_ROLES,
} from "./field-text.js";

/** Tags to skip entirely during extraction */
// track/source are media/picture metadata: HTML-AAM gives them no role and
// no browser emits accessibility nodes for them. Their a11y-relevant signal
// (does this video ship captions?) is hoisted onto the media element itself
// as the `captions` property instead.
const SKIP_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "head",
  "track",
  "source",
]);

/**
 * Media elements. Their light-DOM children are fallback content that modern
 * browsers never render (and <track>/<source> metadata), so the walk does
 * not descend into them — mirroring Chromium's tree, where a media element's
 * only children are its user-agent shadow-DOM controls, which live in a
 * closed shadow root no light-DOM extractor can reach.
 */

/**
 * Compute the accessible description for an element.
 * Resolves aria-describedby IDs to text and falls back to aria-description.
 *
 * A description that read anything it may not show is dropped whole, with
 * no fallback to `aria-description` or `title`, as the native producer drops
 * one: see {@link NameRun.withheld}.
 */
function computeAccessibleDescription(
  element: Element,
  styleCache: StyleCache,
  redactInput: boolean,
): string {
  // 1. aria-describedby — resolve referenced element text
  const describedBy = safeGetAttribute(element, "aria-describedby");
  if (describedBy) {
    const doc = idScope(element);
    let withheld = false;
    const texts = describedBy
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => {
        const target = safeGetElementById(doc, id);
        if (!target) return undefined;
        // The same borrowing as aria-labelledby: Chromium describes
        // `<button aria-describedby="d">` over `<span id="d"><img alt="Warning">
        // irreversible</span>` as "Warning irreversible".
        const run = newNameRun(redactInput);
        const text = referenceText(target, run, styleCache);
        withheld ||=
          run.withheld || readsSensitivePopup(element, target, "describedby");
        return text;
      })
      .filter((t): t is string => !!t);
    if (withheld) return "";
    // Whitespace-normalized like a name: ASCII whitespace only, so a U+00A0
    // survives as Chromium and the WPT text-node cases keep it. The walk pads
    // any child with a box of its own so its text never glues to a neighbour;
    // without this a description read "X  S" where Chromium reads "X S".
    if (texts.length) return collapseAscii(texts.join(" "));
  }
  // 2. aria-description — inline string (ARIA 1.3+)
  const inline = safeGetAttribute(element, "aria-description");
  if (inline) return inline;
  // 3. title — see titleDescription.
  return host.titleDescription(safeGetAttribute(element, "title"), (source) =>
    computeAccessibleName(
      element,
      newNameRun(redactInput),
      styleCache,
      false,
      source,
    ),
  );
}

// Which elements name themselves, or an owner, from content lives in
// name-hosts.ts; these stay importable from here, where every caller finds them.
export {
  htmlAamNameOwner,
  isNameBarrierElement,
  isNameFromContentHost,
} from "./name-hosts.js";

/** How a name-from-content walk was reached. */
interface NameWalk extends TextVisibility {
  /**
   * Inside an aria-labelledby or aria-describedby traversal, where a
   * descendant's own aria-labelledby is ignored (accname §2B: "not already part
   * of an aria-labelledby traversal"). Chromium reads `<span id="a">A <span
   * aria-labelledby="b">x</span></span>`, referenced as a label or a
   * description, as "A x". `"hidden"` when the target itself is hidden: its
   * whole subtree is read, hidden descendants included (accname §2B).
   */
  readonly inReference?: boolean | "hidden";
  /**
   * Text only: no descendant lends an alternative of its own. A `<select>`'s
   * option is named by its text alone in Chromium — `<option><img alt="Flag">
   * France</option>` is option "France".
   */
  readonly textOnly?: boolean;
}

/** Where a computed name came from, for the caller that needs to know. */
interface NameSource {
  /** The name is the element's own text, not an attribute or a reference. */
  fromContent?: boolean;
  /** The name is the `title` attribute, so it is not also the description. */
  fromTitle?: boolean;
}

/**
 * What a descendant lends an ancestor's name ahead of its content, or `null`
 * when it has nothing of its own and its content is walked instead. Accname
 * §2F.iii computes each child's text alternative "beginning with step 2", and
 * Chromium does: `<a href="/"><img alt="Home"></a>` is link "Home",
 * `<button><span aria-label="Close">×</span></button>` is button "Close".
 *
 * - An image lends its name and never its content: its aria-labelledby or
 *   aria-label, its alt, an SVG's `<title>`, or its title; a nameless one lends
 *   "". Chromium reads `<button><span role="img">★</span> Favourite</button>`
 *   as "Favourite" and `<button><svg><text>Go</text></svg></button>` as an
 *   unnamed button. A presentational image (`<img alt="">`, `role="none"`) is
 *   not an image here, and has no content either.
 * - Anything else lends its aria-labelledby, outside a reference traversal,
 *   when that names anything, else its aria-label when it isn't blank. Its
 *   title is ignored: `<a href="/"><span title="Home"></span></a>` is an
 *   unnamed link in Chromium.
 *
 * Each element is read once, under the visit-once rule in
 * computeRawAccessibleName: outside a reference traversal, one this
 * computation has already read lends "". So `<a href="/"><svg
 * aria-labelledby="t"></svg><span id="t">Docs</span></a>` is "Docs" in
 * Chromium, not "Docs Docs": the svg's reference read the span first.
 */
function textAlternative(
  element: Element,
  role: string,
  run: NameRun,
  styleCache: StyleCache | null | undefined,
  walk: NameWalk,
): string | null {
  if (role === "img") {
    return computeAccessibleName(element, run, styleCache, walk.inReference);
  }
  if (run.visited.has(element) && !walk.inReference) return "";
  run.visited.add(element);
  if (!walk.inReference) {
    const labelledBy = labelledByText(element, run, styleCache);
    if (labelledBy) return labelledBy;
  }
  return trimAscii(safeGetAttribute(element, "aria-label") ?? "") || null;
}

/**
 * Where a name walk reads a control, for {@link embeddedControlText}: inside a
 * reference, its own aria-labelledby is ignored.
 */
interface ControlRead extends NameWalk {
  readonly styleCache: StyleCache | null | undefined;
}

/**
 * What a control the user adjusts lends a name or description it sits in
 * (AccName 1.2 step 2C), or `null` when `element` isn't one
 * ({@link EMBEDDED_VALUE_ROLES}): its value as {@link readFieldValue} reads it,
 * or an ARIA listbox's chosen options, ahead of its `aria-label` and never a
 * combobox's or listbox's other options. Chromium names `<label><input
 * type="checkbox"> Flash the screen <input value="3" aria-label="n"> times
 * </label>` "Flash the screen 3 times".
 *
 * A control holding no value lends its own name instead, as Chromium does:
 * `<h2>Save <input placeholder="Draft"> now</h2>` is "Save Draft now", and a
 * `<button aria-labelledby>` over `<label for="e">Email</label><input id="e">`
 * is "Email". Not one that lends only its value ({@link lendsValueOnly}).
 *
 * A sensitive field's value, the choice in its popup, and in strict mode any
 * value, is withheld ({@link withholdsLentValue}): the whole name reads
 * `[redacted]` (see {@link NameRun.withheld}), as the native producer reads a
 * name built around such a field. A name is markup, which neither withholds.
 */
function embeddedControlText(
  element: Element,
  role: string,
  run: NameRun,
  at: ControlRead,
): string | null {
  if (!EMBEDDED_VALUE_ROLES.has(role)) return null;
  const text = collapseAscii(
    embeddedValue(
      element,
      role,
      (option) => computeAccessibleName(option, run, at.styleCache),
      at.styleCache ?? undefined,
    ),
  );
  if (!text) {
    return lendsValueOnly(element, role)
      ? ""
      : computeAccessibleName(element, run, at.styleCache, at.inReference);
  }
  return withholdsLentValue(element, role, run.redactInput)
    ? withhold(run)
    : text;
}

/**
 * What a name-from-content barrier lends the walk it sits in
 * ({@link isNameBarrierElement}, with the role in hand): a control the user
 * adjusts its value or name ({@link embeddedControlText}), unless it is the
 * control being named (see `NameRun.named`), and any other barrier nothing.
 * `null` when `element` is no barrier.
 */
function barrierText(
  element: Element,
  role: string,
  run: NameRun,
  at: ControlRead,
): string | null {
  const embedded =
    element === run.named ? null : embeddedControlText(element, role, run, at);
  if (embedded !== null) return embedded;
  return NAME_BARRIER_ROLES.has(role) && !isImplicitDetailsGroup(element)
    ? ""
    : null;
}

/**
 * The text an aria-labelledby (or aria-describedby) reference borrows from its
 * target: the target's own alternative where it has one, else its content.
 * Chromium reads `<button aria-labelledby="i">` over `<img id="i" alt="Direct">`
 * as "Direct", and over `<span id="s" aria-label="Lab">content</span>` as "Lab".
 * The target itself is read even when hidden — accname's "directly referenced"
 * carve-out — and then so is everything inside it, hidden or not: Chromium
 * reads `<span id="l" hidden>foo <span hidden>bar</span></span>` as "foo bar".
 * Inside a visible target, hidden content still contributes nothing.
 *
 * Unlike a descendant, a target with no name lends its content even when it
 * is an image, since accname §2F reads the content of any element a reference
 * names: Chromium reads `<span id="t" role="img">Revenue up</span>` as
 * "Revenue up", as a label or a description.
 *
 * The rest of the target's own name comes with it, as Chromium computes it:
 * a control the user adjusts lends its value, else its name
 * ({@link embeddedControlText}), and anything else its `<label>`s, a button
 * input's value, its content and last its `title` (AccName 2I), so a button
 * over `<label for="c">Agree</label><input type="checkbox" id="c">` is
 * "Agree", and over `<span id="t" title="Help"></span>` "Help".
 */
function referenceText(
  target: Element,
  run: NameRun,
  styleCache?: StyleCache | null,
): string {
  const walk: NameWalk = referenceWalk(target, styleCache);
  const role = getImplicitRole(target);
  const control = embeddedControlText(target, role, run, {
    ...walk,
    styleCache,
  });
  if (control !== null) return trimAscii(control);
  const tag = safeTagName(target);
  // Trimmed before the title is weighed: content that is only whitespace, or
  // an empty box's spacing, names nothing, so `<span title="Help"> </span>`
  // still lends "Help".
  return trimAscii(
    textAlternative(target, role, run, styleCache, walk) ||
      labelsText(target, tag, run, styleCache) ||
      host.inputValueName(target, tag) ||
      trimAscii(getAccessibleTextContent(target, run, styleCache, walk)) ||
      host.tooltipText(target, tag),
  );
}

/** The names of every element `element`'s aria-labelledby resolves to. */
function labelledByText(
  element: Element,
  run: NameRun,
  styleCache?: StyleCache | null,
): string {
  const labelledBy = safeGetAttribute(element, "aria-labelledby");
  if (!labelledBy) return "";
  const doc = idScope(element);
  return labelledBy
    .split(/\s+/)
    .map((id) => {
      const target = safeGetElementById(doc, id);
      if (!target) return "";
      if (readsSensitivePopup(element, target, "labelledby"))
        return withhold(run);
      return referenceText(target, run, styleCache);
    })
    .filter(Boolean)
    .join(" ");
}

/**
 * The text of an `<svg>`'s first `<title>` child, which names it (SVG-AAM).
 * Read with the same walk as any name, never `textContent`: a `<textarea>`'s
 * markup text inside the title is its default value, and no name may carry it
 * (see flat-tree's `isTextarea`).
 */
function svgTitle(
  element: Element,
  run: NameRun,
  styleCache: StyleCache | null | undefined,
  walk: NameWalk,
): string {
  for (const child of element.children) {
    if (safeTagName(child) === "title") {
      return trimAscii(getAccessibleTextContent(child, run, styleCache, walk));
    }
  }
  return "";
}

/**
 * Recursive text-content walker for accessible name/description computation.
 *
 * Per WAI-ARIA accname-1.2 §4.3.2 step 2A, hidden subtrees contribute the
 * empty string. Skip element descendants that are aria-hidden, hidden,
 * inert, or display/content-visibility-hidden. `visibility: hidden` and
 * `collapse` drop only an element's own text (see {@link TextVisibility}). A skipped descendant
 * that still RENDERS contributes a separator even so, because its box keeps the
 * text either side of it apart — see {@link needsSpaceAround}. (A skipped child
 * is not recursed into, so a `display: contents` one whose own children render
 * blocks contributes no separator; obscure, and left as is.)
 *
 * Also skips descendants whose computed role is in `NAME_BARRIER_ROLES` —
 * see the set's docstring for the reasoning (treeitem-in-group, nested
 * widgets, etc.).
 *
 * Every other child lends its own text alternative ahead of its content
 * (accname §2F.iii): its aria-labelledby, its aria-label, an image's alt — see
 * {@link textAlternative}. Only a child with none of those is walked for its
 * text.
 *
 * Walks `flatChildNodes`, which gives a closed `<details>` its summary alone.
 * Its body isn't hidden by any style on its own nodes (a UA slot does it), so
 * the per-child hidden check couldn't catch it: a bare text node there would
 * otherwise leak into the name.
 *
 * The root element itself is NOT checked — callers reach this with an
 * element that is either already exposed to AT (name-from-content) or
 * directly referenced by aria-labelledby / a host-language label (the
 * spec's "directly referenced" carve-out).
 */
function getAccessibleTextContent(
  element: Element,
  run: NameRun,
  styleCache?: StyleCache | null,
  walk: NameWalk = {},
): string {
  const textVisible = rootTextVisible(walk, element, styleCache);
  const read: ControlRead = { ...walk, styleCache };
  // accname 2F: generated content, and the rendered `text-transform`.
  const gen = readGeneratedText(element, textVisible !== false, styleCache);
  let text = gen.before;
  for (const child of flatChildNodes(element)) {
    const type = safeNodeType(child);
    if (type === Node.TEXT_NODE) {
      if (textVisible !== false) text += gen.transform(nameText(child, run));
    } else if (type === Node.ELEMENT_NODE) {
      const childEl = child as Element;
      // A child that cannot be read costs its own text, not the host's name.
      // The walk's per-element boundary skips an element that throws, but a
      // throw here lands on the HOST being named, so the heading, link or
      // button went with everything in it. A `<form>` whose controls shadow
      // what is read of it does that: `<input name="nodeType">` lets the walk
      // into the form, and a second control named `getAttribute` throws once
      // it is in. Skip that element, as the boundary would.
      try {
        const childStyle = getCachedComputedStyle(childEl, styleCache);
        // Checked before aria-hidden so that `display: none` and `[hidden]`,
        // which generate no box, contribute no separator either — Chromium reads
        // `<h1>Save<div style="display:none">x</div>now</h1>` as "Savenow".
        //
        // Known gap, left alone deliberately: `inert` and
        // `content-visibility: hidden` are hidden from AT but still RENDER, so
        // Chromium spaces across them ("Save now") where this returns "Savenow".
        // Closing it means teaching this check to tell the two kinds of hidden
        // apart — a different question from how a child's box spaces its
        // neighbours, and one that predates this rule, so it is its own change.
        // Chromium's tree puts an area under its image, never under the element
        // its map sits in, so it adds nothing to that element's name — and no
        // separator either: it renders no box of its own. Checked before
        // `isSubtreeHidden`, which for an `<area>` goes looking for the image
        // using its map; the answer cannot change the outcome here.
        if (childEl.localName === "area") continue;
        if (
          walk.inReference !== "hidden" &&
          isSubtreeHidden(childEl, childStyle)
        )
          continue;
        // A child that has a box of its own separates the text either side of it
        // whether or not it contributes any text — Chromium reads
        // `<h1>Save<div aria-hidden="true">x</div>now</h1>` as "Save now".
        const spaced = needsSpaceAround(childEl, childStyle);
        if (isAriaHiddenChild(childEl, walk)) {
          if (spaced) text += " ";
          continue;
        }
        const role = getImplicitRole(childEl);
        // `visibility: hidden` / `collapse` (accname §2A). Its box still keeps
        // its neighbours apart, and a descendant may be visible again, but it
        // lends no alternative of its own: no aria-label, no widget name.
        const childWalk = childTextWalk({ ...walk, textVisible }, childStyle);
        if (childWalk.textVisible === false) {
          text += hiddenChildText(childEl, spaced, () =>
            getAccessibleTextContent(childEl, run, styleCache, childWalk),
          );
          continue;
        }
        // Named widgets contribute their computed name (accname §2F.iii). One
        // named by its text is spaced by the same box rule as everything else:
        // Chromium reads `<h2>Signed in as <a href="/u">Ada</a>'s profile</h2>`
        // as "Signed in as Ada's profile", not "… Ada 's profile", and only
        // spaces the link when it renders as its own block. One named by an
        // attribute is always spaced, like any other attribute-borne text
        // (see textAlternative): `<h2>Go to<a href="/" aria-label="Home">H</a>now</h2>`
        // is "Go to Home now", the same link named by its text "Go toHomenow".
        if (NAMED_WIDGET_ROLES.has(role)) {
          const source: NameSource = {};
          const named = computeAccessibleName(
            childEl,
            run,
            styleCache,
            walk.inReference,
            source,
          );
          // An editing host takes no name from its own content, but Chromium
          // still reads that text into an ancestor's name:
          // `<h2>Before <button contenteditable>Save</button></h2>` is
          // heading "Before Save".
          const name =
            named ||
            (isEditingHost(childEl)
              ? getAccessibleTextContent(childEl, run, styleCache, walk)
              : "");
          text += spaced || (named && !source.fromContent) ? ` ${name} ` : name;
          continue;
        }
        // A barrier's box keeps its neighbours apart even when it lends no
        // text: Chromium reads `<h1>Save<input>now</h1>` as "Save now".
        const barrier = barrierText(childEl, role, run, read);
        if (barrier !== null) {
          text += spaced ? ` ${barrier} ` : barrier;
          continue;
        }
        const alternative = walk.textOnly
          ? null
          : textAlternative(childEl, role, run, styleCache, walk);
        if (alternative !== null) {
          // Spaced whatever the box: Chromium reads `<a><img alt="Help">center</a>`
          // as "Help center" and `<a><span aria-label="Docs">D</span>site</a>`
          // as "Docs site". A nameless image lends no text, only its box.
          text += alternative ? ` ${alternative} ` : spaced ? " " : "";
          continue;
        }
        const inner = getAccessibleTextContent(
          childEl,
          run,
          styleCache,
          childWalk,
        );
        // Padded per accname §2F, which appends each descendant's result "with a
        // space"; the final normalization collapses the doubles. A child that
        // flows inline is NOT padded, because that is what Chromium reads:
        // `<button><span>Sa</span><span>ve</span></button>` is one word "Save",
        // while `<button><div>Save</div><div>now</div></button>` is "Save now".
        // The pad does not depend on `inner`: an empty block still separates its
        // neighbours ("Save<div></div>now" is "Save now").
        text += spaced ? ` ${inner} ` : inner;
      } catch (error) {
        warnSkippedElement(childEl, error);
      }
    }
  }
  return text + gen.after;
}

/** Compute the accessible name for an element (simplified) */
/**
 * Accessible name, whitespace-normalized as Chromium and the AccName WPT
 * text-node cases do: collapse runs of ASCII whitespace — including the stray
 * newlines/indentation some pages leave inside their markup — to a single
 * space, and trim ASCII whitespace only, so a U+00A0 is kept. Normalizing
 * at this single source means every surface (panel, search, serializer,
 * snapshots) sees the same clean name.
 */
function computeAccessibleName(
  element: Element,
  run: NameRun,
  styleCache?: StyleCache | null,
  inReference: boolean | "hidden" = false,
  source?: NameSource,
): string {
  return collapseAscii(
    computeRawAccessibleName(element, run, styleCache, inReference, source),
  );
}

/**
 * The name a node records: a run of its own, read as
 * {@link REDACTED_VALUE} whole when anything in it was withheld (see
 * {@link NameRun.withheld}).
 */
function accessibleName(
  element: Element,
  styleCache: StyleCache,
  redactInput: boolean,
): string {
  // A label's own name leaves its control's value out, as the control's does.
  const control =
    safeTagName(element) === "label"
      ? (element as HTMLLabelElement).control
      : null;
  const run = newNameRun(redactInput, control ?? element);
  const name = computeAccessibleName(element, run, styleCache);
  return run.withheld ? REDACTED_VALUE : name;
}

/**
 * The text a form control's `<label>`s give it (step 4 of a name): HTML-AAM
 * joins every associated label in DOM order with spaces. Each label is read
 * once per computation, like any element under the visit-once guard: a
 * heading that holds a checkbox and its label is "Agree" in Chromium, not
 * "Agree Agree". "" for an element no label can name.
 */
function labelsText(
  element: Element,
  tag: string,
  run: NameRun,
  styleCache: StyleCache | null | undefined,
): string {
  if (!host.LABELED_TAGS.has(tag)) return "";
  const id = safeGetAttribute(element, "id");
  // Every `<label for>` in the control's tree, from the per-extraction index
  // rather than a query that rescans from the top for every control.
  const { labels, wrappingLabel } = associatedLabels(
    element,
    (id &&
      scopeReferenceIndex(styleCache, idScope(element)).labelFor.get(id)) ||
      [],
  );
  const labelParts: string[] = [];
  for (const label of labels) {
    if (run.visited.has(label)) continue;
    run.visited.add(label);
    const text =
      label === wrappingLabel
        ? wrappingLabelText(label, element, styleCache, {
            readText: (node) => nameText(node, run),
            readEmbedded: (child) =>
              embeddedControlText(child, getImplicitRole(child), run, {
                styleCache,
              }),
            readChild: (child, textVisible) =>
              // Each child's own alternative first, as in any name walk:
              // Chromium names `<label><img alt="Email"> <input></label>`
              // "Email". A `visibility: hidden` child lends none.
              (textVisible === false
                ? null
                : textAlternative(
                    child,
                    getImplicitRole(child),
                    run,
                    styleCache,
                    {},
                  )) ??
              getAccessibleTextContent(child, run, styleCache, {
                textVisible,
              }),
            onUnreadable: warnSkippedElement,
          })
        : trimAscii(getAccessibleTextContent(label, run, styleCache));
    if (text) labelParts.push(text);
  }
  return labelParts.join(" ");
}

function computeRawAccessibleName(
  element: Element,
  run: NameRun,
  styleCache: StyleCache | null | undefined,
  inReference: boolean | "hidden",
  source: NameSource | undefined,
): string {
  // accname visit-once guard (§4.3.2): an element the current name computation
  // has already read contributes the empty string when reached again.
  // Without this, an aria-labelledby that points at an ancestor containing the
  // element cycles between labelledby resolution and name-from-content until
  // the stack overflows (seen on real pages, e.g. the mercadolibre signup).
  //
  // Not inside a reference traversal, where Chromium skips it too: an element
  // two IDREFs reach is read for each, so `aria-labelledby="a a"` over
  // `<span id="a">Pick <a href="/">Docs</a></span>` is "Pick Docs Pick Docs".
  // That cannot cycle. A traversal follows no aria-labelledby (step 1), and
  // the only way out of the subtree it walks is a control's <label> (step 4),
  // whose content is read with this guard on.
  if (run.visited.has(element) && !inReference) return "";
  run.visited.add(element);

  // 1. aria-labelledby is resolved before aria-label (accname-1.2 §2B
  //    precedes §2D): concatenate the accessible names of every referenced
  //    IDREF, in order. The visit-once guard above breaks reference cycles.
  //    Not inside another reference traversal, where it is ignored (§2B).
  if (!inReference) {
    const labelledBy = labelledByText(element, run, styleCache);
    if (labelledBy) return labelledBy;
  }

  // 2. aria-label, unless it is blank: accname skips one that is only
  //    whitespace, as Chromium does. `<button aria-label=" ">Save</button>` is
  //    "Save", `<img aria-label=" " alt="Home">` "Home".
  const ariaLabel = trimAscii(safeGetAttribute(element, "aria-label") ?? "");
  if (ariaLabel) return ariaLabel;

  const tag = safeTagName(element);

  // 3. alt attribute for images. An empty alt is an intentional "no name"
  //    and stops here — EXCEPT when a `title` is also present. HTML-AAM keeps
  //    such an image exposed (see the img entry in ROLE_MAP) and names it from
  //    the title, so returning "" here would leave an exposed, nameless image.
  //    Scoped to <img>, the element whose role the empty alt also changes;
  //    <area> keeps its existing behaviour.
  if (tag === "img" || tag === "area") {
    const alt = safeGetAttribute(element, "alt");
    const titleNamesEmptyAlt =
      tag === "img" &&
      alt === "" &&
      !!safeGetAttribute(element, "title")?.trim();
    if (alt !== null && !titleNamesEmptyAlt) return alt;
  }

  // 3a. An <svg> is named by its first <title> child (SVG-AAM), after
  //     aria-label: Chromium names `<svg><title>Close</title></svg>` "Close",
  //     and `<svg aria-label="Shut"><title>Close</title></svg>` "Shut".
  if (tag === "svg") {
    const title = svgTitle(element, run, styleCache, { inReference });
    if (title) return title;
  }

  // 4. Label elements for form controls (see labelsText), then 5. a button
  //    input's value or alt (see inputValueName). Steps 4a–4c name other
  //    elements than these, so this order is theirs too.
  const hostName =
    labelsText(element, tag, run, styleCache) ||
    host.inputValueName(element, tag);
  if (hostName) return hostName;

  // 4a. Fieldset and details — accessible name comes from the direct <legend>
  //     or <summary> child.
  const nameChild =
    tag === "fieldset" ? "legend" : tag === "details" ? "summary" : null;
  const nameEl = nameChild && element.querySelector(`:scope > ${nameChild}`);
  if (nameEl)
    return trimAscii(getAccessibleTextContent(nameEl, run, styleCache));

  // 4b. The `label` attribute names an <option> or <optgroup> (HTML-AAM).
  const attrName = host.labelAttributeName(element, tag);
  if (attrName) return attrName;

  // 4c. Table — HTML-AAM names it from `HTMLTableElement.caption`. Hidden
  // captions must not name it (accname §4.3.2 step 2A); an empty caption
  // must fall through so `title` can still win.
  if (tag === "table") {
    const caption = (element as HTMLTableElement).caption;
    if (caption) {
      const hidden =
        isAriaHiddenValue(safeGetAttribute(caption, "aria-hidden")) ||
        isSubtreeHidden(caption, getCachedComputedStyle(caption, styleCache));
      if (!hidden) {
        const t = trimAscii(getAccessibleTextContent(caption, run, styleCache));
        if (t) return t;
      }
    }
  }

  // 8. Recursive text content — ONLY for elements whose ARIA role supports
  //    "name from content" (headings, links, buttons, checkboxes, table cells,
  //    options — see NAMES_FROM_CONTENT_ROLES). NOT for generic containers
  //    (div, span, p) which would grab huge text blobs.
  if (!MEDIA_TAGS.has(tag) && isNameFromContentHost(element)) {
    const fullText = trimAscii(
      getAccessibleTextContent(element, run, styleCache, {
        inReference,
        textOnly: tag === "option",
      }),
    );
    if (fullText) {
      if (source) source.fromContent = true;
      return fullText;
    }
  }

  // Strict mode withheld what a step above read: the name reads `[redacted]`
  // whole, so `title` is no fallback. Left unread, it stays the description it
  // would be beside that name.
  if (run.withheld) return "";

  // 6, 6a, 7. title, an image input's default, placeholder (see tooltipText).
  const tooltip = host.tooltipText(element, tag, source);
  if (tooltip) return tooltip;

  // Media elements never name from content: their light-DOM children are
  // unrendered fallback ("Sorry, your browser doesn't support…") plus
  // <track>/<source> metadata. Without this guard the fallback text leaked
  // in as the accessible name via the direct-text step below. Chromium
  // exposes an unlabeled <video> with an empty name — mirror that.
  if (MEDIA_TAGS.has(tag)) return "";

  // 9. Fallback: the element's own text — for generics and prose, never for
  //    a role only an author can name (see AUTHOR_NAMED_ROLES). For a
  //    sectionheader/sectionfooter that also keeps a byline from making the
  //    header "named" and so kept in the a11y view, where the native producer
  //    drops it as bare. Nor for an editing host: its text is what the user
  //    typed — its VALUE (ADR-0001), which never doubles as its name. Chromium
  //    leaves an editing host of any role unnamed by its content (see
  //    isNameFromContentHost, which gates step 8 the same way).
  const role = getImplicitRole(element);
  if (AUTHOR_NAMED_ROLES.has(role) || isEditingHost(element)) return "";
  // In strict mode, text a user typed is this element's own text alone: the
  // native producer blanks such text runs, so a typed paragraph reads unnamed
  // there, and here. Read through a run of its own, so the element's name
  // isn't `[redacted]`: each text node is asked, which also catches editor
  // text slotted into a shadow tree, where the element itself isn't editable.
  const own = run.redactInput ? newNameRun(true) : null;
  const read = own ? (node: Node) => nameText(node, own) : textOf;
  const ownText = readsTextRuns(role)
    ? trimAscii(getOwnText(element, styleCache, read))
    : getDirectTextContent(element, read);
  if (own?.withheld) return "";
  if (ownText) {
    if (source) source.fromContent = true;
    return ownText;
  }

  return "";
}

/** A text node's text, as the default mode reads it into a name. */
const textOf = (node: Node): string => node.textContent || "";

/** Get direct text content of an element, excluding child element text */
function getDirectTextContent(
  element: Element,
  readText: (node: Node) => string = textOf,
): string {
  let text = "";
  for (const child of flatChildNodes(element)) {
    if (safeNodeType(child) === Node.TEXT_NODE) {
      text += readText(child);
    }
  }
  return trimAscii(text);
}

/**
 * Get the element reference map — shared across extractions, and across every
 * copy of this package in the realm.
 *
 * The second half is load-bearing. `dispatch()` in `@real-a11y-dev/testing`
 * turns a node id back into a live `Element` through this map, and the
 * extraction that filled it usually happened in a different package. Every
 * published package bundles its own copy of the engine, so a per-module map
 * means the reader looks in one object and the writer wrote to another: the
 * lookup misses and the action silently does nothing.
 */
export function getElementRefs(): ElementRefMap {
  return realmSingleton(
    "element-refs",
    ELEMENT_REF_MAP_SHAPE,
    () => new ElementRefMap(),
  );
}

/**
 * Resolve the element that actually holds focus in `doc`, or `null` when
 * nothing meaningful does.
 *
 * Two normalizations matter:
 *  - Focus resting on `<body>`/`<html>` (or `null`) is the *absence* of focus,
 *    not "the body is focused" — treat it as none, so a fresh page produces no
 *    marker and committed snapshots don't churn.
 *  - `document.activeElement` reports the shadow *host* when focus is inside a
 *    shadow tree; descend through nested roots to the real target.
 */
export function resolveFocusedElement(doc: Document | null): Element | null {
  if (!doc) return null;
  let active: Element | null = doc.activeElement;
  if (!active || active === doc.body || active === doc.documentElement) {
    return null;
  }
  while (active.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return active;
}

/**
 * The id of the focused element, kept only if that element was captured as a
 * node in `nodes` (i.e. it's inside the extracted subtree). `findId` is a pure
 * reverse lookup — an element never walked in this extraction has no id here,
 * and a stale id from a prior extraction fails the `nodes.has` membership check.
 */
function focusedNodeId(
  root: Element,
  nodes: Map<string, SemanticNode>,
): string | undefined {
  const el = resolveFocusedElement(safeOwnerDocument(root));
  if (!el) return undefined;
  const id = getElementRefs().findId(el);
  return id && nodes.has(id) ? id : undefined;
}

/**
 * Options for {@link extractDomTree}. Primarily for internal incremental
 * extraction; the public single-argument form is unchanged.
 */
export interface ExtractDomTreeOptions extends RedactInputOption {
  /** Existing nodes map to update in-place. When provided, extraction is partial. */
  nodes?: Map<string, SemanticNode>;
  /** Parent id for the root of this partial extraction. */
  parentId?: string | null;
  /** Depth offset for the root of this partial extraction. */
  baseDepth?: number;
  /** Whether to compute the focused element id. Default true for full extractions. */
  includeFocused?: boolean;
}

/** What one extraction carries to every node it builds. */
interface Extraction {
  /** Fresh per extraction: styles may change between two of them. */
  readonly styleCache: StyleCache;
  readonly redactInput: boolean;
  /** Fresh per extraction, like `styleCache`: an ancestor's preview reuses its children's. */
  readonly descendantText: DescendantTextMemo;
}

/**
 * Build the semantic node for `element`, or return `null` to skip it (and,
 * by extension, its subtree).
 *
 * The whole body runs inside a try/catch so that a single pathological
 * element cannot abort the ENTIRE extraction. The reported crash was DOM
 * clobbering: on a `<form>` (the one element with `[LegacyOverrideBuiltIns]`)
 * a child named `tagName` — `<input name="tagName">` — shadows
 * `element.tagName`, so `.toLowerCase()` threw, and with no per-element
 * boundary the walk unwound completely and the panel hung on "Connecting to
 * page…" forever. The targeted guards (`getAttribute("id")`, the `safe*`
 * reads) defuse the plausible cases; this boundary is the catch-all for the
 * rest — including future unknown clobbering — degrading to "skip this node"
 * instead of losing the whole tree.
 *
 * A shadowed `tagName` or `getAttribute` no longer reaches this boundary: every
 * read of the element being built goes through `safeTagName` and
 * `safeGetAttribute`, so such a form keeps its fields and buttons. The boundary
 * stays for clobbering nobody has found yet.
 *
 * Nothing here mutates `nodes` / the element ref map; the caller commits the node
 * only on success, so a caught element never leaves a half-built node behind.
 */
function buildNode(
  element: Element,
  parentId: string | null,
  depth: number,
  { styleCache, redactInput, descendantText }: Extraction,
): { id: string; node: SemanticNode } | null {
  try {
    const tag = safeTagName(element);
    if (SKIP_TAGS.has(tag)) return null;

    // Skip Semantic Navigator internal elements (highlight overlay, curtain, etc.)
    // Read the id via getAttribute, not the `.id` property: on a <form> (or the
    // legacy named-property elements) a child named `id` clobbers `element.id`
    // to return that element, so `.id.startsWith(...)` would throw a TypeError
    // and crash the whole extraction. getAttribute always yields a string|null.
    if (safeGetAttribute(element, "id")?.startsWith("__sn-")) return null;
    // Through the prototype: every element is asked this, and on a <form>
    // holding `<input name="hasAttribute">` the method is that input.
    if (safeGetAttribute(element, PANEL_HOST_ATTRIBUTE) !== null) return null;

    // Resolve style once for this element — subtree-hidden / visually-hidden /
    // AT-hidden / sr-only all share the declaration via the per-extraction cache.
    const style = getCachedComputedStyle(element, styleCache);

    // Skip entire subtrees of display:none / hidden elements
    if (isSubtreeHidden(element, style)) return null;

    // An `aria-describedby` target is NOT folded into its referrer. A
    // description is a property of the referrer; it does not take the target
    // out of the page. WAI-ARIA 1.2 §7.2 requires an accessible object for a
    // non-hidden element whose id another element references, and Chromium
    // keeps the paragraph, heading or list as a node, so the description text
    // simply appears twice. Hidden targets are skipped above and still feed
    // the referrer's description.

    const id = getNodeId(element);
    const role = getImplicitRole(element);
    // Strict mode decides at the read: what it withholds is never computed.
    const value = redactInput
      ? undefined
      : getAnnouncedValue(element, role, styleCache);
    const actions = getActions(element);
    const focusable = isFocusable(element, style);
    const headingLevel = getHeadingLevel(element);
    const isMedia = MEDIA_TAGS.has(tag);
    const states = getAriaStates(element, role, focusable);

    const node: SemanticNode = {
      id,
      parentId,
      childIds: [],
      depth,
      dom: {
        tagName: tag,
        attributes: getKeyAttributes(element, redactInput),
        ...textPreviews(element, isMedia || redactInput, descendantText),
        isHidden: isVisuallyHidden(element, style),
      },
      a11y: {
        role,
        name: accessibleName(element, styleCache, redactInput),
        description: withholdPopupDescription(
          element,
          computeAccessibleDescription(element, styleCache, redactInput),
        ),
        ...(value !== undefined ? { value } : {}),
        states: withholdStates(element, role, states, redactInput),
        properties: {
          ...(headingLevel !== null ? { level: String(headingLevel) } : {}),
          // The walk doesn't descend into media children, so the one
          // a11y-critical signal that lives there — does this media ship
          // a captions/subtitles track? (WCAG 1.2.2) — is hoisted onto
          // the media node itself.
          ...(isMedia
            ? { captions: hasCaptionsTrack(element) ? "true" : "false" }
            : {}),
        },
        isExposedToAT: !isHiddenFromAT(element, style),
      },
      interaction: {
        isInteractive: actions.length > 0,
        actions,
        isFocusable: focusable,
        isEditable:
          (tag === "input" &&
            TEXT_INPUT_TYPES.has(
              (element as HTMLInputElement).type || "text",
            )) ||
          tag === "textarea" ||
          isEditingHost(element),
      },
      ui: {
        expanded: depth < 2,
        highlighted: false,
        matchesFilter: true,
        selected: false,
      },
    };

    return { id, node };
  } catch (error) {
    // One bad element must not take down the walk. Skip it and its subtree;
    // siblings and ancestors still extract.
    warnSkippedElement(element, error);
    return null;
  }
}

/**
 * A node's `dom` text previews. None for media, whose children are unrendered
 * fallback and <track>/<source> metadata: "Sorry, your browser doesn't
 * support…" as a preview would misrepresent what AT renders. None in strict
 * mode either, which keeps what a user typed off every node, as the native
 * producer keeps no previews at all.
 */
function textPreviews(
  element: Element,
  none: boolean,
  memo: DescendantTextMemo,
): Pick<NonNullable<SemanticNode["dom"]>, "textContent" | "descendantText"> {
  return none
    ? { textContent: "", descendantText: "" }
    : {
        textContent: getDirectTextContent(element),
        descendantText: getDescendantText(element, memo),
      };
}

function walk(
  element: Element,
  parentId: string | null,
  depth: number,
  nodes: Map<string, SemanticNode>,
  extraction: Extraction,
): string | null {
  const built = buildNode(element, parentId, depth, extraction);
  if (!built) return null;
  const { id, node } = built;

  // Commit the finished node. Neither map write can throw, so a node that was
  // built successfully is never orphaned by a later failure.
  getElementRefs().set(id, element);
  nodes.set(id, node);

  // Media elements are leaves: their light-DOM children are unrendered
  // fallback content plus <track>/<source> metadata, none of which appear
  // in a real browser tree (Chromium's Video/Audio children are closed
  // UA-shadow controls we cannot reach). The captions signal from <track>
  // is hoisted onto the media node's `captions` property in buildNode.
  if (MEDIA_TAGS.has(node.dom!.tagName)) return id;

  // Walk children. Each child is isolated by buildNode's own boundary, so a
  // single pathological descendant can't take out its siblings or ancestors.
  // `flatChildren` leaves out what the browser doesn't render even though no
  // style on it says so: a light child no slot takes, a hidden slot's
  // assignment, and a closed <details>' body.
  for (const child of flatChildren(element)) {
    const childId = walk(child, id, depth + 1, nodes, extraction);
    if (childId) {
      node.childIds.push(childId);
    }
  }

  return id;
}

/** Extract a complete DOM tree from a root element */
export function extractDomTree(
  root: Element,
  options: ExtractDomTreeOptions = {},
): ExtractionResult {
  const nodes = options.nodes ?? new Map<string, SemanticNode>();
  const parentId = options.parentId ?? null;
  const baseDepth = options.baseDepth ?? 0;
  const isPartial = options.nodes != null;

  const effectiveRoot = isPartial ? root : resolveEffectiveRoot(root);

  const startRoot = isPartial ? root : effectiveRoot;
  // Fresh cache per extraction — styles may have changed since the last
  // mutation-triggered run; never reuse across extractDomTree calls.
  // Any truthy value: a privacy switch that a `"1"` left off would fail open.
  const redactInput = Boolean(options.redactInput);
  // One set of indexes for the whole walk (aria-owner.ts, choice-withholding).
  const rootId = withReadIndexes(startRoot, () =>
    walk(startRoot, parentId, baseDepth, nodes, {
      styleCache: new WeakMap(),
      descendantText: new WeakMap(),
      redactInput,
    }),
  );

  const includeFocused = options.includeFocused ?? !isPartial;
  const focusedId = includeFocused
    ? focusedNodeId(effectiveRoot, nodes)
    : undefined;
  return {
    nodes,
    rootId: rootId || "",
    ...(focusedId ? { focusedId } : {}),
    // Only a whole extraction vouches for its map: a partial one adds to nodes
    // someone else extracted, in whatever mode they used.
    source: treeSource("dom", { redactInput: redactInput && !isPartial }),
  };
}
