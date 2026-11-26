// Custom `expect` matchers — the jest-axe-style ergonomic layer over the
// plain assertion + snapshot functions.
//
// Two mechanisms ship here, deliberately kept separate:
//
//   1. Assertion matchers (`toHaveNoUnlabeledInteractive`, …) wrap the
//      existing `assertX` functions. A failed assertion becomes a matcher
//      failure with the assertion's own message, and `.not` works for free.
//
//   2. A *snapshot serializer* (not a custom snapshot matcher). Wrapping the
//      tree in `boxedTreeSnapshot(el)` and registering the serializer means plain
//      `expect(boxedTreeSnapshot(el)).toMatchSnapshot()` /
//      `.toMatchInlineSnapshot()` stay fully native to each framework's
//      snapshot tooling — `-u`/`--update` and obsolete-snapshot detection
//      keep working, with no reach into private snapshot-state internals.
//
// Registration is opt-in (jest-axe pattern): the consumer calls
// `registerA11yMatchers(expect)` from their test setup file. Nothing here runs
// on import, so the package's main entry stays `sideEffects: false`.

import {
  assertNoUnlabeledInteractive,
  assertHeadingOrder,
  assertDialogsLabeled,
  assertLandmarkStructure,
  A11yAssertionError,
} from "@real-a11y-dev/audit";
import type { ExtractionResult, SemanticNode } from "@real-a11y-dev/core";
import {
  buildA11yTree,
  getElementRefs,
  getTabSequence,
  isDatalistCombobox,
  resolveRoleToken,
  selectRoleFromAttributes,
  withAriaOwnerIndex,
  withholdsState,
} from "@real-a11y-dev/core";
import {
  extract,
  foldTypography,
  serializeOutline,
  serializeTabSequence,
  serializeTree,
  type SerializeOptions,
} from "@real-a11y-dev/serialize";
import {
  validateNode,
  validateTree,
  type ValidatedNode,
} from "@real-a11y-dev/validate";

import { configureA11y, type A11yConfig } from "./config.js";
import {
  contractWrites,
  verifyContract,
  type VerifyContractOptions,
} from "./contract.js";
import {
  a11ySnapshotSerializer,
  boxSnapshot,
  type A11ySnapshotBox,
  type SnapshotView,
} from "./snapshot-box.js";
import { bindSnapshotRecorder, isRecording } from "./snapshot-record.js";
import { computedAriaAttributes } from "./validated-attrs.js";

// A pre-extracted tree carries its producer provenance (`source`).
type Tree = ExtractionResult;

// Both Jest and Vitest accept this shape back from a matcher.
interface MatcherResult {
  pass: boolean;
  message: () => string;
}

// The slice of the matcher context we rely on. Both frameworks provide these.
interface MatcherContext {
  isNot: boolean;
  equals(a: unknown, b: unknown): boolean;
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (value instanceof Element) return `<${value.tagName.toLowerCase()}>`;
  return typeof value;
}

/**
 * Guard a matcher's received value.
 *
 * THROWS rather than returning `{ pass: false }`. A returned failure is exactly
 * what `.not` inverts, so a wrong-typed value made the negated form succeed
 * *without running the audit at all*: when `container.firstChild` is actually
 * `null`, `expect(container.firstChild).not.toHaveNoUnlabeledInteractive()`
 * reported success while asserting nothing. That's the worst possible outcome
 * for a matcher whose job is catching mistakes. A throw fails in both
 * directions, because `.not` can invert a result but cannot swallow an
 * exception — the same approach jest-dom takes for wrong-typed inputs.
 */
function requireElement(
  received: unknown,
  name: string,
): asserts received is Element {
  if (!(received instanceof Element)) {
    throw new TypeError(
      `${name}: expected a DOM Element, received ${describe(received)}`,
    );
  }
}

// ─── assertion matchers ──────────────────────────────────────────────────────

function runAssertion(
  received: unknown,
  assert: (root: Element) => void,
  name: string,
): MatcherResult {
  requireElement(received, name);

  let failure: A11yAssertionError | null = null;
  try {
    assert(received);
  } catch (err) {
    if (err instanceof A11yAssertionError) failure = err;
    else throw err; // a real bug — don't swallow it as a soft assertion
  }

  const pass = failure === null;
  return {
    pass,
    message: () =>
      pass
        ? `expected element to violate ${name}, but it satisfied it`
        : failure!.message,
  };
}

