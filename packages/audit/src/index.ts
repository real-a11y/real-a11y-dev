import {
  describeTreeInput,
  extractA11yTree,
  findAllByRole,
  getElementRefs,
  getOutline,
  isExtractionResult,
  isNativeIframeRole,
  linearize,
  ROLE_FILTER_GROUPS,
  treeInputError,
  type ExtractionResult,
  type SemanticNode,
} from "@real-a11y-dev/core";

import { locate } from "./locate.js";
import { uniqueInteractiveNamesFindings } from "./unique-names.js";

/** Roles we consider intrinsically interactive for labeling checks. */
export const INTERACTIVE_ROLES: ReadonlySet<string> = new Set([
  "button",
  "link",
  "textbox",
  "html-input-color",
  "html-input-date",
  "html-input-datetime-local",
  "html-input-month",
  "html-input-time",
  "html-input-week",
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

/** Non-interactive roles WAI-ARIA 1.2 requires a name for; apart from the public `INTERACTIVE_ROLES`. */
const NAME_REQUIRED_ROLES: ReadonlySet<string> = new Set([
  "treeitem",
  "tooltip",
  "meter",
  "progressbar",
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
  | "label-title-only"
  | "image-alt"
  | "heading-order"
  | "dialog-labeled"
  | "landmark-structure"
  | "unique-interactive-names";

/** Every rule, in the order they run. */
export const ALL_RULES: readonly A11yRule[] = [
  "no-unlabeled-interactive",
  "label-title-only",
  "image-alt",
  "heading-order",
  "dialog-labeled",
  "landmark-structure",
  "unique-interactive-names",
];

/** `input` types axe's `label-matches` excludes — they don't take a visible `<label>`. */
const INPUT_TYPES_WITHOUT_LABEL = new Set([
  "hidden",
  "image",
  "button",
  "submit",
  "reset",
]);

/**
 * True when a form control's only "label" is `title` and/or `aria-describedby`
 * — axe-core's `label-title-only` (best-practice). A SR still announces
 * `title` as the name; this rule does not call that unlabeled.
 *
 * Buttons are out of scope, matching axe: `title` on a `<button>` passes
 * `button-name` / `no-unlabeled-interactive` and is not this check.
 */
function isTitleOnlyFormControl(node: SemanticNode): boolean {
  const dom = node.dom;
  if (!dom) return false;
  const tag = dom.tagName;
  if (tag !== "input" && tag !== "select" && tag !== "textarea") return false;
  const type = (dom.attributes["type"] ?? "text").toLowerCase();
  if (tag === "input" && INPUT_TYPES_WITHOUT_LABEL.has(type)) return false;

  const el = getElementRefs().get(node.id);
  return el
    ? isTitleOnlyElement(node, dom, el)
    : isTitleOnlyWithoutElement(node, dom);
}

/** {@link isTitleOnlyFormControl} for a node with a live element to read. */
function isTitleOnlyElement(
  node: SemanticNode,
  dom: NonNullable<SemanticNode["dom"]>,
  el: Element,
): boolean {
  if (el.getAttribute("aria-label")?.trim()) return false;
  if (labelledByResolvesToText(el)) return false;
  if (hasAssociatedLabelText(el)) return false;
  // A label or a reference can name the field with no text of its own:
  // `<label for="e"><img alt="Email"></label>` names its field "Email" from
  // the image's alt. The computed name says so, as it does for a native tree.
  if (namedBeyondTitle(node, dom)) return false;
  return !!(
    el.getAttribute("title")?.trim() ||
    el.getAttribute("aria-describedby")?.trim()
  );
}

/**
 * {@link isTitleOnlyFormControl} for a node with no live element.
 *
 * Native trees have no live element, so labelledby IDs cannot be resolved.
 * Chromium already did that work (see namedBeyondTitle). Description is how
 * AX exposes aria-describedby (title becomes description only when some
 * other source already supplied the name — those pass via the name check).
 */
function isTitleOnlyWithoutElement(
  node: SemanticNode,
  dom: NonNullable<SemanticNode["dom"]>,
): boolean {
  if (dom.attributes["aria-label"]?.trim()) return false;
  if (namedBeyondTitle(node, dom)) return false;
  return !!(
    dom.attributes["title"]?.trim() ||
    node.a11y.description.trim() ||
    dom.attributes["aria-describedby"]?.trim()
  );
}

/**
 * Whether a control's name came from something other than its `title` or
 * `placeholder`: a name that is neither came from a `<label>`, a reference or
 * an aria-label.
 */
function namedBeyondTitle(
  node: SemanticNode,
  dom: NonNullable<SemanticNode["dom"]>,
): boolean {
  const title = (dom.attributes["title"] ?? "").trim();
  const placeholder = (dom.attributes["placeholder"] ?? "").trim();
  const name = node.a11y.name.trim();
  return name !== "" && name !== title && name !== placeholder;
}

/** True when at least one `aria-labelledby` id points at an element with text. */
function labelledByResolvesToText(el: Element): boolean {
  const raw = el.getAttribute("aria-labelledby");
  if (!raw?.trim()) return false;
  const doc = el.ownerDocument;
  if (!doc) return false;
  for (const id of raw.trim().split(/\s+/)) {
    if (doc.getElementById(id)?.textContent?.trim()) return true;
  }
  return false;
}

function hasAssociatedLabelText(el: Element): boolean {
  const labels =
    "labels" in el
      ? (el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement)
          .labels
      : null;
  if (labels) {
    for (const lab of labels) {
      if (lab.textContent?.trim()) return true;
    }
  }
  return false;
}

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

/**
 * Resolve `root` to an a11y tree. Accepts a live `Element` (extracted in-page)
 * or an already-extracted `ExtractionResult`.
 *
 * `Element` is a browser-only global, so we can't write `root instanceof
 * Element` unguarded: the native producer runs the audit rules in **Node** over
 * an `ExtractionResult`, where referencing `Element` throws `ReferenceError`.
 * Guard on `typeof Element` first — in Node the global is absent and the only
 * possible input is an already-extracted tree.
 *
 * The non-Element branch is CHECKED, not cast. It used to be
 * `root as ExtractionResult`, which meant `assertNoUnlabeledInteractive(42)`
 * walked an empty tree, found nothing, and passed — reporting a clean page for
 * an argument that was never a page. Silence is the worst available outcome
 * for an assertion library: a suite full of them looks green forever.
 */
function toTree(
  root: Element | ExtractionResult,
  fn: string,
): ExtractionResult {
  if (typeof Element !== "undefined" && root instanceof Element) {
    return extractA11yTree(root);
  }
  if (isExtractionResult(root)) return root;
  throw treeInputError(fn, root);
}

/**
 * Reject rule ids that aren't real.
 *
 * An unknown id matches no rule, so it produces no findings and the assertion
 * passes — "no findings" and "no rules ran" are the same observable outcome.
 * `A11yRule` protects a TypeScript caller writing a literal, but not a list
 * built from a config file, a CLI flag, or plain JavaScript, and a typo there
 * silently deletes the check it was meant to run.
 */
function requireRules(rules: readonly A11yRule[], fn: string): void {
  if (!Array.isArray(rules)) {
    throw new TypeError(
      `${fn}: expected an array of rule ids, received ${describeTreeInput(rules)}`,
    );
  }
  const unknown = rules.filter((rule) => !ALL_RULES.includes(rule));
  if (unknown.length) {
    const listed = unknown.map((rule) => JSON.stringify(rule)).join(", ");
    throw new TypeError(
      `${fn}: unknown rule ${listed}. Known rules: ${ALL_RULES.join(", ")}`,
    );
  }
}

/**
 * The nodes of a frame's document: everything under a native tree's `Iframe`
 * row. A frame is a document of its own — an embedded widget's `<h1>` or
 * `<main>` is not a second one of the page's — so the rules that describe
 * the page's document (`heading-order`, `landmark-structure`) leave these
 * out. The rules about one node apply inside a frame as anywhere. A DOM tree
 * never enters a frame, so it has none.
 */
function frameContent(tree: ExtractionResult): Set<string> {
  const out = new Set<string>();
  const stack: string[] = [];
  for (const node of tree.nodes.values()) {
    if (isNativeIframeRole(node.a11y.role)) stack.push(...node.childIds);
  }
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(tree.nodes.get(id)?.childIds ?? []));
  }
  return out;
}

/** `heading-order`: exactly one `<h1>`, and no skipped heading levels, in the
 *  page's own document. Appends to `findings`. */
function headingOrderFindings(
  tree: ExtractionResult,
  findings: Finding[],
  inFrame: ReadonlySet<string>,
): void {
  const outline = getOutline(tree).filter((e) => !inFrame.has(e.id));
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

/** `landmark-structure`: one `main`, and at most one top-level banner /
 *  contentinfo, in the page's own document. Appends to `findings`. */
function landmarkStructureFindings(
  tree: ExtractionResult,
  findings: Finding[],
  inFrame: ReadonlySet<string>,
): void {
  const landmarks = (role: string): SemanticNode[] =>
    findAllByRole(tree, role).filter((n) => !inFrame.has(n.id));
  const mains = landmarks("main");
  if (mains.length === 0) {
    findings.push({
      rule: "landmark-structure",
      severity: "warning",
      message: "Missing <main>: a page should have one main landmark.",
    });
  } else if (mains.length > 1) {
    findings.push({
      rule: "landmark-structure",
      severity: "warning",
      message: `Expected exactly one <main> landmark, found ${mains.length}.`,
    });
  }

  const banners = landmarks("banner");
  if (banners.length > 1) {
    findings.push({
      rule: "landmark-structure",
      severity: "warning",
      message: `More than one top-level <header> (banner landmark): found ${banners.length}.`,
    });
  }

  const footers = landmarks("contentinfo");
  if (footers.length > 1) {
    findings.push({
      rule: "landmark-structure",
      severity: "warning",
      message: `More than one top-level <footer> (contentinfo landmark): found ${footers.length}.`,
    });
  }
}

/** `no-unlabeled-interactive`: an interactive or name-required role with no accessible name. Appends to `findings`. */
function unlabeledInteractiveFindings(
  tree: ExtractionResult,
  findings: Finding[],
): void {
  for (const node of linearize(tree)) {
    const interactive = INTERACTIVE_ROLES.has(node.a11y.role);
    if (!interactive && !NAME_REQUIRED_ROLES.has(node.a11y.role)) continue;
    if (node.a11y.name.trim().length > 0) continue;
    // `dom` is absent on native-produced trees; the finding degrades to
    // role-only wording rather than printing `<undefined>` (RFC v3 R5).
    const tag = node.dom?.tagName;
    findings.push({
      rule: "no-unlabeled-interactive",
      severity: "error",
      role: node.a11y.role,
      ...(tag ? { tagName: tag } : {}),
      message: `${
        interactive ? "Unlabeled interactive element" : "Unlabeled element"
      }: ${node.a11y.role}${tag ? ` <${tag}>` : ""}${
        interactive ? "" : " (this role requires an accessible name)"
      }`,
      ...locate(node, tree),
    });
  }
}

/** `label-title-only`: a form control labeled only by `title` or `aria-describedby`. Appends to `findings`. */
function labelTitleOnlyFindings(
  tree: ExtractionResult,
  findings: Finding[],
): void {
  for (const node of linearize(tree)) {
    if (!isTitleOnlyFormControl(node)) continue;
    const tag = node.dom?.tagName;
    findings.push({
      rule: "label-title-only",
      severity: "warning",
      role: node.a11y.role,
      ...(node.a11y.name ? { name: node.a11y.name } : {}),
      ...(tag ? { tagName: tag } : {}),
      message: tag
        ? `Form element <${tag}> is labeled only by title or aria-describedby — add a visible <label>, aria-label, or aria-labelledby.`
        : `Form element is labeled only by title or aria-describedby — add a visible <label>, aria-label, or aria-labelledby.`,
      ...locate(node, tree),
    });
  }
}

/** `image-alt`: an `img` node with no accessible name. Appends to `findings`. */
function imageAltFindings(tree: ExtractionResult, findings: Finding[]): void {
  for (const node of linearize(tree)) {
    if (node.a11y.role !== "img") continue;
    if (node.a11y.name.trim().length > 0) continue;
    // Decorative images (alt="") map to role presentation and never reach
    // the a11y tree, so an img-role node with no name is a genuine missing
    // name. An `alt=""` image that IS exposed got there by being named
    // (title / aria-label / aria-labelledby — so it has a name and is
    // skipped above) or by being focusable, and a focusable image with no
    // name is exactly what this rule should report.
    const tag = node.dom?.tagName;
    findings.push({
      rule: "image-alt",
      severity: "warning",
      role: "img",
      ...(tag ? { tagName: tag } : {}),
      message: tag
        ? `Image has no accessible name: <${tag}> — add alt text, or mark it decorative with alt="".`
        : `Image has no accessible name — add alt text, or mark it decorative with alt="".`,
      ...locate(node, tree),
    });
  }
}

/** `dialog-labeled`: a `dialog` or `alertdialog` with no accessible name. Appends to `findings`. */
function dialogLabeledFindings(
  tree: ExtractionResult,
  findings: Finding[],
): void {
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
      ...locate(d, tree),
    });
  }
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
  requireRules(rules, "collectFindings");
  const tree = toTree(root, "collectFindings");
  const want = new Set(rules);
  const findings: Finding[] = [];

  if (want.has("no-unlabeled-interactive"))
    unlabeledInteractiveFindings(tree, findings);

  if (want.has("label-title-only")) labelTitleOnlyFindings(tree, findings);

  if (want.has("image-alt")) imageAltFindings(tree, findings);

  // The page's own document, for the rules that describe it.
  const inFrame =
    want.has("heading-order") || want.has("landmark-structure")
      ? frameContent(tree)
      : new Set<string>();

  if (want.has("heading-order")) headingOrderFindings(tree, findings, inFrame);

  if (want.has("dialog-labeled")) dialogLabeledFindings(tree, findings);

  if (want.has("landmark-structure"))
    landmarkStructureFindings(tree, findings, inFrame);

  if (want.has("unique-interactive-names"))
    uniqueInteractiveNamesFindings(tree, findings);

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
 *
 * `options.values` adds each field's announced value (`a11y.value`) as
 * `= "…"` after the name, the same way the serializers print it (ADR-0001).
 * Off by default.
 */
export function listByRole(
  root: Element | ExtractionResult,
  filter: RoleFilter,
  options: { values?: boolean } = {},
): string {
  const roles = ROLE_FILTER_GROUPS[filter];
  if (!roles) return `(unknown filter "${filter}")`;
  const tree = toTree(root, "listByRole");
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
    const value = options.values ? node.a11y.value : undefined;
    const valueSuffix =
      value !== undefined ? ` = ${JSON.stringify(value)}` : "";
    const level = node.a11y.properties?.level;
    const levelSuffix = level ? ` (level ${level})` : "";
    const { locator, context } = locate(node, tree);
    const where = locator
      ? `  [${locator}${context ? ` · ${context}` : ""}]`
      : "";
    lines.push(
      `${node.a11y.role}${nameSuffix}${valueSuffix}${levelSuffix}${where}`,
    );
  }
  return lines.length
    ? lines.join("\n")
    : nothingMatched(filter, roles, scanned);
}

