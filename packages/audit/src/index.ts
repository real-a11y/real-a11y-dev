import {
  buildCssPath,
  DOM_ELEMENT_ADAPTER,
  extractA11yTree,
  findAllByRole,
  getElementRefs,
  getOutline,
  linearize,
  ROLE_FILTER_GROUPS,
  type ExtractionResult,
  type SemanticNode,
} from "@real-a11y-dev/core";

/** Roles we consider intrinsically interactive for labeling checks. */
export const INTERACTIVE_ROLES: ReadonlySet<string> = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "combobox",
  "listbox",
  "checkbox",
  "radio",
  "slider",
  "spinbutton",
  "switch",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "tab",
]);

class A11yAssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "A11yAssertionError";
  }
}

/** The audit rules `collectFindings` knows how to run. */
export type A11yRule =
  | "no-unlabeled-interactive"
  | "image-alt"
  | "heading-order"
  | "dialog-labeled"
  | "landmark-structure";

/** Every rule, in the order they run. */
export const ALL_RULES: readonly A11yRule[] = [
  "no-unlabeled-interactive",
  "image-alt",
  "heading-order",
  "dialog-labeled",
  "landmark-structure",
];

/**
 * A single accessibility problem found by {@link collectFindings}.
 *
 * Structured on purpose: the same data drives the throwing `assert*` helpers
 * (which format it into a message) and non-throwing consumers like the MCP
 * server, a JSON reporter, or a CLI (which return it as-is).
 */
export interface Finding {
  /** Which rule produced this finding. */
  rule: A11yRule;
  /** `"error"` blocks use; `"warning"` is a best-practice / triage-later signal. */
  severity: "error" | "warning";
  /** Human-readable, self-contained description of the problem. */
  message: string;
  /** Accessible role of the offending node, when the finding is node-scoped. */
  role?: string;
  /** Accessible name of the offending node, when relevant. */
  name?: string;
  /** DOM tag name of the offending node, when the finding is node-scoped. */
  tagName?: string;
  /** Best-effort CSS selector path to the offending element, so it's findable. */
  locator?: string;
  /** Disambiguating context — `href`, the nearest landmark — when available. */
  context?: string;
}

const LANDMARK_SELECTOR =
  "main, nav, header, footer, aside, [role=main], [role=navigation], [role=banner], [role=contentinfo], [role=complementary], [role=region]";

/**
 * Resolve `root` to an a11y tree. Accepts a live `Element` (extracted in-page)
 * or an already-extracted `ExtractionResult`.
 *
 * `Element` is a browser-only global, so we can't write `root instanceof
 * Element` unguarded: the native producer runs the audit rules in **Node** over
 * an `ExtractionResult`, where referencing `Element` throws `ReferenceError`.
 * Guard on `typeof Element` first — in Node the global is absent and the only
 * possible input is an already-extracted tree.
 */
function toTree(root: Element | ExtractionResult): ExtractionResult {
  const isElement = typeof Element !== "undefined" && root instanceof Element;
  return isElement
    ? extractA11yTree(root as Element)
    : (root as ExtractionResult);
}

/**
 * Best-effort unique-ish CSS path. The traversal itself lives in core
 * ({@link buildCssPath}) because the native producer has to compute the same
 * paths from a CDP document snapshot, with no live element to walk.
 */
const cssPath = (el: Element): string => buildCssPath(el, DOM_ELEMENT_ADAPTER);

/** `href` + nearest landmark, to tell otherwise-identical findings apart. */
function elementContext(el: Element): string | undefined {
  const bits: string[] = [];
  const href = el.getAttribute("href");
  if (href) {
    bits.push(`href="${href.length > 48 ? href.slice(0, 48) + "…" : href}"`);
  }
  const landmark = el.closest(LANDMARK_SELECTOR);
  if (landmark) {
    const role = landmark.getAttribute("role");
    bits.push(`in <${role ?? landmark.tagName.toLowerCase()}>`);
  }
  return bits.length ? bits.join(" · ") : undefined;
}

/**
 * Where a finding is, so it can be acted on without cross-referencing the tree
 * by hand. Two paths, because the two producers arrive differently: with a live
 * element (the in-page walk) the locator and its `href`/landmark context are
 * computed here; without one, the locator the producer precomputed is used and
 * there is no context to derive. `{}` only when neither is available.
 */
function locate(node: SemanticNode): Pick<Finding, "locator" | "context"> {
  const el = getElementRefs().get(node.id);
  if (!el) {
    // No live element: this tree came from the native producer, which ran in
    // Node over a CDP snapshot. It computed the locator during that walk, so
    // use it — otherwise every native finding would be locator-less.
    const precomputed = node.dom?.locator;
    return precomputed ? { locator: precomputed } : {};
  }
  const context = elementContext(el);
  return context ? { locator: cssPath(el), context } : { locator: cssPath(el) };
}

