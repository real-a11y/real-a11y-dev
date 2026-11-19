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
 * The grammar lives here, next to the writer ({@link statesBlock}), so the
 * serializer and every reader of the text (the contract parser, the snapshot
 * diff's line parser, the DOM↔native parity harness) agree on one definition.
 */

import type { A11yInfo } from "@real-a11y-dev/core";

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

// ─── the writer ──────────────────────────────────────────────────────────────

type StateValue = string | boolean | undefined;

/** A state value as one of true, false, `"mixed"`, a token, or absent. Both
 *  producers hand booleans, but a string `"true"`/`"false"` reads the same. */
function stateWord(value: StateValue): string | boolean | undefined {
  if (value === "true") return true;
  if (value === "false" || value === "") return false;
  return value;
}

/** `key=value`, bare when the value is a word, JSON-quoted otherwise, so any
 *  token a producer reports still reads back through the grammar. */
function keyed(key: string, value: string): string {
  return /^[a-z0-9-]+$/.test(value)
    ? `${key}=${value}`
    : `${key}=${JSON.stringify(value)}`;
}

/** checked, pressed: `key`, `key=false`, `key=mixed` (or another token). */
function tristate(key: string, value: StateValue): string | undefined {
  const word = stateWord(value);
  if (word === undefined) return undefined;
  if (word === true) return key;
  if (word === false) return `${key}=false`;
  return keyed(key, word);
}

/** expanded: `expanded` or `expanded=false`. */
function twoState(key: string, value: StateValue): string | undefined {
  const word = stateWord(value);
  if (word === true) return key;
  if (word === false) return `${key}=false`;
  return undefined;
}

/** selected, disabled, readonly, required: only when true; false is absent. */
function whenTrue(key: string, value: StateValue): string | undefined {
  return stateWord(value) === true ? key : undefined;
}

/** invalid: bare for any truthy value, so `grammar` and `spelling` read as
 *  `invalid` and native's default `invalid=false` prints nothing. */
function whenTruthy(key: string, value: StateValue): string | undefined {
  const word = stateWord(value);
  return word === undefined || word === false ? undefined : key;
}

/** current, haspopup: `key` for true, `key=token` for a token, never false. */
function token(key: string, value: StateValue): string | undefined {
  const word = stateWord(value);
  if (word === undefined || word === false) return undefined;
  return word === true ? key : keyed(key, word);
}

/** Free text: `key="JSON string"` when non-empty, after redaction. */
function quoted(
  key: string,
  text: string | undefined,
  redact: (text: string) => string,
): string | undefined {
  return text ? `${key}=${JSON.stringify(redact(text))}` : undefined;
}

/**
 * The ` {…}` states block for one node, or `""` when it has nothing to print.
 *
 * An allowlist, in a fixed order: checked, pressed, expanded, selected,
 * current, disabled, readonly, required, invalid, haspopup, roledescription,
 * description. Only values that carry information print: `checked=false`
 * because a screen reader says "not checked", but never `disabled=false`,
 * which is what absent means. Free text (a description, a role description)
 * is JSON-quoted and runs through `redact`, as names and values do.
 *
 * `haspopup` is read from `properties.hasPopup`, the native producer's key, or
 * `properties.haspopup`, so whichever key the DOM producer settles on prints
 * the same. Everything else (`focusable`, `editable`, `modal`, `busy`,
 * `level`, `valuemin`, …) never prints; `(level N)` keeps its own place.
 *
 * @internal Shared by the serializer's tree and tab views; not public.
 */
export function statesBlock(
  a11y: Pick<A11yInfo, "states" | "properties" | "description">,
  redact: (text: string) => string,
): string {
  const s = a11y.states;
  const p = a11y.properties;
  const tokens = [
    tristate("checked", s["checked"]),
    tristate("pressed", s["pressed"]),
    twoState("expanded", s["expanded"]),
    whenTrue("selected", s["selected"]),
    token("current", s["current"]),
    whenTrue("disabled", s["disabled"]),
    whenTrue("readonly", s["readonly"]),
    whenTrue("required", s["required"]),
    whenTruthy("invalid", s["invalid"]),
    token("haspopup", p["hasPopup"] ?? p["haspopup"]),
    quoted("roledescription", p["roledescription"], redact),
    quoted("description", a11y.description, redact),
  ].filter((t) => t !== undefined);
  return tokens.length ? ` {${tokens.join(", ")}}` : "";
}

// ─── what a token can be ─────────────────────────────────────────────────────

/** Each key the writer prints, and the forms it prints it in. */
const PRINTED: Record<string, string> = {
  checked: "`checked`, `checked=false` or `checked=mixed`",
  pressed: "`pressed`, `pressed=false` or `pressed=mixed`",
  expanded: "`expanded` or `expanded=false`",
  selected: "`selected`, only when selected",
  current: "`current` or `current=<token>`, never false",
  disabled: "`disabled`, only when disabled",
  readonly: "`readonly`, only when read-only",
  required: "`required`, only when required",
  invalid: "`invalid`, only when invalid",
  haspopup: "`haspopup=<token>`, never false",
  roledescription: '`roledescription="…"`',
  description: '`description="…"`',
};

/** Whether `value` (`undefined` for a bare key) is a form `key` prints in. */
function printable(key: string, value: string | undefined): boolean {
  switch (key) {
    case "checked":
    case "pressed":
      return value !== "true";
    case "expanded":
      return value === undefined || value === "false";
    case "current":
    case "haspopup":
      return value !== "true" && value !== "false";
    case "roledescription":
    case "description":
      return value?.startsWith('"') === true;
    default:
      return value === undefined;
  }
}

/**
 * Why a token written in a contract can never match tree text, or `undefined`
 * when the writer can print it. `checked=true` (a checked node prints
 * `checked`), `disabled=false` (a node that isn't disabled prints nothing) and
 * a key the text never carries (`Checked`, `focusable`) all read as a
 * missing state forever; this names the form that prints instead.
 *
 * @internal For the contract parser; not public.
 */
export function unprintableToken(token: string): string | undefined {
  const eq = token.indexOf("=");
  const key = eq === -1 ? token : token.slice(0, eq);
  const value = eq === -1 ? undefined : token.slice(eq + 1);
  const forms = PRINTED[key];
  if (forms === undefined) {
    return `\`${key}\` is not a key tree text prints. It prints ${Object.keys(PRINTED).join(", ")}.`;
  }
  return printable(key, value)
    ? undefined
    : `\`${token}\` never prints. Tree text prints ${forms}.`;
}
