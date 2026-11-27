/**
 * `unique-interactive-names`: two controls of one role that share an
 * accessible name. A screen-reader user who hears only the name, in the Tab
 * order or in a list of the page's buttons or links, can't tell them apart.
 * No specification requires unique names, so the rule is a `warning`: best
 * practice under WCAG 2.4.6 and 2.4.9, not a 2.4.4 failure.
 *
 * Names are compared without their states (an expanded and a collapsed
 * "Options" are still two "Options") and without their descriptions, which
 * neither the Tab order nor an elements list reads.
 */
import {
  getElementRefs,
  isNativeIframeRole,
  linearize,
  REDACTED_VALUE,
  type ExtractionResult,
  type SemanticNode,
} from "@real-a11y-dev/core";

import { locate } from "./locate.js";

import type { Finding } from "./index.js";

/**
 * Roles compared across the whole document. A list of a page's buttons or
 * links gives each one its name and nothing else, so two that share a name
 * read the same wherever on the page they are.
 */
const PAGE_UNIQUE_NAME_ROLES: ReadonlySet<string> = new Set([
  "button",
  "link",
  "checkbox",
  "switch",
]);

const MENU_SCOPES: ReadonlySet<string> = new Set(["menu", "menubar", "group"]);

/**
 * Roles compared only among their own container's items, each with the
 * container roles that scope it. A screen reader announces a radio's group, an
 * option's list box and a tab's tab list as focus enters them, so the same
 * "Yes" radio under two questions, or the same option in two selects, is
 * expected. Two in one container are not. A `<select>`'s options sit straight
 * under its `combobox` in both producers. A `group` counts only as
 * {@link groupScopes} says.
 */
const NAME_SCOPES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["radio", new Set(["radiogroup", "group"])],
  ["option", new Set(["listbox", "combobox", "group"])],
  ["tab", new Set(["tablist"])],
  ["menuitem", MENU_SCOPES],
  ["menuitemcheckbox", MENU_SCOPES],
  ["menuitemradio", MENU_SCOPES],
  ["treeitem", new Set(["tree", "treegrid", "group"])],
]);

/**
 * Whether `group`, an ancestor of an item of `role`, scopes it. A named group
 * does (a `<fieldset>` with its legend, an `<optgroup>` with its label): its
 * name is announced. An unnamed one is only a wrapper, so two "Rename" items
 * in two unnamed groups of one menu are still one menu's. A tree's nested
 * level is the exception: the item it hangs from names it.
 */
function groupScopes(group: SemanticNode, role: string): boolean {
  return role === "treeitem" || group.a11y.name.trim() !== "";
}

/**
 * Fields and players that draw controls of their own inside themselves, which
 * a native tree shows: every date input has a "Show date picker" button and
 * every `<video controls>` a "play", in Chromium's user-agent shadow DOM. No
 * author can rename those, so a control inside one is compared only with the
 * others it draws. Raw Blink roles, as the native vocabulary keeps them: what
 * Chromium 14x puts controls under. Text, number and search fields show none,
 * and the DOM producer's fields have no children at all.
 */
const CONTROL_HOST_ROLES: ReadonlySet<string> = new Set([
  "video",
  "audio",
  "Date",
  "DateTime",
  "InputTime",
  "ColorWell",
]);

/** Landmark roles, for saying which part of the page a finding is in. */
const LANDMARK_ROLES: ReadonlySet<string> = new Set([
  "banner",
  "complementary",
  "contentinfo",
  "form",
  "main",
  "navigation",
  "region",
  "search",
]);

/** A control whose name is compared, and where. */
interface Candidate {
  node: SemanticNode;
  /** The name, whitespace collapsed. */
  name: string;
  /** Scope, role and folded name: the controls that share one are compared. */
  key: string;
  /** Role of the container or control host it is compared within. */
  container?: string;
  landmark?: SemanticNode;
}

/** Where a node's name is compared, and the nearest landmark it sits in. */
interface Placement {
  /** The node whose items it is compared with. */
  scope?: SemanticNode;
  container?: string;
  landmark?: SemanticNode;
}

/**
 * For a DOM tree, each node an `aria-owns` claims, mapped to its owner's node.
 * The DOM producer keeps an owned item where its markup is, while a screen
 * reader reads it inside its owner, as Chromium's own tree places it: a native
 * tree needs none of this. The first owner in document order wins.
 */
function ariaOwnersOf(tree: ExtractionResult): Map<string, SemanticNode> {
  const owners = new Map<string, SemanticNode>();
  if (tree.source?.producer !== "dom") return owners;
  const refs = getElementRefs();
  const nodeOf = new Map<Element, SemanticNode>();
  for (const node of tree.nodes.values()) {
    const el = refs.get(node.id);
    if (el) nodeOf.set(el, node);
  }
  for (const [el, owner] of nodeOf) {
    const ids = el.getAttribute("aria-owns")?.trim();
    if (!ids) continue;
    const root = el.getRootNode() as Document | ShadowRoot;
    for (const id of ids.split(/\s+/)) {
      const target = root.getElementById?.(id);
      const owned = target ? nodeOf.get(target) : undefined;
      if (owned && !owners.has(owned.id)) owners.set(owned.id, owner);
    }
  }
  return owners;
}

