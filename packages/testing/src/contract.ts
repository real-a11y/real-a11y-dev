// a11y contract verification — assert that a serialized tree SATISFIES an
// authored contract.
//
// INTERNAL to this package: `toMatchA11yContract` is the public surface. The
// engine is deliberately framework-agnostic (pure text in, verdict out) so that
// when a second consumer appears — a CLI `verify` verb — it can be lifted into
// a shared package. Until then it stays private rather than committing a
// package's public API to a placement we'd likely move.
//
// A *contract* is a tree written in the same grammar `serializeTree` emits:
//
//     role "name" = "value" (level N) {states} [focused]   — 2-space indent
//
// The `= "value"` (printed with `values: true`) and the `{…}` states block
// (`checkbox "Subscribe" {checked}`: the states, description and announced
// properties) are each optional. A contract line without one says nothing
// about it; a line with one asserts it. `{}` asserts the node has no states.
//
// plus authoring affordances the serializer never emits: blank lines, `#`
// comment lines, and an optional `---` frontmatter block (provenance — a source
// URL, an author) that is ignored for matching.
//
// Verification is CONTAINMENT, not equality — the `toMatchObject` of a11y trees:
//
//   * every contract node must appear in the target with the same role (and
//     name / level / focused when the contract specifies them — an omitted name
//     matches any name), and with at least the tokens of its states block,
//     when it has one;
//   * each node must sit somewhere UNDER its contract parent's match (ancestor
//     semantics — intermediate wrappers in the implementation are fine, the same
//     way the serializer drops `generic` nodes);
//   * contract nodes must appear in document (pre-order) order;
//   * extra target nodes are always allowed.
//
// `strict: true` switches to exact tree equality — the contract behaves like a
// committed snapshot baseline. A states block, where the contract writes one,
// must then hold exactly the received node's tokens (in any order); a line
// without one still says nothing about states.
//
// Matching is ordered tree embedding by backtracking — linear-ish for
// contract-sized trees, with a step guard against pathological ambiguity.

import { foldTypography, tokenProducers } from "@real-a11y-dev/serialize";

import { parseA11yTree, type ContractNode } from "./contract-parse.js";

export { parseA11yTree } from "./contract-parse.js";
export type {
  ContractNode,
  ParsedTree,
  ParseOptions,
} from "./contract-parse.js";

// ─── flattening ──────────────────────────────────────────────────────────────

interface FlatNode {
  node: ContractNode;
  /** Index of the parent in the flat pre-order list, or -1 for roots. */
  parent: number;
  /** Exclusive pre-order index where this node's subtree ends. */
  subtreeEnd: number;
}

function flatten(roots: ContractNode[]): FlatNode[] {
  const flat: FlatNode[] = [];
  const visit = (node: ContractNode, parent: number) => {
    const index = flat.length;
    flat.push({ node, parent, subtreeEnd: -1 });
    for (const child of node.children) visit(child, index);
    flat[index]!.subtreeEnd = flat.length;
  };
  for (const root of roots) visit(root, -1);
  return flat;
}

/** What {@link describeNode} prints beyond role, name, level and focus. */
interface Shown {
  /** The block's tokens to print, `[]` printing `{}`; `null` prints none. */
  states: string[] | null;
  value: boolean;
}

/** A node as a line of the grammar, by default with its own value and block. */
function describeNode(
  node: ContractNode,
  shown: Shown = {
    states: node.states ?? null,
    value: node.value !== undefined,
  },
): string {
  const name = node.name !== undefined ? ` "${node.name}"` : "";
  const value =
    shown.value && node.value !== undefined
      ? ` = ${JSON.stringify(node.value)}`
      : "";
  const level = node.level !== undefined ? ` (level ${node.level})` : "";
  const block = shown.states ? ` {${shown.states.join(", ")}}` : "";
  const focused = node.focused ? " [focused]" : "";
  return `${node.role}${name}${value}${level}${block}${focused}`;
}

interface StrictLines {
  /** Compared for equality: blocks with their tokens sorted. */
  compare: { want: string[]; got: string[] };
  /** Shown in the diff: each side's block as written. */
  show: { want: string[]; got: string[] };
}