/**
 * Run the requested audit rules against `root` and return every problem found.
 *
 * This is the shared detection engine. It extracts the a11y tree **once** and
 * runs each rule over it, so auditing all rules is a single extraction rather
 * than one per rule. Unlike the `assert*` wrappers it never throws and never
 * stops early — it reports *all* violations, which is what an audit (or an
 * agent) wants.
 *
 * @param root  Element to audit, or an already-extracted a11y tree. Passing a
 *              pre-extracted tree lets callers run the rules over the **same
 *              snapshot** other views (serialized tree, outline, tab order) use,
 *              so a multi-view report can't be internally inconsistent.
 * @param rules Which rules to run. Defaults to {@link ALL_RULES}.
 */
export function collectFindings(
  root: Element | ExtractionResult,
  rules: readonly A11yRule[] = ALL_RULES,
): Finding[] {
  const tree = toTree(root);
  const want = new Set(rules);
  const findings: Finding[] = [];

  if (want.has("no-unlabeled-interactive")) {
    for (const node of linearize(tree)) {
      if (!INTERACTIVE_ROLES.has(node.a11y.role)) continue;
      if (node.a11y.name.trim().length > 0) continue;
      // `dom` is absent on native-produced trees; the finding degrades to
      // role-only wording rather than printing `<undefined>` (RFC v3 R5).
      const tag = node.dom?.tagName;
      findings.push({
        rule: "no-unlabeled-interactive",
        severity: "error",
        role: node.a11y.role,
        ...(tag ? { tagName: tag } : {}),
        message: tag
          ? `Unlabeled interactive element: ${node.a11y.role} <${tag}>`
          : `Unlabeled interactive element: ${node.a11y.role}`,
        ...locate(node),
      });
    }
  }

  if (want.has("image-alt")) {
    for (const node of linearize(tree)) {
      if (node.a11y.role !== "img") continue;
      if (node.a11y.name.trim().length > 0) continue;
      // Decorative images (alt="") map to role presentation and never reach the
      // a11y tree, so an img-role node with no name is a genuine missing name.
      const tag = node.dom?.tagName;
      findings.push({
        rule: "image-alt",
        severity: "warning",
        role: "img",
        ...(tag ? { tagName: tag } : {}),
        message: tag
          ? `Image has no accessible name: <${tag}> — add alt text, or mark it decorative with alt="".`
          : `Image has no accessible name — add alt text, or mark it decorative with alt="".`,
        ...locate(node),
      });
    }
  }

  if (want.has("heading-order")) {
    const outline = getOutline(tree);
    const h1s = outline.filter((e) => e.level === 1);
    if (h1s.length === 0) {
      findings.push({
        rule: "heading-order",
        severity: "warning",
        message:
          "Missing <h1>: every document should have exactly one top-level heading.",
      });
    } else if (h1s.length > 1) {
      findings.push({
        rule: "heading-order",
        severity: "warning",
        message: `Expected exactly one <h1>, found ${h1s.length}: ${h1s
          .map((h) => `"${h.name}"`)
          .join(", ")}`,
      });
    }

    let prev = 0;
    for (const entry of outline) {
      if (entry.level > prev + 1 && prev !== 0) {
        findings.push({
          rule: "heading-order",
          severity: "warning",
          name: entry.name,
          message: `Heading level skipped: "${entry.name}" is h${entry.level} but the previous heading was h${prev}.`,
        });
      }
      prev = entry.level;
    }
  }

  if (want.has("dialog-labeled")) {
    const dialogs = [
      ...findAllByRole(tree, "dialog"),
      ...findAllByRole(tree, "alertdialog"),
    ];
    for (const d of dialogs) {
      if (d.a11y.name.trim().length > 0) continue;
      findings.push({
        rule: "dialog-labeled",
        severity: "error",
        role: d.a11y.role,
        ...(d.dom?.tagName ? { tagName: d.dom.tagName } : {}),
        message: `Dialog (role ${d.a11y.role}) has no accessible name.`,
        ...locate(d),
      });
    }
  }

  if (want.has("landmark-structure")) {
    const mains = findAllByRole(tree, "main");
    if (mains.length === 0) {
      findings.push({
        rule: "landmark-structure",
        severity: "error",
        message: "Missing <main>: every page needs a main landmark.",
      });
    } else if (mains.length > 1) {
      findings.push({
        rule: "landmark-structure",
        severity: "warning",
        message: `Expected exactly one <main> landmark, found ${mains.length}.`,
      });
    }

    const banners = findAllByRole(tree, "banner");
    if (banners.length > 1) {
      findings.push({
        rule: "landmark-structure",
        severity: "warning",
        message: `More than one top-level <header> (banner landmark): found ${banners.length}.`,
      });
    }

    const footers = findAllByRole(tree, "contentinfo");
    if (footers.length > 1) {
      findings.push({
        rule: "landmark-structure",
        severity: "warning",
        message: `More than one top-level <footer> (contentinfo landmark): found ${footers.length}.`,
      });
    }
  }

  return findings;
}

