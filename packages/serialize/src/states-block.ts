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

/** The trailing focus marker `serializeTree` and `serializeTabSequence` add. */
const FOCUS_MARKER = " [focused]";

/** One token: `key`, `key=word` or `key="JSON string"`. */
const TOKEN = String.raw`[a-z][a-z0-9]*(?:=(?:[a-z0-9-]+|"(?:[^"\\]|\\.)*"))?`;

/** A whole block at the end of a line: ` {token, token}`. */
const BLOCK_RE = new RegExp(String.raw` \{(${TOKEN}(?:, ${TOKEN})*)\}$`);

export interface SplitStatesBlock {
  /** The line without its block. A trailing ` [focused]` marker is kept. */
  line: string;
  /**
   * The block's contents without the braces (`checked=false, required`), or
   * `undefined` when the line has no block.
   */
  block?: string;
}

/**
 * Split the `{…}` states block off one serialized tree or tab line. The line
 * may end with the ` [focused]` marker; the marker stays on the returned line.
 * A line with no block comes back unchanged.
 *
 * Only a block that ends the line counts: a name that merely contains `{…}`
 * sits inside its quotes, before the end, so it is never mistaken for one.
 *
 * @internal Shared by the packages that read serialized trees; not public.
 */
export function splitStatesBlock(line: string): SplitStatesBlock {
  const focused = line.endsWith(FOCUS_MARKER);
  const body = focused ? line.slice(0, -FOCUS_MARKER.length) : line;
  const match = BLOCK_RE.exec(body);
  if (!match) return { line };
  const rest = body.slice(0, match.index);
  return { line: focused ? rest + FOCUS_MARKER : rest, block: match[1] };
}