// ─── tab-sequence matcher ────────────────────────────────────────────────────

/** `role "name"` token per focusable node, in Tab order. */
function tabTokens(root: Element): string[] {
  const tree = extract(root, "a11y");
  return getTabSequence(tree).map((n) => {
    const name = n.a11y.name ? ` "${n.a11y.name}"` : "";
    return `${n.a11y.role}${name}`;
  });
}

function toHaveTabSequence(
  this: MatcherContext,
  received: unknown,
  expected: string[],
): MatcherResult {
  requireElement(received, "toHaveTabSequence");
  const actual = tabTokens(received);
  // Compare with typography folded so a hand-typed straight quote matches a
  // rendered curly one (a name like `link "Don't save"`). The message still
  // shows the raw tokens, so the committed record stays faithful.
  const pass = this.equals(
    actual.map(foldTypography),
    expected.map(foldTypography),
  );
  return {
    pass,
    message: () =>
      pass
        ? `expected tab sequence NOT to equal\n  ${JSON.stringify(expected)}`
        : [
            "Tab sequence mismatch.",
            `  expected: ${JSON.stringify(expected)}`,
            `  actual:   ${JSON.stringify(actual)}`,
          ].join("\n"),
  };
}

// ─── ARIA validity matcher ───────────────────────────────────────────────────

/** Adapt a core `SemanticNode` tree to the validator's minimal node shape,
 *  reconstructing `aria-*` attribute names from the split states/properties. */
/**
 * ARIA states the **user agent** supplies for an element, whatever role the
 * author wrote on it.
 *
 * This is the question that decides the required-attribute contract, and it is
 * NOT "did somebody type a `role=` attribute". The two diverge on ordinary
 * markup: `<input type="checkbox" role="switch">` is the ARIA-APG canonical
 * switch, where the role is neither redundant nor deletable — and the browser
 * still exposes checkedness. Keying on the attribute demanded `aria-checked`
 * there with no remedy available.
 *
 * `aria-controls` on a `<select>` is here for the opposite reason: the UA owns
 * the popup and exposes no controls relationship, so there is nothing for an
 * author to write.
 *
 * An `<input>` whose `list` names a `<datalist>` is a combobox with the same
 * kind of popup: the browser draws the suggestions, and Chromium 151 and 153
 * expose no expanded state or controls relationship for it. The page gets no
 * event when that popup opens, so an authored `aria-expanded` could only go
 * stale, and Chromium would expose that stale value as the combobox's state.
 * Whether the list names a datalist is a question about the live DOM, hence
 * the element rather than its recorded attributes.
 */
function uaSuppliedAttrs(
  tag: string | undefined,
  type: string | undefined,
  element: Element | undefined,
): readonly string[] {
  if (tag === "input" && element && isDatalistCombobox(element))
    return ["aria-expanded", "aria-controls"];
  if (tag === "input" && (type === "checkbox" || type === "radio"))
    return ["aria-checked"];
  if (tag === "input" && type === "range") return ["aria-valuenow"];
  if (tag === "option") return ["aria-selected"];
  if (tag === "select") return ["aria-expanded", "aria-controls"];
  if (tag === "details") return ["aria-expanded"];
  if (tag === "progress" || tag === "meter") return ["aria-valuenow"];
  return [];
}

/**
 * Enough of the implicit-role map to tell whether an authored `role=` is
 * REDUNDANT — `<select role="combobox">` names the role the element already
 * had, so nothing about the user agent changed and the node is still native.
 * Without this, spreading `role` through design-system props reintroduced the
 * whole wall of violations.
 */
function implicitRoleFor(
  tag: string | undefined,
  type: string | undefined,
  attrs: Record<string, string>,
): string | undefined {
  switch (tag) {
    case "select":
      // The DOM producer's own rule, so a select's `size` decides both.
      return selectRoleFromAttributes(attrs);
    case "option":
      return "option";
    case "button":
      return "button";
    case "a":
      return attrs.href !== undefined ? "link" : undefined;
    case "table":
      return "table";
    case "input":
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "range") return "slider";
      return undefined;
    default:
      return undefined;
  }
}

/**
 * The role an author wrote that the extracted tree doesn't show, because the
 * browser discarded it: the first token of `role` when it names something
 * other than the node's role — an unrecognised token (returned as written),
 * or a listitem/option/treeitem outside its required context (returned
 * resolved, so `LISTITEM` is judged as `listitem`).
 *
 * A presentational first token is not a discard: conflict resolution voids
 * `role="none"` on a focusable element, and the element's own role is then
 * the right thing to judge.
 */