/**
 * Both trees as indented lines for strict equality. When their shapes agree,
 * line `i` of each prints a value and a block only where contract line `i`
 * writes one: a line without one says nothing about it. A block compares with
 * its tokens sorted, so order doesn't matter, but shows as each side has it;
 * a received node with no states shows `{}`. When the shapes differ, the
 * structure is what's wrong, and both print bare, since a value or block would
 * otherwise be compared across lines that don't correspond.
 */
function strictLines(
  contract: ContractNode[],
  target: ContractNode[],
): StrictLines {
  const want = flatten(contract).map((f) => f.node);
  const got = flatten(target).map((f) => f.node);
  const indent = (node: ContractNode) => "  ".repeat(node.depth);
  const bare = (nodes: ContractNode[]) =>
    nodes.map(
      (n) => indent(n) + describeNode(n, { states: null, value: false }),
    );
  const wantBare = bare(want);
  const gotBare = bare(got);
  if (wantBare.join("\n") !== gotBare.join("\n")) {
    const lines = { want: wantBare, got: gotBare };
    return { compare: lines, show: lines };
  }
  const render = (sortTokens: boolean) => (node: ContractNode, i: number) => {
    const asserted = want[i]!;
    const tokens = node.states ?? [];
    return (
      indent(node) +
      describeNode(node, {
        states:
          asserted.states === undefined
            ? null
            : sortTokens
              ? [...tokens].sort()
              : tokens,
        value: asserted.value !== undefined,
      })
    );
  };
  return {
    compare: { want: want.map(render(true)), got: got.map(render(true)) },
    show: { want: want.map(render(false)), got: got.map(render(false)) },
  };
}

/** Whether any node of a parsed tree carries a `{…}` block (`{}` included). */
const anyStates = (roots: ContractNode[]) =>
  flatten(roots).some((f) => f.node.states !== undefined);

/** What an authored contract writes on any of its lines. */
export interface ContractWrites {
  /** A field value, `= "value"`. */
  values: boolean;
  /** Tokens only the native producer prints (`haspopup=menu`,
   *  `roledescription="slide"`), with the line each is on. */
  nativeOnly: { token: string; line: number }[];
}

/**
 * Whether an authored contract writes a field value on any line, and which of
 * its tokens only the native producer prints.
 *
 * @internal For `toMatchA11yContract`, which serializes a DOM Element with
 * values only when the contract asserts one, and can't match a native-only
 * token against an Element's tree.
 */
export function contractWrites(contractText: string): ContractWrites {
  const nodes = flatten(
    parseA11yTree(contractText, { strictIndent: true, authored: true }).roots,
  ).map((f) => f.node);
  return {
    values: nodes.some((n) => n.value !== undefined),
    nativeOnly: nodes.flatMap((n) =>
      (n.states ?? [])
        .filter((token) => tokenProducers(token) === "native")
        .map((token) => ({ token, line: n.line })),
    ),
  };
}

// ─── containment matching ────────────────────────────────────────────────────

/**
 * A state token as containment compares it: a quoted value decoded and its
 * typography folded, as names are, so `description="We don't"` matches a
 * curly apostrophe, and a curly double quote matches a typed `\"`.
 */
function tokenKey(token: string): string {
  const eq = token.indexOf("=");
  if (eq === -1) return token;
  let value = token.slice(eq + 1);
  if (value.startsWith('"')) {
    try {
      value = JSON.parse(value) as string;
    } catch {
      // Not valid JSON (an unknown escape): compare it as written.
    }
  }
  return `${token.slice(0, eq)}=${foldTypography(value)}`;
}

/** The contract's state tokens the received node doesn't carry. Decoding
 *  the received tokens costs a JSON parse and a fold each, so a contract line
 *  that writes no tokens skips it. */
function missingStates(want: ContractNode, got: ContractNode): string[] {
  if (!want.states?.length) return [];
  const have = new Set((got.states ?? []).map(tokenKey));
  return want.states.filter((token) => !have.has(tokenKey(token)));
}

/** Whether `got`'s states satisfy `want`'s block: none written passes, `{}`
 *  requires no states, any other block at least its tokens. */
function statesMatch(want: ContractNode, got: ContractNode): boolean {
  if (want.states === undefined) return true;
  if (want.states.length === 0) return (got.states ?? []).length === 0;
  return missingStates(want, got).length === 0;
}