/** Filter categories for {@link listByRole} — the groups behind the extension's tabs. */
export type RoleFilter = keyof typeof ROLE_FILTER_GROUPS;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Why a category came back empty.
 *
 * A bare `(none)` is the same answer to three different questions — the page
 * genuinely has none of these, the tree never got extracted, or the category
 * doesn't cover the role you were thinking of. An agent can't tell those apart,
 * and the remedy differs for each, so the empty case says which.
 *
 * The role list is the half that carries most of the weight. `filter` names are
 * everyday words and the roles behind them are not obvious: `image` looks for
 * exactly `img`, so a page whose graphics are `figure`s reports none. Worse,
 * `landmark` includes the `form` role while the `form` filter does *not* — it
 * looks for the fields. Both read as a bug until you can see the roles.
 */
function nothingMatched(
  filter: RoleFilter,
  roles: readonly string[],
  scanned: number,
): string {
  if (scanned === 0) {
    return `(none — the tree is empty, so nothing could match filter "${filter}"; the page may not have loaded, or extraction failed)`;
  }
  // No count on the roles — the list is right there and countable. The count on
  // the nodes IS the signal: it separates "this page has none" from "nothing was
  // read".
  const looksFor = roles.length === 1 ? "role" : "roles";
  return (
    `(none — filter "${filter}" matched 0 of ${plural(scanned, "node")}; ` +
    `it looks for ${looksFor} ${roles.join(", ")})`
  );
}

/**
 * List every element in a category (links, buttons, form controls, landmarks,
 * images, headings) as `role "name"` plus a best-effort locator + context — the
 * same role groups the extension's filter tabs use ({@link ROLE_FILTER_GROUPS}).
 * A token-efficient way to review one kind of element at a time.
 *
 * Never returns an empty string: an empty category returns a line explaining
 * why (see {@link nothingMatched}), so a caller never has to invent a sentinel
 * of its own.
 */
export function listByRole(
  root: Element | ExtractionResult,
  filter: RoleFilter,
): string {
  const roles = ROLE_FILTER_GROUPS[filter];
  if (!roles) return `(unknown filter "${filter}")`;
  const tree = toTree(root);
  const lines: string[] = [];
  // Counted here rather than from `linearize(tree).length` so the denominator is
  // exactly the set that was tested — if the walk ever starts skipping nodes,
  // the two would quietly disagree and the ratio would be a lie.
  let scanned = 0;
  for (const node of linearize(tree)) {
    scanned += 1;
    if (!roles.includes(node.a11y.role)) continue;
    const name = node.a11y.name.trim();
    const nameSuffix = name ? ` "${name}"` : "";
    const level = node.a11y.properties?.level;
    const levelSuffix = level ? ` (level ${level})` : "";
    const { locator, context } = locate(node);
    const where = locator
      ? `  [${locator}${context ? ` · ${context}` : ""}]`
      : "";
    lines.push(`${node.a11y.role}${nameSuffix}${levelSuffix}${where}`);
  }
  return lines.length
    ? lines.join("\n")
    : nothingMatched(filter, roles, scanned);
}

/** Format findings into the multi-line message the `assert*` helpers throw. */
export function formatFindings(findings: Finding[]): string {
  const noun = findings.length === 1 ? "issue" : "issues";
  const lines = findings.map((f) => {
    const where = f.locator
      ? ` [${f.locator}${f.context ? ` — ${f.context}` : ""}]`
      : "";
    return `  - ${f.message}${where}`;
  });
  return `Found ${findings.length} accessibility ${noun}:\n${lines.join("\n")}`;
}

/**
 * Throw an {@link A11yAssertionError} if any of `rules` produced a finding.
 * Shared body for the single-rule `assert*` helpers below, and exported so
 * callers can assert an arbitrary rule subset — over a DOM `Element` or a
 * pre-extracted tree (e.g. a native `ExtractionResult` from a real browser).
 */
export function assertRules(
  root: Element | ExtractionResult,
  rules: readonly A11yRule[],
): void {
  const findings = collectFindings(root, rules);
  if (findings.length) {
    throw new A11yAssertionError(formatFindings(findings));
  }
}

/**
 * Every interactive node must have a non-empty accessible name.
 * Throws an {@link A11yAssertionError} listing the offenders.
 */
export function assertNoUnlabeledInteractive(root: Element): void {
  assertRules(root, ["no-unlabeled-interactive"]);
}

/**
 * Heading structure sanity check: exactly one `h1` and no skipped levels.
 */
export function assertHeadingOrder(root: Element): void {
  assertRules(root, ["heading-order"]);
}

/**
 * Every dialog must have an accessible name (via `aria-label`, labelledby, or
 * a visible title child).
 */
export function assertDialogsLabeled(root: Element): void {
  assertRules(root, ["dialog-labeled"]);
}

/**
 * Landmarks sanity: exactly one `main`, and `banner`/`contentinfo` appear at
 * most once at the top level.
 */
export function assertLandmarkStructure(root: Element): void {
  assertRules(root, ["landmark-structure"]);
}

export { A11yAssertionError };
