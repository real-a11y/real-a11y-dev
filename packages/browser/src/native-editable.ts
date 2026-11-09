/**
 * Strict mode (`redactInput`) redaction for rich-text editor content, split out
 * of `native-tree.ts`: which raw AX nodes are editable or inside an editable
 * region, and the copy of them with the typed text withheld. Pure functions
 * over raw AX nodes; no state.
 */

import {
  NATIVE_AX_NAME_SOURCE_ROLES,
  REDACTED_VALUE,
  carriesAXValue,
  cleanAXText,
  holdsContent,
  nativeAncestry,
  winningNameSource,
  type FieldStandIn,
  type NativeAXIndex,
  type RawAXNameNode as RawAXNode,
} from "@real-a11y-dev/core";

/**
 * The attributes allowed to name a node INSIDE an editable region. They are
 * the page's markup — an `aria-label` on a mention chip, an inserted image's
 * `alt`, a `title` — rather than the editor's text, and Chromium leaves them
 * out of the host's `value` too. Every other name source there (the node's
 * contents, a `<figcaption>` / `<caption>` / `<legend>`, an `aria-labelledby`
 * target) is, or can point at, what the user typed. An allowlist, so a source
 * Chromium adds later is withheld until someone decides otherwise.
 */
const MARKUP_NAME_ATTRIBUTES = new Set(["aria-label", "alt", "title"]);

/**
 * What a node inside an editable region is named when Chromium computed its
 * name from the editor's text. Constant, and deliberately not empty: an empty
 * name reads as UNLABELED, and a link or a cell in a message box is labeled —
 * `no-unlabeled-interactive` would report an error that isn't there. The same
 * literal the sensitivity policy substitutes for a withheld field value.
 */
const REDACTED_NAME = REDACTED_VALUE;

function isEditable(raw: RawAXNode): boolean {
  return (raw.properties ?? []).some((p) => p.name === "editable");
}

/** Roles whose value is the page's own state, never something a user entered. */
const PAGE_STATE_VALUE_ROLES: ReadonlySet<string> = new Set([
  "progressbar",
  "meter",
  "scrollbar",
]);

/**
 * Strict mode's value roots: every field whose value it withholds. That is
 * every node Chromium reports a value for — a text field, a `<select>`, a
 * slider, a file input, an editor — plus the root of every rich-text editing
 * region that holds text, since what is typed there reaches names as well as
 * the host's value.
 *
 * An EMPTY field or editor is not a root (see {@link holdsContent}): it
 * contributes nothing to a name built around it, and counting it would
 * withhold every row and cell name in a table of empty inputs.
 *
 * A field the tree has no node of its own for counts through what stands in
 * for it there, whatever its markup (core's `fieldStandIns`), so the value of
 * a disabled `role="none"` text field names no cell or label around it.
 */
export function strictValueRoots(
  rawNodes: RawAXNode[],
  index: NativeAXIndex,
  standIns: readonly FieldStandIn[],
): Set<string> {
  // What a user entered, not what the page reports: a progress bar, a meter
  // and a scrollbar hold the page's own state, and a media element's timeline
  // and volume are playback, not input. Counting them would withhold a
  // `<video>`'s name for containing its scrubber.
  const inMedia = (raw: RawAXNode): boolean => {
    for (const cur of nativeAncestry(raw, index.byId)) {
      const role = cur.role?.value;
      if (role === "Video" || role === "Audio") return true;
    }
    return false;
  };
  const roots = new Set<string>();
  for (const raw of rawNodes) {
    if (
      carriesAXValue(raw) &&
      !PAGE_STATE_VALUE_ROLES.has(raw.role?.value ?? "") &&
      !inMedia(raw)
    ) {
      roots.add(raw.nodeId);
    }
    if (!isEditable(raw)) continue;
    let root = raw;
    for (const cur of nativeAncestry(raw, index.byId)) {
      if (!isEditable(cur)) break;
      root = cur;
    }
    // An editing root counts only once something was typed into it: an empty
    // editor, like an empty text field, has nothing a name could borrow.
    if (holdsContent(root, index.byId, true)) roots.add(root.nodeId);
  }
  for (const { nodeIds } of standIns) {
    for (const id of nodeIds) {
      const raw = index.byId.get(id);
      if (raw && !inMedia(raw)) roots.add(id);
    }
  }
  return roots;
}

/**
 * True when `raw`'s name is exactly the text of one of the
 * {@link MARKUP_NAME_ATTRIBUTES}. The winning source is the first one in the
 * trace that produced text and wasn't superseded; requiring its text to equal
 * the computed name means a trace that disagrees with its own result — or is
 * missing, as in a payload recorded without it — fails closed.
 */