function nodeMatches(
  want: ContractNode,
  got: ContractNode,
  checkStates = true,
): boolean {
  if (want.role !== got.role) return false;
  // Names compare with typography folded (a hand-typed straight quote matches a
  // rendered curly one) but case-sensitively — the contract's name is the exact
  // text it asserts, minus smart-quote noise.
  if (
    want.name !== undefined &&
    foldTypography(want.name) !== foldTypography(got.name ?? "")
  ) {
    return false;
  }
  if (want.level !== undefined && want.level !== got.level) return false;
  if (want.focused && !got.focused) return false;
  // A value compares like a name: typography folded, case-sensitive.
  if (
    want.value !== undefined &&
    (got.value === undefined ||
      foldTypography(want.value) !== foldTypography(got.value))
  ) {
    return false;
  }
  return !checkStates || statesMatch(want, got);
}

/** Backtracking-step guard — contract trees are small; this only trips on
 *  pathological ambiguity (many identical unnamed siblings). */
const MAX_STEPS = 200_000;

interface SearchOutcome {
  /** Full assignment (contract index → target index) when the match succeeds. */
  assigned: number[] | null;
  /** Deepest contract index the search reached before failing. */
  bestK: number;
  /** Assignments for contract indices `< bestK` at the deepest attempt. */
  bestAssigned: number[];
}

function search(contract: FlatNode[], target: FlatNode[]): SearchOutcome {
  const m = contract.length;
  const n = target.length;
  const assigned = new Array<number>(m).fill(-1);
  let bestK = -1;
  let bestAssigned: number[] = [];
  let steps = 0;

  // Memoize FAILED states. Without this the search is exponential on the
  // *failure* path — proving a mismatch means exhausting every assignment, and
  // an unconstrained contract node (no name) matches every same-role node in
  // the target, so C(targets, contractNodes) combinations get re-explored. A
  // contract with a handful of unnamed nodes against a real page would blow the
  // step guard and throw instead of reporting a clean mismatch.
  //
  // Whether `solve(k, minT)` can succeed is fully determined by `k`, `minT`,
  // and the assignments of k's ANCESTORS: in pre-order every later node's
  // parent is an ancestor of k (or of a node after it), so no other earlier
  // choice can influence the outcome. That makes the key sound, and contracts
  // are shallow, so it stays short.
  const failed = new Set<string>();
  const stateKey = (k: number, minT: number): string => {
    let key = `${k}:${minT}`;
    for (let p = contract[k]!.parent; p !== -1; p = contract[p]!.parent) {
      key += `|${p}=${assigned[p]}`;
    }
    return key;
  };

  const solve = (k: number, minT: number): boolean => {
    if (k === m) return true;
    const key = stateKey(k, minT);
    if (failed.has(key)) return false;
    const c = contract[k]!;
    const parentT = c.parent === -1 ? -1 : assigned[c.parent]!;
    const lo = Math.max(minT, parentT + 1);
    const hi = c.parent === -1 ? n : target[parentT]!.subtreeEnd;

    for (let t = lo; t < hi; t++) {
      if (++steps > MAX_STEPS) {
        throw new Error(
          "a11y contract: matching gave up — the contract is too ambiguous (many indistinguishable nodes)",
        );
      }
      if (!nodeMatches(c.node, target[t]!.node)) continue;
      assigned[k] = t;
      if (solve(k + 1, t + 1)) return true;
    }

    if (k > bestK) {
      bestK = k;
      bestAssigned = assigned.slice(0, k);
    }
    assigned[k] = -1;
    failed.add(key);
    return false;
  };

  const found = solve(0, 0);
  return { assigned: found ? assigned : null, bestK, bestAssigned };
}

// ─── failure rendering ───────────────────────────────────────────────────────

function renderAnnotated(
  contract: FlatNode[],
  target: FlatNode[],
  outcome: SearchOutcome,
): string {
  return contract
    .map((c, k) => {
      const line = `${"  ".repeat(c.node.depth)}${describeNode(c.node)}`;
      if (k < outcome.bestK) {
        const t = target[outcome.bestAssigned[k]!]!;
        return `  ✓ ${line}   (line ${t.node.line})`;
      }
      if (k === outcome.bestK) return `  ✖ ${line}   ← NOT FOUND`;
      return `  · ${line}`;
    })
    .join("\n");
}