function discardedRoleOf(n: SemanticNode): string | undefined {
  const authored = n.dom?.attributes.role?.trim().split(/\s+/)[0];
  if (!authored) return undefined;
  const resolved = resolveRoleToken(authored);
  if (resolved === "none" || resolved === "presentation") return undefined;
  if (resolved === n.a11y.role) return undefined;
  return resolved ?? authored;
}

/**
 * The state the validator requires on each role whose choice the tree can
 * withhold, and the attribute that supplies it.
 */
const REQUIRED_CHOICE_STATES: ReadonlyMap<string, [string, string]> = new Map([
  ["option", ["selected", "aria-selected"]],
  ["treeitem", ["selected", "aria-selected"]],
  ["radio", ["checked", "aria-checked"]],
  ["menuitemradio", ["checked", "aria-checked"]],
  ["menuitemcheckbox", ["checked", "aria-checked"]],
]);

/**
 * The required choice attribute (`aria-selected`, `aria-checked`) where the
 * tree withholds its state: in a sensitive field's popup (core's
 * `withholdsState`), whatever the author wrote is not the tree's to report.
 * Asking whether it is there would also say which item is chosen, by
 * elimination, when only the chosen one carries it, and the finding lands in
 * CI logs. So it counts as supplied, as a user agent's own would.
 */
function withheldSuppliedAttrs(
  element: Element | undefined,
  role: string,
): readonly string[] {
  const required = REQUIRED_CHOICE_STATES.get(role);
  return element &&
    required &&
    withholdsState(element, role, required[0], false)
    ? [required[1]]
    : [];
}

/** `focusable` for the validator, omitted when the producer recorded no
 *  interaction facet so its fail-open default applies. */
function focusableOf(n: SemanticNode): { focusable?: boolean } {
  return n.interaction ? { focusable: n.interaction.isFocusable } : {};
}

function toValidatedNode(
  n: SemanticNode,
  parentId: string | null,
): ValidatedNode {
  const attrs = computedAriaAttributes(n.a11y);

  const domAttrs = n.dom?.attributes ?? {};
  // `states` is a small fixed set and `properties` holds only the keys in
  // core's `A11Y_PROPERTIES` table, so required props like `aria-controls`
  // and `aria-valuenow` could NEVER appear — an authored combobox or slider
  // was unsatisfiable no matter what the author wrote. Fill from the recorded
  // attributes, without letting them override a computed state.
  const element = getElementRefs().get(n.id);
  for (const [k, v] of Object.entries(domAttrs)) {
    if (k.startsWith("aria-") && attrs[k] === undefined) attrs[k] = v;
  }

  const tag = n.dom?.tagName?.toLowerCase();
  const type = domAttrs.type?.toLowerCase();
  // `role=""` and `role="  "` both fall back to the element's own semantics
  // in every user agent, and a role list resolves to its first token.
  const authored = domAttrs.role?.trim().split(/\s+/)[0];
  const discardedRole = discardedRoleOf(n);

  return {
    id: n.id,
    parentId,
    role: n.a11y.role,
    name: n.a11y.name,
    attrs,
    // Native structure, for the nesting rule. A redundant authored role
    // still counts: `<select role="combobox"><option>` is a select — in any
    // case, since the browser reads `COMBOBOX` as `combobox` too.
    implicitRole:
      !authored ||
      (resolveRoleToken(authored) ?? authored) ===
        implicitRoleFor(tag, type, domAttrs),
    uaSuppliedAttrs: [
      ...uaSuppliedAttrs(tag, type, element),
      ...withheldSuppliedAttrs(element, n.a11y.role),
    ],
    // Left out when the producer recorded no interaction facet, so the
    // validator's fail-open default applies.
    ...focusableOf(n),
    ...(discardedRole !== undefined ? { discardedRole } : {}),
  };
}

function toValidatedNodes(tree: Tree): Map<string, ValidatedNode> {
  const out = new Map<string, ValidatedNode>();
  for (const [id, n] of tree.nodes) out.set(id, toValidatedNode(n, n.parentId));
  return out;
}

/**
 * Nodes the a11y view folded away that still owe a finding: a discarded role
 * leaves a plain generic (`<div role="foo">`, a listitem outside any list),
 * which folds out of the view like any other — taking the author's mistake
 * with it. Each comes back parented on its nearest node the view kept. The
 * walk stops where the view's does, at anything hidden from assistive tech.
 */
