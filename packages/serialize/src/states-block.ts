/**
 * The `{…}` states block of a serialized tree or tab line: the states,
 * description and announced properties a screen reader presents beyond role
 * and name.
 *
 * ```
 * role "name" = "value" (level N) {checked=false, description="…"} [focused]
 * ```
 *
 * The block comes after `(level N)` and before the `[focused]` marker, so it
 * always ends the line once the marker is set aside, and a reader can find it
 * with an end-anchored match. Inside it, tokens are separated by `, `; each is
 * `key`, `key=word` or `key="JSON string"`. Free text (a description, a role
 * description) is JSON-quoted, so a `}`, a `, ` or a quote inside it never
 * ends the block early.
 *
 * The grammar lives here, next to the serializer, so the code that will write
 * the block and every reader of the text (the contract parser, the snapshot
 * diff's line parser, the DOM↔native parity harness) agree on one definition.
 */

/** One token: `key`, `key=word` or `key="JSON string"`. Kept permissive
 * (any case, digits, `.`, `_`, `-`) so a value the writer adds later, a
 * number or a mixed-case token, still reads as a block. The JSON string is
 * written unrolled (runs of plain characters between escapes), so the regex
 * engine keeps one backtrack entry per escape rather than per character: the
 * `(?:[^"\\]|\\.)*` form overflows V8's stack on a quoted run of about ten
 * million characters. */
const TOKEN = String.raw`[A-Za-z][\w-]*(?:=(?:[\w.-]+|"[^"\\]*(?:\\.[^"\\]*)*"))?`;

/** A whole block at the end of a line: ` {token, token}`. */
const BLOCK_RE = new RegExp(String.raw` \{(${TOKEN}(?:, ${TOKEN})*)\}$`);

/** Every token of a block's contents, in order. */
const TOKENS_RE = new RegExp(TOKEN, "g");

export interface SplitStatesBlock {
  /** The line without its block. */
  line: string;
  /**
   * The block's contents without the braces (`checked=false, required`), or
   * `undefined` when the line has no block.
   */
  block?: string;
}

/**
 * Split the `{…}` states block off one serialized tree or tab line. Pass the
 * line without its ` [focused]` marker: the block comes before the marker,
 * and every reader strips the marker first. A line with no block comes back
 * unchanged.
 *
 * Only a block that ends the line counts: a name that merely contains `{…}`
 * sits inside its quotes, before the end, so it is never mistaken for one.
 * Outline lines (`h2 Name`) print heading text unquoted and never carry a
 * block; don't pass them here, or a heading ending in ` {word}` reads as one.
 *
 * @internal Shared by the packages that read serialized trees; not public.
 */
export function splitStatesBlock(line: string): SplitStatesBlock {
  const match = BLOCK_RE.exec(line);
  if (!match) return { line };
  return { line: line.slice(0, match.index), block: match[1] };
}

/**
 * The tokens of a block's contents, as {@link splitStatesBlock} returns them:
 * `checked=false, description="a, b"` → `["checked=false",
 * 'description="a, b"']`. A JSON string stays whole, whatever it holds.
 *
 * @internal Shared by the packages that read serialized trees; not public.
 */
export function statesTokens(block: string): string[] {
  return block.match(TOKENS_RE) ?? [];
}