/**
 * Format findings into the multi-line message the `assert*` helpers throw.
 *
 * An empty list reads as an outcome, not a heading with nothing under it:
 * `assert*` only calls this when something failed, but direct callers render
 * clean pages too, and "Found 0 accessibility issues:" left a dangling colon
 * promising a list that never came.
 */
export function formatFindings(findings: Finding[]): string {
  if (!findings.length) return "No accessibility issues found.";
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
  assertRulesAs(root, rules, "assertRules");
}

/**
 * Shared body, carrying the name of the function the caller actually called so
 * a rejected argument names `assertNoUnlabeledInteractive` rather than the
 * helper underneath it. Input problems throw `TypeError`, never
 * {@link A11yAssertionError} — a caller catching the latter is handling "this
 * page has issues", and a wrong argument is not that.
 */
function assertRulesAs(
  root: Element | ExtractionResult,
  rules: readonly A11yRule[],
  fn: string,
): void {
  requireRules(rules, fn);
  const findings = collectFindings(toTree(root, fn), rules);
  if (findings.length) {
    throw new A11yAssertionError(formatFindings(findings));
  }
}

/**
 * Every interactive node must have a non-empty accessible name.
 * Throws an {@link A11yAssertionError} listing the offenders.
 */
export function assertNoUnlabeledInteractive(
  root: Element | ExtractionResult,
): void {
  assertRulesAs(
    root,
    ["no-unlabeled-interactive"],
    "assertNoUnlabeledInteractive",
  );
}

