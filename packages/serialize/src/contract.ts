// a11y contract verification — assert that a serialized tree SATISFIES an
// authored contract.
//
// A *contract* is a tree written in the same grammar `serializeTree` emits:
//
//     role "name" (level N) [focused]      — 2-space indent per depth
//
// plus authoring affordances the serializer never emits: blank lines, `#`
// comment lines, and an optional `---` frontmatter block (provenance — a source
// URL, an author) that is ignored for matching.
//
// Verification is CONTAINMENT, not equality — the `toMatchObject` of a11y trees:
//
//   * every contract node must appear in the target with the same role (and
//     name / level / focused when the contract specifies them — an omitted name
//     matches any name);
//   * each node must sit somewhere UNDER its contract parent's match (ancestor
//     semantics — intermediate wrappers in the implementation are fine, the same
//     way the serializer drops `generic` nodes);
//   * contract nodes must appear in document (pre-order) order;
//   * extra target nodes are always allowed.
//
// `strict: true` switches to exact tree equality — the contract behaves like a
// committed snapshot baseline.
//
// Matching is ordered tree embedding by backtracking — linear-ish for
// contract-sized trees, with a step guard against pathological ambiguity.

import { foldTypography } from "./normalize.js";

// ─── parsing ─────────────────────────────────────────────────────────────────

/** A node in a parsed a11y tree / contract. */
export interface ContractNode {
  role: string;
  /** Accessible name; `undefined` = unconstrained (matches any name). */
  name?: string;
  /** Heading level; `undefined` = unconstrained. */
  level?: number;
  /** `true` = must hold focus; `undefined` = unconstrained. */
  focused?: boolean;
  /** Depth in the parsed tree (0 = root), rebased to the shallowest line. */
  depth: number;
  /** 1-based line number in the source text, for messages. */
  line: number;
  children: ContractNode[];
}

export interface ParsedTree {
  roots: ContractNode[];
  /** Raw text between `---` fences at the top of the file, if present. */
  frontmatter?: string;
}

const FOCUSED_SUFFIX = " [focused]";
const LEVEL_SUFFIX_RE = / \(level (\d+)\)$/;
const ROLE_RE = /^[a-z][a-z0-9-]*$/;

function parseNodeLine(
  content: string,
  line: number,
  depth: number,
): ContractNode {
  let rest = content;
  let focused: boolean | undefined;
  if (rest.endsWith(FOCUSED_SUFFIX)) {
    focused = true;
    rest = rest.slice(0, -FOCUSED_SUFFIX.length);
  }
  let level: number | undefined;
  const levelMatch = LEVEL_SUFFIX_RE.exec(rest);
  if (levelMatch) {
    level = Number(levelMatch[1]);
    rest = rest.slice(0, -levelMatch[0].length);
  }
  let role = rest;
  let name: string | undefined;
  const space = rest.indexOf(" ");
  if (space !== -1) {
    role = rest.slice(0, space);
    const nameToken = rest.slice(space + 1);
    if (
      nameToken.length < 2 ||
      !nameToken.startsWith('"') ||
      !nameToken.endsWith('"')
    ) {
      throw new Error(
        `a11y contract line ${line}: cannot parse '${content}' — expected \`role "name" (level N) [focused]\``,
      );
    }
    name = nameToken.slice(1, -1);
  }
  if (!ROLE_RE.test(role)) {
    throw new Error(
      `a11y contract line ${line}: '${role}' does not look like a role`,
    );
  }
  return { role, name, level, focused, depth, line, children: [] };
}

export interface ParseOptions {
  /**
   * Reject indentation that jumps past the next level (`form` → 4-space child).
   * Right for a hand-authored contract, where a jump is a typo. Leave OFF
   * (default) for machine-emitted trees, which the parser attaches leniently to
   * the nearest shallower ancestor.
   */
  strictIndent?: boolean;
}

/**
 * Parse a serialized a11y tree — either an authored contract (may contain blank
 * lines, `#` comments, and a `---` frontmatter block) or the output of
 * {@link serializeTree}. Depths are rebased so the shallowest node sits at
 * depth 0, making a contract comparable to an extracted subtree regardless of
 * where it was copied from.
 */