/** How a node's states fail a block: the tokens it lacks, or the states it
 *  has where `{}` asked for none. */
function stateMismatch(want: ContractNode, got: ContractNode): string {
  return want.states?.length === 0
    ? `has states {${(got.states ?? []).join(", ")}}`
    : `missing ${missingStates(want, got).join(", ")}`;
}

/** The first thing other than role that keeps `got` from matching `want`. */
function difference(want: ContractNode, got: ContractNode): string {
  if (
    want.name !== undefined &&
    foldTypography(want.name) !== foldTypography(got.name ?? "")
  )
    return "different name";
  if (want.level !== undefined && want.level !== got.level)
    return "different level";
  if (
    want.value !== undefined &&
    !nodeMatches({ ...want, states: undefined, focused: undefined }, got, false)
  )
    return "different value";
  if (want.focused && !got.focused) return "not focused";
  return "different states";
}

function hintsFor(
  contract: FlatNode[],
  target: FlatNode[],
  outcome: SearchOutcome,
): string[] {
  const k = outcome.bestK;
  const c = contract[k]!;
  const hints: string[] = [];

  // A target node already claimed by an earlier contract node can't be the
  // thing we're missing — suggesting it just sends the reader in circles.
  const claimed = new Set(outcome.bestAssigned);
  const candidates = target.filter((_, i) => !claimed.has(i));

  // A block can't match a tree that prints none: say so, rather than leave
  // the reader to diff states the received text doesn't carry.
  if (c.node.states?.length && !target.some((t) => t.node.states)) {
    hints.push("the received tree prints no {…} states blocks");
  }

  // Nodes that match on everything but their states come first, from every
  // candidate: in a list or table the one that matters is often not among the
  // first few of its role, and may sit beside a full match elsewhere.
  const statesOnly = c.node.states
    ? candidates.filter(
        (t) =>
          nodeMatches(c.node, t.node, false) && !statesMatch(c.node, t.node),
      )
    : [];
  for (const t of statesOnly.slice(0, 3)) {
    hints.push(
      `${c.node.name !== undefined ? "same role and name" : "same role"}, ${stateMismatch(c.node, t.node)}: ${describeNode(t.node)} (line ${t.node.line})`,
    );
  }

  const exact = candidates.filter((t) => nodeMatches(c.node, t.node));
  for (const t of exact.slice(0, 3)) {
    hints.push(
      `${describeNode(t.node)} exists (line ${t.node.line}) but violates the contract's order or nesting`,
    );
  }
  if (exact.length === 0) {
    const sameRole = candidates.filter(
      (t) => t.node.role === c.node.role && !statesOnly.includes(t),
    );
    for (const t of sameRole.slice(0, 3)) {
      hints.push(
        `same role, ${difference(c.node, t.node)}: ${describeNode(t.node)} (line ${t.node.line})`,
      );
    }
    if (c.node.name !== undefined) {
      // Fold typography here too — matching does, and this is the hint that
      // actually explains a role swap ("is the button rendered as a link?").
      // Comparing byte-for-byte would drop it precisely when the page uses
      // smart punctuation.
      const wantName = foldTypography(c.node.name);
      const sameName = candidates.filter(
        (t) =>
          t.node.name !== undefined &&
          foldTypography(t.node.name) === wantName &&
          t.node.role !== c.node.role,
      );
      for (const t of sameName.slice(0, 3)) {
        hints.push(
          `same name, different role: ${describeNode(t.node)} (line ${t.node.line}) — is the ${c.node.role} rendered as a ${t.node.role}?`,
        );
      }
    }
  }
  return hints;
}

function numberedTree(text: string): string {
  const lines = text.split("\n");
  const width = String(lines.length).length;
  return lines
    .map((l, i) => `  ${String(i + 1).padStart(width)}  ${l}`)
    .join("\n");
}

// ─── strict diff (tiny LCS) ──────────────────────────────────────────────────

/** An LCS line diff of `a` against `b`, printed with `showA` / `showB`: the
 *  lines a strict comparison matched on can differ from the ones it shows. */