function foldedDiscards(dom: Tree, a11y: Tree): ValidatedNode[] {
  const out: ValidatedNode[] = [];
  const walk = (id: string, keptAncestor: string | null): void => {
    const n = dom.nodes.get(id);
    if (!n || !n.a11y.isExposedToAT) return;
    const kept = a11y.nodes.has(id);
    if (!kept && discardedRoleOf(n) !== undefined) {
      out.push(toValidatedNode(n, keptAncestor));
    }
    for (const child of n.childIds) walk(child, kept ? id : keptAncestor);
  };
  walk(dom.rootId, null);
  return out;
}

/**
 * Assert the extracted accessibility tree has no ARIA *errors* — invalid roles,
 * roles the browser discards, missing required names/attributes, and the
 * relationship violations `@real-a11y-dev/validate` catches (interactive
 * nesting, presentational-children misuse). Advisory warnings don't fail the
 * matcher.
 */
function toBeValidA11yTree(received: unknown): MatcherResult {
  requireElement(received, "toBeValidA11yTree");
  // One walk, both views: the a11y view is what gets validated, and the DOM
  // view still holds the nodes it folded away.
  const dom = extract(received, "dom");
  const a11y = buildA11yTree(dom.nodes, dom.rootId, dom.focusedId);
  // One set of per-extraction indexes for the conversion, which asks of
  // each option whether the tree withheld its state (withheldSuppliedAttrs):
  // a page with no sensitive field then answers once.
  const { nodes, folded } = withAriaOwnerIndex(() => ({
    nodes: toValidatedNodes(a11y),
    folded: foldedDiscards(dom, a11y),
  }));
  const label = (n: ValidatedNode) =>
    n.name ? `${n.role} "${n.name}"` : n.role;
  const errors: string[] = [];
  for (const node of [...nodes.values(), ...folded]) {
    for (const issue of validateNode(node, nodes)) {
      if (issue.severity === "error")
        errors.push(`${label(node)} — ${issue.message}`);
    }
  }
  for (const [id, list] of validateTree(nodes)) {
    const node = nodes.get(id);
    if (!node) continue;
    for (const issue of list) {
      if (issue.severity === "error")
        errors.push(`${label(node)} — ${issue.message}`);
    }
  }
  const pass = errors.length === 0;
  return {
    pass,
    message: () =>
      pass
        ? "expected the accessibility tree to have ARIA violations, but it was valid"
        : [
            `Accessibility tree has ${errors.length} ARIA violation(s):`,
            ...errors.map((e) => `  ✖ ${e}`),
          ].join("\n"),
  };
}

// ─── contract matcher ────────────────────────────────────────────────────────

/**
 * Assert a DOM root (extracted on the spot) or an already-serialized tree
 * string SATISFIES an authored a11y contract — containment by default (extra
 * nodes allowed), `{ strict: true }` for exact equality.
 *
 * Backed by `verifyContract` in `./contract.ts`, which is INTERNAL to this
 * package: the engine is framework-agnostic (text in, verdict out) so it can
 * be lifted into a shared package when a second consumer appears — a CLI
 * `verify` verb — rather than committing to a placement now.
 */
function toMatchA11yContract(
  received: unknown,
  contractText: string,
  options: VerifyContractOptions = {},
): MatcherResult {
  let targetText: string;
  if (received instanceof Element) {
    const writes = contractWrites(contractText);
    // The DOM producer doesn't read `haspopup` or `roledescription`, so such a
    // token can't match an Element's tree: a failure is what `.not` inverts,
    // and the negated form would pass on nothing. Throw instead.
    const native = writes.nativeOnly[0];
    if (native) {
      throw new TypeError(
        `toMatchA11yContract: contract line ${native.line} asserts \`${native.token}\`, which a DOM Element's tree never carries: the DOM producer doesn't read that key yet, only Chromium's native tree does. Check it against native tree text (the Playwright adapter's \`tree: "native"\`, \`real-a11y tree\`), or remove it.`,
      );
    }
    // A contract that writes `= "value"` needs a tree that prints values, or
    // every value reads as missing and `.not` passes on nothing. Only then:
    // values also bring a role-less editor in as a `generic` line, which
    // would change the tree a strict contract without values compares.
    // Likewise states: a contract that writes no block compares the tree it
    // always did, without the `generic` lines a state brings in (a
    // `<details>` summary's `expanded`), which a strict contract would miss.
    targetText = serializeTree(received, {
      values: writes.values,
      states: writes.states,
    });
  } else if (typeof received === "string") {
    targetText = received;
  } else {
    // Throw, don't return `pass: false` — see `requireElement`. This matcher
    // takes either shape, so it can't use that helper directly.
    throw new TypeError(
      `toMatchA11yContract: expected a DOM Element or a serialized tree string, received ${describe(received)}`,
    );
  }

  const result = verifyContract(contractText, targetText, options);
  return {
    pass: result.pass,
    message: () =>
      result.pass
        ? `expected the tree NOT to satisfy the a11y contract, but all ${result.total} contract nodes matched`
        : result.message,
  };
}