/**
 * Heading structure sanity check: exactly one `h1` and no skipped levels.
 */
export function assertHeadingOrder(root: Element | ExtractionResult): void {
  assertRulesAs(root, ["heading-order"], "assertHeadingOrder");
}

/**
 * Every dialog must have an accessible name (via `aria-label`, labelledby, or
 * a visible title child).
 */
export function assertDialogsLabeled(root: Element | ExtractionResult): void {
  assertRulesAs(root, ["dialog-labeled"], "assertDialogsLabeled");
}

/**
 * Landmarks sanity: exactly one `main`, and `banner`/`contentinfo` appear at
 * most once at the top level.
 */
export function assertLandmarkStructure(
  root: Element | ExtractionResult,
): void {
  assertRulesAs(root, ["landmark-structure"], "assertLandmarkStructure");
}

/**
 * No two buttons, links, checkboxes or switches share an accessible name, nor
 * two radios, options, tabs, menu items or tree items in one container. Links
 * to the same `href` may. A `warning` in {@link collectFindings}, but this
 * throws on it, as {@link assertLandmarkStructure} does on its warnings.
 */
export function assertUniqueInteractiveNames(
  root: Element | ExtractionResult,
): void {
  assertRulesAs(
    root,
    ["unique-interactive-names"],
    "assertUniqueInteractiveNames",
  );
}

export { A11yAssertionError };