/** Whether `parent`, a node above an item of `role`, is where it's compared. */
function scopesItem(parent: SemanticNode, role: string): boolean {
  const parentRole = parent.a11y.role;
  if (CONTROL_HOST_ROLES.has(parentRole)) return true;
  if (!NAME_SCOPES.get(role)?.has(parentRole)) return false;
  return parentRole !== "group" || groupScopes(parent, role);
}

/**
 * Walk up from `node` to where its name is compared: its container, for a
 * contained role, or the field or player that drew it (see
 * {@link CONTROL_HOST_ROLES}), else its document. `up` is a node's owner when
 * an `aria-owns` claims it, else its parent. A native tree's frame is a
 * document of its own (as `heading-order` treats it), so the walk stops at its
 * `Iframe` row: two embeds of one widget each have a "Play" button, and
 * neither is the page author's to rename.
 */
function placementOf(
  node: SemanticNode,
  tree: ExtractionResult,
  up: (node: SemanticNode) => string | null,
): Placement {
  const out: Placement = {};
  const seen = new Set<string>();
  let id = up(node);
  while (id !== null && !seen.has(id)) {
    seen.add(id);
    const parent = tree.nodes.get(id);
    if (!parent) break;
    if (isNativeIframeRole(parent.a11y.role)) {
      out.scope ??= parent;
      break;
    }
    if (!out.scope && scopesItem(parent, node.a11y.role)) {
      out.scope = parent;
      out.container = parent.a11y.role;
    }
    if (!out.landmark && LANDMARK_ROLES.has(parent.a11y.role)) {
      out.landmark = parent;
    }
    id = up(parent);
  }
  return out;
}

/** Every named control the rule compares, in document order. */
function candidatesOf(tree: ExtractionResult): Candidate[] {
  const out: Candidate[] = [];
  const owners = ariaOwnersOf(tree);
  const up = (n: SemanticNode): string | null =>
    owners.get(n.id)?.id ?? n.parentId;
  for (const node of linearize(tree, { includeNotExposed: false })) {
    const role = node.a11y.role;
    if (!NAME_SCOPES.has(role) && !PAGE_UNIQUE_NAME_ROLES.has(role)) continue;
    const name = node.a11y.name.replace(/\s+/g, " ").trim();
    // An unnamed control is `no-unlabeled-interactive`'s to report. A name
    // strict mode withheld is the same marker whatever it hid, so two of
    // them say nothing about whether the real names match.
    if (!name || name === REDACTED_VALUE) continue;
    const { scope, container, landmark } = placementOf(node, tree, up);
    const key = JSON.stringify([
      scope?.id ?? tree.rootId,
      role,
      name.toLowerCase(),
    ]);
    out.push({
      node,
      name,
      key,
      ...(container ? { container } : {}),
      ...(landmark ? { landmark } : {}),
    });
  }
  return out;
}

/** Where a link goes, as far as its written `href` says. */
interface Destination {
  /** `absolute` names its scheme and origin; `path` starts at the site's
   *  root; `relative` starts where the page is, which the tree doesn't say. */
  kind: "absolute" | "path" | "relative";
  key: string;
  /** An absolute URL's path, query and fragment, to match a `path` with. */
  path?: string;
}

/** Scheme or protocol-relative: an `href` that says where it goes on its own. */
const ABSOLUTE_HREF = /^([a-z][a-z\d+.-]*:|\/\/)/i;

/** Path, query and fragment of `url`, normalized (`/./docs` is `/docs`). */
const restOf = (url: URL): string => url.pathname + url.search + url.hash;

/**
 * A link's destination. `/docs` and `https://example.com/docs` on one page go
 * to one place, and the tree doesn't say which origin the page is on, so a
 * `path` matches an absolute URL with the same path and query. An opaque
 * origin (`tel:`, `sms:`, `mailto:`) serializes as `null` for every scheme, so
 * the scheme stands in for it. `#` and `javascript:` go nowhere in particular:
 * those links are scripted, and say nothing about what they do.
 */
function destinationOf(href: string | undefined): Destination | undefined {
  const raw = href?.trim();
  if (!raw || raw === "#" || /^javascript:/i.test(raw)) return undefined;
  try {
    if (ABSOLUTE_HREF.test(raw)) {
      const url = new URL(raw, "https://relative.invalid/");
      const origin = url.origin === "null" ? url.protocol : url.origin;
      const path = restOf(url);
      return { kind: "absolute", key: `${origin} ${path}`, path };
    }
    const rooted = raw.startsWith("/");
    const base = `https://relative.invalid/${rooted ? "" : "page/"}`;
    return {
      kind: rooted ? "path" : "relative",
      key: restOf(new URL(raw, base)),
    };
  } catch {
    return { kind: "relative", key: raw };
  }
}