// ─── the matcher bundle ──────────────────────────────────────────────────────

export const a11yMatchers = {
  toHaveNoUnlabeledInteractive(received: unknown) {
    return runAssertion(
      received,
      assertNoUnlabeledInteractive,
      "toHaveNoUnlabeledInteractive",
    );
  },
  toHaveValidHeadingOrder(received: unknown) {
    return runAssertion(
      received,
      assertHeadingOrder,
      "toHaveValidHeadingOrder",
    );
  },
  toHaveLabeledDialogs(received: unknown) {
    return runAssertion(received, assertDialogsLabeled, "toHaveLabeledDialogs");
  },
  toHaveValidLandmarks(received: unknown) {
    return runAssertion(
      received,
      assertLandmarkStructure,
      "toHaveValidLandmarks",
    );
  },
  toHaveTabSequence,
  toBeValidA11yTree,
  toMatchA11yContract,
};

// ─── snapshot serializer ─────────────────────────────────────────────────────

/**
 * Wrap a DOM root (or pre-extracted tree) so `expect(...).toMatchSnapshot()`
 * prints the deterministic a11y tree via the registered serializer, instead of
 * the framework's default DOM-element dump. Without the serializer registered,
 * the snapshot holds the same text as a quoted string. (`a11yDiff` produces the
 * same box shape for a change list — one serializer renders both.)
 */
export function boxedTreeSnapshot(
  root: Element | Tree,
  options?: SerializeOptions,
): A11ySnapshotBox {
  return boxPrinted(root, options, {
    print: serializeTree,
    mode: options?.mode ?? "a11y",
  });
}

/**
 * `tabSequenceSnapshot` as a box: the same text, byte for byte. What the box
 * adds is the snapshot report: the record keeps the tree the sequence was
 * printed from, and opens it on the panel's TAB view. A `tabSequenceSnapshot`
 * string reaches no report. (A committed string snapshot changes once on the
 * switch, losing the quotes a string prints with.)
 */
export function boxedTabSequenceSnapshot(
  root: Element | Tree,
  options?: SerializeOptions,
): A11ySnapshotBox {
  return boxPrinted(root, options, {
    print: serializeTabSequence,
    mode: "a11y",
    view: "tab",
  });
}

/**
 * `outlineSnapshot` as a box: the same text, byte for byte. What the box adds
 * is the snapshot report: the record keeps the tree the outline was printed
 * from, and opens it on the panel's headings filter. An `outlineSnapshot`
 * string reaches no report. (A committed string snapshot changes once on the
 * switch, losing the quotes a string prints with.)
 */
export function boxedOutlineSnapshot(
  root: Element | Tree,
  options?: SerializeOptions,
): A11ySnapshotBox {
  return boxPrinted(root, options, {
    print: serializeOutline,
    mode: "a11y",
    view: "headings",
  });
}

/** How a boxed snapshot prints its text, and where its record opens. */
interface Printing {
  print: (input: Element | Tree, options?: SerializeOptions) => string;
  /** The read `print` makes of a root: always `"a11y"` but for a tree's. */
  mode: "a11y" | "dom";
  view?: SnapshotView;
}

function boxPrinted(
  root: Element | Tree,
  options: SerializeOptions | undefined,
  { print, mode, view }: Printing,
): A11ySnapshotBox {
  // Anything but a tree or an element goes to `print` as it came, so its
  // input check throws the same error with the recorder on as off.
  if (!isRecording() || !(isTree(root) || isElement(root))) {
    return boxSnapshot(print(root, options));
  }
  // Recording: read the page once, now, and print the text from that read,
  // so the record is the tree the text describes even if the page changes
  // before the box is snapshotted.
  const tree = isTree(root)
    ? root
    : extract(root, mode, { redactInput: Boolean(options?.redactInput) });
  return boxSnapshot(print(tree, options), () => ({
    kind: "tree",
    tree,
    redact: options?.redact,
    ...(view ? { view } : {}),
  }));
}

