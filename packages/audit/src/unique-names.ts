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
  isNativeIframeRole,
  linearize,
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

/**
 * Roles compared only among their own container's items. A screen reader
 * announces a radio's group, an option's list box and a tab's tab list as
 * focus enters them, so the same "Yes" radio under two questions, or the same
 * option in two selects, is expected. Two in one container are not.
 */
const CONTAINED_NAME_ROLES: ReadonlySet<string> = new Set([
  "radio",
  "option",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "treeitem",
]);

/** The containers that scope {@link CONTAINED_NAME_ROLES}. A `<fieldset>` is a
 *  `group`, and so is a tree's nested level. A `<select>`'s options sit
 *  straight under its `combobox` in both producers. */
const NAME_SCOPE_CONTAINERS: ReadonlySet<string> = new Set([
  "radiogroup",
  "group",
  "listbox",
  "combobox",
  "tablist",
  "menu",
  "menubar",
  "tree",
  "treegrid",
]);

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
 * Walk up from `node` to where its name is compared: its container, for a
 * contained role, or the field or player that drew it (see
 * {@link CONTROL_HOST_ROLES}), else its document. A native tree's frame is a
 * document of its own (as `heading-order` treats it), so the walk stops at its
 * `Iframe` row: two embeds of one widget each have a "Play" button, and
 * neither is the page author's to rename.
 */
function placementOf(
  node: SemanticNode,
  tree: ExtractionResult,
  contained: boolean,
): Placement {
  const out: Placement = {};
  let id = node.parentId;
  while (id !== null) {
    const parent = tree.nodes.get(id);
    if (!parent) break;
    const role = parent.a11y.role;
    if (isNativeIframeRole(role)) {
      out.scope ??= parent;
      break;
    }
    const scopes =
      (contained && NAME_SCOPE_CONTAINERS.has(role)) ||
      CONTROL_HOST_ROLES.has(role);
    if (!out.scope && scopes) {
      out.scope = parent;
      out.container = role;
    }
    if (!out.landmark && LANDMARK_ROLES.has(role)) out.landmark = parent;
    id = parent.parentId;
  }
  return out;
}

/** Every named control the rule compares, in document order. */
function candidatesOf(tree: ExtractionResult): Candidate[] {
  const out: Candidate[] = [];
  for (const node of linearize(tree, { includeNotExposed: false })) {
    const role = node.a11y.role;
    const contained = CONTAINED_NAME_ROLES.has(role);
    if (!contained && !PAGE_UNIQUE_NAME_ROLES.has(role)) continue;
    const name = node.a11y.name.replace(/\s+/g, " ").trim();
    // An unnamed control is `no-unlabeled-interactive`'s to report.
    if (!name) continue;
    const { scope, container, landmark } = placementOf(node, tree, contained);
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

/**
 * A link's `href`, split into the origin it names, if it names one, and the
 * rest. `/docs` and `https://example.com/docs` on one page go to one place,
 * and the tree doesn't say which origin the page is on, so a path matches an
 * absolute URL with the same path and query. `#` and `javascript:` go nowhere
 * in particular: those links are scripted, and say nothing about what they do.
 */
function destinationOf(
  href: string | undefined,
): { origin?: string; rest: string } | undefined {
  const raw = href?.trim();
  if (!raw || raw === "#" || /^javascript:/i.test(raw)) return undefined;
  if (/^([a-z][a-z\d+.-]*:|\/\/)/i.test(raw)) {
    try {
      const url = new URL(raw, "https://relative.invalid/");
      return { origin: url.origin, rest: url.pathname + url.search + url.hash };
    } catch {
      // Not a URL after all: compare it as written.
    }
  }
  return { rest: raw };
}

/** How many places a group of same-named links goes to. A link without a
 *  destination ({@link destinationOf}) counts as one of its own. */
function destinationCount(group: readonly Candidate[]): number {
  const absolute = new Set<string>();
  const absolutePaths = new Set<string>();
  const relative = new Set<string>();
  let unknown = 0;
  for (const { node } of group) {
    const to = destinationOf(node.dom?.attributes["href"]);
    if (!to) unknown++;
    else if (to.origin === undefined) relative.add(to.rest);
    else {
      absolute.add(`${to.origin} ${to.rest}`);
      absolutePaths.add(to.rest);
    }
  }
  let count = absolute.size + unknown;
  for (const rest of relative) if (!absolutePaths.has(rest)) count++;
  return count;
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
 * `href` + nearest landmark, read from the tree rather than the live element,
 * so both producers say it. The landmark's name is what tells two "Edit"
 * buttons in two named regions apart. The `href` is whatever the tree kept
 * (both producers drop it inside an editor in strict mode), without its query
 * or fragment: a reset or sign-in link carries its token there, and a native
 * finding printed no `href` at all before this rule.
 */
function contextOf({ node, landmark }: Candidate): string | undefined {
  const bits: string[] = [];
  const href = node.dom?.attributes["href"]?.replace(/[?#].*$/s, "");
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