/** How many places a group of same-named links goes to. A link without a
 *  destination ({@link destinationOf}) counts as one of its own. */
function destinationCount(group: readonly Candidate[]): number {
  const keys = {
    absolute: new Set<string>(),
    path: new Set<string>(),
    relative: new Set<string>(),
  };
  const absolutePaths = new Set<string>();
  let unknown = 0;
  for (const { node } of group) {
    const to = destinationOf(node.dom?.attributes["href"]);
    if (!to) unknown++;
    else keys[to.kind].add(to.key);
    if (to?.path !== undefined) absolutePaths.add(to.path);
  }
  const paths = [...keys.path].filter((p) => !absolutePaths.has(p)).length;
  return keys.absolute.size + keys.relative.size + paths + unknown;
}

/** True when a group of same-named controls is one to report: two or more of
 *  them, or for links, two or more destinations. */
function ambiguous(group: readonly Candidate[]): boolean {
  if (group.length < 2) return false;
  return group[0]!.node.a11y.role !== "link" || destinationCount(group) > 1;
}

/** Cut `text` to the length the other rules print an `href` at. */
function clip(text: string): string {
  return text.length > 48 ? text.slice(0, 48) + "…" : text;
}

/**
 * An `href` as a finding may print it: without its query, its fragment or the
 * credentials in it. A reset or sign-in link carries its token in the query,
 * and a native finding printed no `href` at all before this rule. An absolute
 * one is parsed, so no spelling the URL parser accepts (leading spaces,
 * backslashes, an `@` in the password) keeps its credentials in.
 */
function printedHref(raw: string | undefined): string | undefined {
  const href = raw?.trim();
  if (!href) return undefined;
  if (ABSOLUTE_HREF.test(href)) {
    try {
      const url = new URL(href, "https://relative.invalid/");
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      return url.href;
    } catch {
      // Not a URL after all: cut it as written, below.
    }
  }
  return href
    .replace(/[?#].*$/s, "")
    .replace(/^([a-z][a-z\d+.-]*:)?[\\/]{2}[^\\/]*@/i, "$1//");
}

/**
 * `href` + nearest landmark, read from the tree rather than the live element,
 * so both producers say it. The landmark's name is what tells two "Edit"
 * buttons in two named regions apart. The `href` is whatever the tree kept
 * (both producers drop it inside an editor in strict mode), as
 * {@link printedHref} cuts it.
 */
function contextOf({ node, landmark }: Candidate): string | undefined {
  const bits: string[] = [];
  const href = printedHref(node.dom?.attributes["href"]);
  if (href) bits.push(`href="${clip(href)}"`);
  if (landmark) {
    const name = landmark.a11y.name.trim();
    const role = landmark.a11y.role;
    bits.push(name ? `in <${role} "${clip(name)}">` : `in <${role}>`);
  }
  return bits.length ? bits.join(" · ") : undefined;
}

/** The finding for one control of an ambiguous group. No count in the
 *  message: adding a third copy must not change the first two findings. */
function findingFor(candidate: Candidate, locator?: string): Finding {
  const { node, name, container } = candidate;
  const role = node.a11y.role;
  // A control host's role is Chromium's own (`InputTime`), not one to print.
  const within = !container
    ? ""
    : CONTROL_HOST_ROLES.has(container)
      ? " in the same field or player"
      : ` in this ${container}`;
  const others =
    role === "link"
      ? `another link named "${name}" goes somewhere else`
      : `another ${role}${within} is also named "${name}"`;
  const tag = node.dom?.tagName;
  const context = contextOf(candidate);
  return {
    rule: "unique-interactive-names",
    severity: "warning",
    role,
    name,
    ...(tag ? { tagName: tag } : {}),
    message: `Duplicate accessible name: ${others}. A screen-reader user who hears only the name can't tell them apart; give each a name of its own (best practice, WCAG 2.4.6 and 2.4.9).`,
    ...(locator ? { locator } : {}),
    ...(context ? { context } : {}),
  };
}

/**
 * Append a `unique-interactive-names` finding for each control that shares
 * its name, one per control so each has its own locator.
 */
export function uniqueInteractiveNamesFindings(
  tree: ExtractionResult,
  findings: Finding[],
): void {
  const candidates = candidatesOf(tree);
  const groups = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.key);
    if (group) group.push(candidate);
    else groups.set(candidate.key, [candidate]);
  }
  const reported = new Set<string>();
  for (const [key, group] of groups) if (ambiguous(group)) reported.add(key);
  for (const candidate of candidates) {
    if (!reported.has(candidate.key)) continue;
    findings.push(findingFor(candidate, locate(candidate.node, tree).locator));
  }
}