function isTree(root: unknown): root is Tree {
  return (
    typeof root === "object" &&
    root !== null &&
    typeof (root as Partial<Tree>).rootId === "string"
  );
}

function isElement(root: unknown): root is Element {
  return typeof Element !== "undefined" && root instanceof Element;
}

// The pretty-format plugin lives in ./snapshot-box (shared with a11yDiff);
// re-exported here so existing `registerA11yMatchers` / import sites are unchanged.
export { a11ySnapshotSerializer };

// ─── registration ────────────────────────────────────────────────────────────

interface ExpectApi {
  extend(matchers: Record<string, unknown>): void;
  addSnapshotSerializer?(serializer: unknown): void;
  getState?(): { currentTestName?: string; testPath?: string };
}

/**
 * Register the matchers and snapshot serializer against an `expect` instance.
 * Call once from a test setup file:
 *
 * ```ts
 * import { expect } from "vitest";
 * import { registerA11yMatchers } from "@real-a11y-dev/testing/matchers";
 * import "@real-a11y-dev/testing/matchers/vitest"; // types
 * registerA11yMatchers(expect);
 * ```
 *
 * The types are a SEPARATE, opt-in import, one per runner — `./matchers/vitest`
 * for Vitest, `./matchers/jest` for Jest's global `expect`, and
 * `./matchers/jest-globals` if you `import { expect } from "@jest/globals"`,
 * which has its own type surface a `namespace jest` merge does not reach.
 * Import the one matching your runner; importing more than one is redundant
 * but harmless.
 *
 * `config`, when given, sets the project's defaults, as `configureA11y` from
 * `@real-a11y-dev/testing` does:
 *
 * ```ts
 * registerA11yMatchers(expect, { diff: { childIds: false } });
 * ```
 */
export function registerA11yMatchers(
  expect: ExpectApi,
  config?: A11yConfig,
): void {
  if (config) configureA11y(config);
  expect.extend(a11yMatchers);
  expect.addSnapshotSerializer?.(a11ySnapshotSerializer);
  // Where the snapshot viewer's recorder (off unless REAL_A11Y_TREES_DIR is
  // set) reads which test took a snapshot.
  bindSnapshotRecorder(expect);
}

// ─── type augmentation ───────────────────────────────────────────────────────
//
// The matcher signatures, shared by every framework's augmentation. Neither
// augmentation lives here: Vitest's is `./matchers/vitest`, Jest's is
// `./matchers/jest`, and a consumer imports the one matching their runner.
//
// Vitest's was always opt-in — `declare module "vitest"` would force a
// Jest-only consumer, who has no `vitest` installed, to resolve a module that
// isn't there. Jest's needs no module resolution, so it sat here as an
// unconditional `declare global` and looked free. It wasn't: Vitest's
// `Assertion` extends `JestAssertion`, so importing `./matchers` at all put
// these names on the jest global, the `vitest` augmentation put them there
// again, and TypeScript could not prove the two signatures identical (TS2320).

export interface A11yMatchers<R = unknown> {
  /** Every interactive node has a non-empty accessible name. */
  toHaveNoUnlabeledInteractive(): R;
  /** Exactly one `<h1>` and no skipped heading levels. */
  toHaveValidHeadingOrder(): R;
  /** Every dialog/alertdialog has an accessible name. */
  toHaveLabeledDialogs(): R;
  /** Exactly one `main`; at most one `banner`/`contentinfo`. */
  toHaveValidLandmarks(): R;
  /** Focusable nodes, in Tab order, equal the given `role "name"` tokens. */
  toHaveTabSequence(expected: string[]): R;
  /** The extracted a11y tree has no ARIA errors (roles, names, relationships). */
  toBeValidA11yTree(): R;
  /**
   * The tree (a DOM Element, extracted on the spot, or a serialized string)
   * satisfies an authored a11y contract — containment by default, `strict` for
   * exact equality.
   */
  toMatchA11yContract(contract: string, options?: VerifyContractOptions): R;
}

// No `declare global` here — see the note above `A11yMatchers`.
