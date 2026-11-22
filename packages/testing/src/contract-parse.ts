// a11y contract parsing — read a serialized tree or an authored contract into
// nodes. Split out of contract.ts, which matches and reports; see its header
// for the grammar and what each part of a line asserts.
//
// INTERNAL to this package, like contract.ts.

import {
  splitStatesBlock,
  statesTokens,
  unprintableToken,
} from "@real-a11y-dev/serialize";

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
  /** Field value (`= "…"`, decoded); `undefined` = unconstrained. */
  value?: string;
  /**
   * The tokens of the line's `{…}` states block (`["checked",
   * 'description="x"']`); `[]` for `{}`, no states; `undefined` when the line
   * has none, which in a contract leaves states unconstrained.
   */
  states?: string[];
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
const EMPTY_BLOCK = " {}";
const LEVEL_SUFFIX_RE = / \(level (\d+)\)$/;
/** ` = "value"`, a JSON string, between the name and the level. */
const VALUE_SUFFIX_RE = / = ("[^"\\]*(?:\\.[^"\\]*)*")$/;
/** A whole label before a value: a role, or a role and a quoted name. A name
 *  prints unescaped, so `button "const s = "hello"` ends in what looks like a
 *  value; when the text before that suffix isn't a whole label, the suffix is
 *  part of the name. */
const LABEL_RE = /^[a-z][a-z0-9-]*(?: ".*")?$/;

/** A JSON string literal's text; as written, minus quotes, if it isn't valid
 *  JSON (an unknown escape). */
function decodeJsonString(literal: string): string {
  try {
    return JSON.parse(literal) as string;
  } catch {
    return literal.slice(1, -1);
  }
}
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
  let states: string[] | undefined;
  if (rest.endsWith(EMPTY_BLOCK)) {
    states = [];
    rest = rest.slice(0, -EMPTY_BLOCK.length);
  } else {
    const { line: withoutStates, block } = splitStatesBlock(rest);
    rest = withoutStates;
    if (block !== undefined) states = statesTokens(block);
  }
  let level: number | undefined;
  const levelMatch = LEVEL_SUFFIX_RE.exec(rest);
  if (levelMatch) {
    level = Number(levelMatch[1]);
    rest = rest.slice(0, -levelMatch[0].length);
  }
  let value: string | undefined;
  const valueMatch = VALUE_SUFFIX_RE.exec(rest);
  if (valueMatch && LABEL_RE.test(rest.slice(0, valueMatch.index))) {
    value = decodeJsonString(valueMatch[1]!);
    rest = rest.slice(0, valueMatch.index);
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
      // A quoted value keeps JSON escapes, which a template literal eats.
      const escapes = content.includes("{")
        ? ' A quoted value holding a " or a \\ needs its escapes kept: write the contract with String.raw or in a file.'
        : "";
      throw new Error(
        `a11y contract line ${line}: cannot parse '${content}' — expected \`role "name" = "value" (level N) {states} [focused]\`.${escapes}`,
      );
    }
    name = nameToken.slice(1, -1);
  }
  if (!ROLE_RE.test(role)) {
    throw new Error(
      `a11y contract line ${line}: '${role}' does not look like a role`,
    );
  }
  return {
    role,
    name,
    value,
    level,
    focused,
    states,
    depth,
    line,
    children: [],
  };
}

export interface ParseOptions {
  /**
   * Reject indentation that jumps past the next level (`form` → 4-space child).
   * Right for a hand-authored contract, where a jump is a typo. Leave OFF
   * (default) for machine-emitted trees, which the parser attaches leniently to
   * the nearest shallower ancestor.
   */
  strictIndent?: boolean;
  /**
   * Reject a states token the tree text never prints (`checked=true`,
   * `disabled=false`, a key it never carries), naming the form it prints
   * instead: such a token could never match. Right for an authored contract;
   * leave OFF for received text, which may come from another version.
   */
  authored?: boolean;
}

/** Throw on the first token in `node`'s block that tree text never prints. */
function checkPrintable(node: ContractNode): void {
  for (const token of node.states ?? []) {
    const problem = unprintableToken(token);
    if (problem) {
      throw new Error(
        `a11y contract line ${node.line}: ${problem} A token that never prints can never match.`,
      );
    }
  }
}

/** A content line of a contract, with its literal (un-rebased) indent depth. */
interface ContractEntry {
  content: string;
  line: number;
  rawDepth: number;
}

/**
 * Read an optional `---` frontmatter block that opens the text (after any
 * blank lines). Returns its body, if there is one, and the index of the first
 * line after it.
 */
function readFrontmatter(lines: string[]): {
  frontmatter: string | undefined;
  next: number;
} {
  let i = 0;
  while (i < lines.length && lines[i]!.trim() === "") i++;
  if (lines[i]?.trim() !== "---") return { frontmatter: undefined, next: i };
  const start = ++i;
  while (i < lines.length && lines[i]!.trim() !== "---") i++;
  if (i === lines.length) {
    throw new Error("a11y contract: unterminated `---` frontmatter block");
  }
  return { frontmatter: lines.slice(start, i).join("\n"), next: i + 1 };
}

/**
 * Collect the content lines from `start` on, skipping blank lines and `#`
 * comments, each with its literal indent depth.
 */
function readEntries(lines: string[], start: number): ContractEntry[] {
  const entries: ContractEntry[] = [];
  for (let i = start; i < lines.length; i++) {
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
  return entries;
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
  const { frontmatter, next } = readFrontmatter(lines);

  // Pass 1 — content lines with their literal indent depth.
  const entries = readEntries(lines, next);
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
    if (options.authored) checkPrintable(node);
    ancestors.length = depth;
    if (depth === 0) roots.push(node);
    else ancestors[depth - 1]!.children.push(node);
    ancestors.push(node);
  }

  return { roots, frontmatter };
}