function authoredByMarkup(raw: RawAXNode): boolean {
  const name = cleanAXText(String(raw.name?.value ?? ""));
  const winner = winningNameSource(raw);
  return (
    winner?.type === "attribute" &&
    MARKUP_NAME_ATTRIBUTES.has(winner.attribute ?? "") &&
    cleanAXText(String(winner.value?.value)) === name
  );
}

/**
 * The raw nodes strictly INSIDE an editable region — below a node Chromium
 * marks `editable` (a contenteditable host, a `designMode` document, a native
 * text field). The region's own root is not inside it: that is the field
 * itself, whose authored label is kept and whose value is already withheld.
 *
 * Decided by nativeAncestry rather than by each node's own `editable` flag, because
 * a `contenteditable="false"` island (a mention chip, an embedded link) carries
 * no flag of its own but is still part of what the user wrote.
 */
function nodesInsideEditable(rawNodes: RawAXNode[]): Set<RawAXNode> {
  const byId = new Map(rawNodes.map((n) => [n.nodeId, n]));
  // nodeId → "this node, or one of its ancestors, is editable".
  const covered = new Map<string, boolean>();
  const isCovered = (start: RawAXNode | undefined): boolean => {
    const chain: string[] = [];
    let result = false;
    for (
      let cur = start;
      cur;
      cur = cur.parentId ? byId.get(cur.parentId) : undefined
    ) {
      const known = covered.get(cur.nodeId);
      if (known !== undefined) {
        result = known;
        break;
      }
      chain.push(cur.nodeId);
      if (isEditable(cur)) {
        result = true;
        break;
      }
      // A parent cycle is malformed input with no root to reach; treat what
      // it holds as inside rather than prove a negative about it.
      if (chain.length > rawNodes.length) {
        result = true;
        break;
      }
    }
    for (const id of chain) covered.set(id, result);
    return result;
  };

  const inside = new Set<RawAXNode>();
  for (const raw of rawNodes) {
    if (raw.parentId && isCovered(byId.get(raw.parentId))) inside.add(raw);
  }
  return inside;
}

/**
 * Strict mode (`redactInput`) for what a user typed into an editor. Returns a
 * copy of `rawNodes` (the input is never mutated) in which every node inside
 * an editable region ({@link nodesInsideEditable}) has lost the editor's text:
 *
 * - a text run (`StaticText` / `LabelText`) loses its name outright, so no
 *   later step — core's leaf promotion, or anything that reads a node's own
 *   text runs — can promote it into another node's name.
 * - any other node keeps a name only if the page's markup supplied it
 *   ({@link authoredByMarkup}); a name Chromium computed from the content
 *   becomes {@link REDACTED_NAME}.
 * - its description is dropped: with no trace of where it came from, it could
 *   be an `aria-describedby` pointing at typed text.
 *
 * Names OUTSIDE a region that carry what is in it — a node around an editor or
 * a filled field, named from its contents or by reference — are
 * {@link withholdRegionNames}' job, over {@link strictValueRoots}.
 *
 * Doing this before normalization, not after, is the point: after
 * normalization a promoted name no longer says which node it came from. The
 * AX `value` itself is left on each raw node, because core reads it to keep a
 * value out of names ({@link normalizeNativeAX}); strict mode withholds it by
 * never copying it to `a11y.value`.
 */
export function redactEditableContent(rawNodes: RawAXNode[]): {
  nodes: RawAXNode[];
  inside: Set<RawAXNode>;
} {
  const inside = nodesInsideEditable(rawNodes);
  if (inside.size === 0) return { nodes: rawNodes, inside };
  const redactedInside = new Set<RawAXNode>();
  const nodes = rawNodes.map((raw) => {
    if (!inside.has(raw)) return raw;
    const textRun = NATIVE_AX_NAME_SOURCE_ROLES.has(raw.role?.value ?? "");
    const computed = cleanAXText(String(raw.name?.value ?? ""));
    const name = textRun
      ? ""
      : computed === "" || authoredByMarkup(raw)
        ? computed
        : REDACTED_NAME;
    const { description: _dropped, ...rest } = raw;
    const redacted: RawAXNode = { ...rest, name: { value: name } };
    redactedInside.add(redacted);
    return redacted;
  });
  return { nodes, inside: redactedInside };
}

/** The editable roots' backend DOM ids — where {@link enrichFromDom} starts
 *  treating a subtree as the user's content (strict mode only). */
export function editableRootBackendIds(rawNodes: RawAXNode[]): Set<number> {
  const inside = nodesInsideEditable(rawNodes);
  const roots = new Set<number>();
  for (const raw of rawNodes) {
    if (
      isEditable(raw) &&
      !inside.has(raw) &&
      typeof raw.backendDOMNodeId === "number"
    ) {
      roots.add(raw.backendDOMNodeId);
    }
  }
  return roots;
}