export function parseA11yTree(
  text: string,
  options: ParseOptions = {},
): ParsedTree {
  const lines = text.split(/\r?\n/);
  const roots: ContractNode[] = [];
  const ancestors: ContractNode[] = []; // ancestors[d] = open node at depth d
  let frontmatter: string | undefined;

  let i = 0;
  while (i < lines.length && lines[i]!.trim() === "") i++;
  if (lines[i]?.trim() === "---") {
    const start = ++i;
    while (i < lines.length && lines[i]!.trim() !== "---") i++;
    if (i === lines.length) {
      throw new Error("a11y contract: unterminated `---` frontmatter block");
    }
    frontmatter = lines.slice(start, i).join("\n");
    i++;
  }

  // Pass 1 — content lines with their literal indent depth.
  const entries: { content: string; line: number; rawDepth: number }[] = [];
  for (; i < lines.length; i++) {
    const raw = lines[i]!;
    const trimmed = raw.trim();
    const line = i + 1;
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const indent = raw.length - raw.trimStart().length;
    if (indent % 2 !== 0) {
      throw new Error(
        `a11y contract line ${line}: ${indent}-space indent — the grammar indents 2 spaces per level`,
      );
    }
    entries.push({ content: trimmed, line, rawDepth: indent / 2 });
  }
  if (entries.length === 0) return { roots, frontmatter };

  // Pass 2 — rebase so the shallowest node is depth 0, then build, clamping a
  // deeper-than-possible jump onto the nearest open ancestor (unless strict).
  const base = Math.min(...entries.map((e) => e.rawDepth));
  for (const entry of entries) {
    const wanted = entry.rawDepth - base;
    if (options.strictIndent && wanted > ancestors.length) {
      throw new Error(
        `a11y contract line ${entry.line}: indent jumps to depth ${wanted} with no parent at depth ${wanted - 1}`,
      );
    }
    const depth = Math.min(wanted, ancestors.length);

    const node = parseNodeLine(entry.content, entry.line, depth);
    ancestors.length = depth;
    if (depth === 0) roots.push(node);
    else ancestors[depth - 1]!.children.push(node);
    ancestors.push(node);
  }

  return { roots, frontmatter };
}

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

function describeNode(node: ContractNode): string {
  const name = node.name !== undefined ? ` "${node.name}"` : "";
  const level = node.level !== undefined ? ` (level ${node.level})` : "";
  const focused = node.focused ? " [focused]" : "";
  return `${node.role}${name}${level}${focused}`;
}

function canonicalLines(roots: ContractNode[]): string[] {
  const out: string[] = [];
  const visit = (node: ContractNode) => {
    out.push(`${"  ".repeat(node.depth)}${describeNode(node)}`);
    for (const child of node.children) visit(child);
  };
  for (const root of roots) visit(root);
  return out;
}

// ─── containment matching ────────────────────────────────────────────────────

function nodeMatches(want: ContractNode, got: ContractNode): boolean {
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
  return true;
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

  const solve = (k: number, minT: number): boolean => {
    if (k === m) return true;
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

  const exact = candidates.filter((t) => nodeMatches(c.node, t.node));
  for (const t of exact.slice(0, 3)) {
    hints.push(
      `${describeNode(t.node)} exists (line ${t.node.line}) but violates the contract's order or nesting`,
    );
  }
  if (exact.length === 0) {
    const sameRole = candidates.filter((t) => t.node.role === c.node.role);
    for (const t of sameRole.slice(0, 3)) {
      hints.push(
        `same role, different name: ${describeNode(t.node)} (line ${t.node.line})`,
      );
    }
    if (c.node.name !== undefined) {
      const sameName = candidates.filter(
        (t) => t.node.name === c.node.name && t.node.role !== c.node.role,
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

function lineDiff(a: string[], b: string[]): string[] {
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
      out.push(`    ${a[i]}`);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push(`  - ${a[i]}`);
      i++;
    } else {
      out.push(`  + ${b[j]}`);
      j++;
    }
  }
  while (i < a.length) out.push(`  - ${a[i++]}`);
  while (j < b.length) out.push(`  + ${b[j++]}`);
  return out;
}

// ─── verification ────────────────────────────────────────────────────────────

export interface VerifyContractOptions {
  /**
   * Exact tree equality instead of containment (the contract behaves like a
   * committed snapshot baseline). Unlike containment, strict is byte-exact on
   * names — no typography folding — because exactness is the whole point.
   * Default false.
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
 * verdict out — the {@link https://real-a11y.dev/packages/testing/matchers
 * `toMatchA11yContract`} matcher and a CLI `verify` verb are thin wrappers over
 * this. `targetText` is typically {@link serializeTree} output (or a committed
 * snapshot artifact).
 */
export function verifyContract(
  contractText: string,
  targetText: string,
  options: VerifyContractOptions = {},
): VerifyContractResult {
  // The contract is authored by hand — an indent jump is a typo worth
  // reporting. The target is machine-emitted, where jumps are legitimate.
  const contract = parseA11yTree(contractText, { strictIndent: true });
  if (contract.roots.length === 0) {
    throw new Error("a11y contract: no nodes — the contract is empty");
  }
  const target = parseA11yTree(targetText);

  if (options.strict) {
    const want = canonicalLines(contract.roots);
    const got = canonicalLines(target.roots);
    const pass = want.join("\n") === got.join("\n");
    return {
      pass,
      matched: pass ? want.length : 0,
      total: want.length,
      message: pass
        ? ""
        : [
            "a11y contract not satisfied (strict): trees differ.",
            "",
            "  - contract   + received",
            "",
            ...lineDiff(want, got),
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