function lineDiff(
  a: string[],
  b: string[],
  showA: string[] = a,
  showB: string[] = b,
): string[] {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i]![j] =
        a[i] === b[j]
          ? dp[i + 1]![j + 1]! + 1
          : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push(`    ${showA[i]}`);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push(`  - ${showA[i]}`);
      i++;
    } else {
      out.push(`  + ${showB[j]}`);
      j++;
    }
  }
  while (i < a.length) out.push(`  - ${showA[i++]}`);
  while (j < b.length) out.push(`  + ${showB[j++]}`);
  return out;
}

// ─── verification ────────────────────────────────────────────────────────────

export interface VerifyContractOptions {
  /**
   * Exact tree equality instead of containment (the contract behaves like a
   * committed snapshot baseline). Unlike containment, strict is byte-exact on
   * names and state tokens — no typography folding — because exactness is the
   * whole point. A `{…}` block, where the contract writes one, must hold
   * exactly the received node's tokens, in any order; a line without one
   * still says nothing about states. Default false.
   */
  strict?: boolean;
}

export interface VerifyContractResult {
  /** Whether the target satisfies the contract. */
  pass: boolean;
  /** Contract nodes matched (equals `total` on pass). */
  matched: number;
  /** Total contract nodes. */
  total: number;
  /** Human-readable report; empty string on pass. */
  message: string;
}

/**
 * Verify a serialized target tree against an authored contract. Pure text in,
 * verdict out; `targetText` is typically `serializeTree` output (or a committed
 * snapshot artifact).
 *
 * @internal Not part of the public API. `toMatchA11yContract` is the supported
 * surface. This engine is framework-agnostic on purpose — when a second
 * consumer needs it (a CLI `verify` verb), extract it to a shared package
 * rather than exporting it from here.
 */
export function verifyContract(
  contractText: string,
  targetText: string,
  options: VerifyContractOptions = {},
): VerifyContractResult {
  // The contract is authored by hand — an indent jump is a typo worth
  // reporting. The target is machine-emitted, where jumps are legitimate.
  const contract = parseA11yTree(contractText, {
    strictIndent: true,
    authored: true,
  });
  if (contract.roots.length === 0) {
    throw new Error("a11y contract: no nodes — the contract is empty");
  }
  const target = parseA11yTree(targetText);

  if (options.strict) {
    const { compare, show } = strictLines(contract.roots, target.roots);
    const pass = compare.want.join("\n") === compare.got.join("\n");
    // As in containment, say so when a block meets a tree that prints none,
    // or the diff reads as "this node lacks that state".
    const noBlocks =
      !pass && anyStates(contract.roots) && !anyStates(target.roots)
        ? ["", "  note: the received tree prints no {…} states blocks"]
        : [];
    return {
      pass,
      matched: pass ? compare.want.length : 0,
      total: compare.want.length,
      message: pass
        ? ""
        : [
            "a11y contract not satisfied (strict): trees differ.",
            "",
            "  - contract   + received",
            "",
            ...lineDiff(compare.want, compare.got, show.want, show.got),
            ...noBlocks,
          ].join("\n"),
    };
  }

  const flatContract = flatten(contract.roots);
  const flatTarget = flatten(target.roots);
  const outcome = search(flatContract, flatTarget);

  if (outcome.assigned) {
    return {
      pass: true,
      matched: flatContract.length,
      total: flatContract.length,
      message: "",
    };
  }

  const k = outcome.bestK;
  const failing = flatContract[k]!;
  const parentK = failing.parent;
  const where =
    parentK === -1
      ? "at the top level"
      : `under ${describeNode(flatContract[parentK]!.node)} (matched line ${
          flatTarget[outcome.bestAssigned[parentK]!]!.node.line
        })`;
  const after =
    k > 0
      ? `, after ${describeNode(flatContract[k - 1]!.node)} (line ${
          flatTarget[outcome.bestAssigned[k - 1]!]!.node.line
        })`
      : "";
  const hints = hintsFor(flatContract, flatTarget, outcome);

  const message = [
    `a11y contract not satisfied: matched ${k}/${flatContract.length} nodes.`,
    "",
    renderAnnotated(flatContract, flatTarget, outcome),
    "",
    `  ✖ ${describeNode(failing.node)}: not found ${where}${after}.`,
    ...hints.map((h) => `    hint: ${h}`),
    "",
    "  Received a11y tree:",
    numberedTree(targetText),
  ].join("\n");

  return { pass: false, matched: k, total: flatContract.length, message };
}
