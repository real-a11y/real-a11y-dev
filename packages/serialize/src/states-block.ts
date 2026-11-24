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

import { a11yPropertyInfo, type A11yInfo } from "@real-a11y-dev/core";

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

/** A whole block at the start of some text: `{token, token}`. */
const LEADING_BLOCK_RE = new RegExp(String.raw`^\{(${TOKEN}(?:, ${TOKEN})*)\}`);

/**
 * Read a `{…}` states block at the very start of `text`, as a pasted tree line
 * puts it after a node's name, and return what follows it. `text` comes back
 * whole, with no block, when it doesn't start with a well-formed one.
 *
 * @internal For readers of a pasted line, such as the CLI's `--step`.
 */
export function leadingStatesBlock(text: string): {
  block?: string;
  rest: string;
} {
  const match = LEADING_BLOCK_RE.exec(text);
  return match
    ? { block: match[1], rest: text.slice(match[0].length) }
    : { rest: text };
}

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

// ─── the writer, and what a token can be ─────────────────────────────────────
//
// One table drives both directions: `statesBlock` writes each key through its
// kind, and `unprintableToken` accepts a contract token only in a form that
// kind can write. A key's kind is the single statement of its print rule.

type StateValue = string | boolean | undefined;

/** A state value as true, false, `"mixed"`, a token, or absent. Both
 *  producers hand booleans, but a string `"true"`/`"false"` reads the same. */
function stateWord(value: StateValue): string | boolean | undefined {
  if (value === "true") return true;
  if (value === "false" || value === "") return false;
  return value;
}

/** A word prints bare after `=`; anything else is JSON-quoted. */
const WORD = /^[a-z0-9-]+$/;

/** A token's value part, `key=value` or `key="value"`, decoded: the string a
 *  JSON-quoted value holds, or `undefined` for a malformed quote. */
function decoded(raw: string): string | undefined {
  if (!raw.startsWith('"')) return raw;
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Whether `raw` is exactly how {@link keyedValue} writes some token. */
function isKeyedValue(raw: string): boolean {
  if (WORD.test(raw)) return true;
  const value = raw.startsWith('"') ? decoded(raw) : undefined;
  return value !== undefined && value !== "" && !WORD.test(value);
}

/** A token's value as written: bare when it is a word, JSON-quoted else. */
const keyedValue = (value: string) =>
  WORD.test(value) ? value : JSON.stringify(value);

/** How a key prints. `write` turns a value into the token's value part
 *  (`""` for a bare key, `undefined` for nothing); `accepts` says whether a
 *  written value part (`undefined` for a bare key) is one `write` can give. */
interface Kind {
  write(
    value: StateValue,
    redact: (text: string) => string,
  ): string | undefined;
  accepts(raw: string | undefined): boolean;
  forms(key: string): string;
}

/** checked, pressed: set, `false` or `mixed`. Any other token prints
 *  nothing: it is not a state these take. */
const TRISTATE: Kind = {
  write(value) {
    const word = stateWord(value);
    if (word === true) return "";
    if (word === false) return "false";
    return word === "mixed" ? "mixed" : undefined;
  },
  accepts: (raw) => raw === undefined || raw === "false" || raw === "mixed",
  forms: (key) => `\`${key}\`, \`${key}=false\` or \`${key}=mixed\``,
};

/** expanded: set or `false` ("collapsed"). */
const TWO_STATE: Kind = {
  write(value) {
    const word = stateWord(value);
    if (word === true) return "";
    return word === false ? "false" : undefined;
  },
  accepts: (raw) => raw === undefined || raw === "false",
  forms: (key) => `\`${key}\` or \`${key}=false\``,
};

/** selected, disabled, readonly, required: bare, only when true. False is
 *  what absent means, so it never prints. */
const FLAG: Kind = {
  write: (value) => (stateWord(value) === true ? "" : undefined),
  accepts: (raw) => raw === undefined,
  forms: (key) => `\`${key}\`, only when set`,
};

/** invalid: bare for any truthy value, so `grammar` and `spelling` read as
 *  `invalid`, and native's default `invalid=false` prints nothing. */
const TRUTHY: Kind = {
  write(value) {
    const word = stateWord(value);
    return word === undefined || word === false ? undefined : "";
  },
  accepts: (raw) => raw === undefined,
  forms: (key) => `\`${key}\`, only when set`,
};

/** current: bare for true, `current=<token>` for a token, never false. */
const TOKEN_KIND: Kind = {
  write(value) {
    const word = stateWord(value);
    if (word === undefined || word === false) return undefined;
    return word === true ? "" : keyedValue(word);
  },
  accepts: (raw) =>
    raw === undefined ||
    (raw !== "true" && raw !== "false" && isKeyedValue(raw)),
  forms: (key) => `\`${key}\` or \`${key}=<token>\`, never false`,
};

/** haspopup: always a token. ARIA makes `true` mean `menu`, so it prints as
 *  one; false prints nothing. */
const POPUP: Kind = {
  write(value) {
    const word = stateWord(value);
    if (word === undefined || word === false) return undefined;
    return word === true ? "menu" : keyedValue(word);
  },
  accepts: (raw) =>
    raw !== undefined && raw !== "true" && raw !== "false" && isKeyedValue(raw),
  forms: (key) =>
    `\`${key}=<token>\`, never false (\`aria-haspopup="true"\` prints as \`${key}=menu\`)`,
};

/** roledescription, description: `key="…"`, JSON-quoted and redacted, when
 *  non-empty. */
const TEXT: Kind = {
  write: (value, redact) =>
    typeof value === "string" && value !== ""
      ? JSON.stringify(redact(value))
      : undefined,
  accepts(raw) {
    if (raw === undefined || !raw.startsWith('"')) return false;
    const value = decoded(raw);
    return value !== undefined && value !== "";
  },
  forms: (key) => `\`${key}="…"\`, when not empty`,
};

type Facets = Pick<A11yInfo, "states" | "properties" | "description">;

/** Which producer reads a key. A token the reader's producer never reads can
 *  never match its tree. */
export type KeyProducers = "both" | "dom" | "native";

/** The producers that write a property key, from core's one key table. */
function propertyProducers(key: string): KeyProducers {
  return a11yPropertyInfo(key)?.producers ?? "native";
}

interface KeyRule {
  kind: Kind;
  read(a: Facets): StateValue;
  producers: KeyProducers;
}

/** Every key the writer prints, in print order. */
const KEYS = new Map<string, KeyRule>([
  [
    "checked",
    { kind: TRISTATE, read: (a) => a.states["checked"], producers: "both" },
  ],
  [
    "pressed",
    { kind: TRISTATE, read: (a) => a.states["pressed"], producers: "both" },
  ],
  [
    "expanded",
    { kind: TWO_STATE, read: (a) => a.states["expanded"], producers: "both" },
  ],
  [
    "selected",
    { kind: FLAG, read: (a) => a.states["selected"], producers: "both" },
  ],
  [
    "current",
    { kind: TOKEN_KIND, read: (a) => a.states["current"], producers: "dom" },
  ],
  [
    "disabled",
    { kind: FLAG, read: (a) => a.states["disabled"], producers: "both" },
  ],
  [
    "readonly",
    { kind: FLAG, read: (a) => a.states["readonly"], producers: "both" },
  ],
  [
    "required",
    { kind: FLAG, read: (a) => a.states["required"], producers: "both" },
  ],
  [
    "invalid",
    { kind: TRUTHY, read: (a) => a.states["invalid"], producers: "both" },
  ],
  [
    "haspopup",
    {
      kind: POPUP,
      read: (a) => a.properties["haspopup"],
      producers: propertyProducers("haspopup"),
    },
  ],
  [
    "roledescription",
    {
      kind: TEXT,
      read: (a) => a.properties["roledescription"],
      producers: propertyProducers("roledescription"),
    },
  ],
  [
    "description",
    { kind: TEXT, read: (a) => a.description, producers: "both" },
  ],
]);

/**
 * The ` {…}` states block for one node, or `""` when it has nothing to print.
 *
 * An allowlist, in a fixed order: checked, pressed, expanded, selected,
 * current, disabled, readonly, required, invalid, haspopup, roledescription,
 * description. Only values that carry information print: `checked=false`
 * because a screen reader says "not checked", but never `disabled=false`,
 * which is what absent means. Free text (a description, a role description)
 * is JSON-quoted and runs through `redact`, as names and values do. Each
 * key's rule is its kind in the table above.
 *
 * Everything else (`focusable`, `editable`, `modal`, `busy`, `level`,
 * `valuemin`, …) never prints; `(level N)` keeps its own place.
 *
 * @internal Shared by the serializer's tree and tab views; not public.
 */
export function statesBlock(
  a11y: Facets,
  redact: (text: string) => string,
): string {
  const tokens: string[] = [];
  for (const [key, rule] of KEYS) {
    const value = rule.kind.write(rule.read(a11y), redact);
    if (value !== undefined)
      tokens.push(value === "" ? key : `${key}=${value}`);
  }
  return tokens.length ? ` {${tokens.join(", ")}}` : "";
}

/** A token's key, and its value part (`undefined` for a bare key). */
function tokenParts(token: string): { key: string; raw: string | undefined } {
  const eq = token.indexOf("=");
  return eq === -1
    ? { key: token, raw: undefined }
    : { key: token.slice(0, eq), raw: token.slice(eq + 1) };
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
  const { key, raw } = tokenParts(token);
  const rule = KEYS.get(key);
  if (!rule) {
    return `\`${key}\` is not a key tree text prints. It prints ${[...KEYS.keys()].join(", ")}.`;
  }
  return rule.kind.accepts(raw)
    ? undefined
    : `\`${token}\` never prints. Tree text prints ${rule.kind.forms(key)}.`;
}

/**
 * Which producer reads a token's key, or `undefined` for a key tree text
 * never prints. A contract checked against a DOM Element can't match a
 * `native` key: the DOM producer doesn't read it.
 *
 * @internal For the contract matcher; not public.
 */
export function tokenProducers(token: string): KeyProducers | undefined {
  return KEYS.get(tokenParts(token).key)?.producers;
}

/**
 * Whether a node carries a state the block prints: anything but free text (a
 * description, a role description). A `generic` holding one, such as a
 * `<details>` summary's `expanded`, is a control worth a line, not a wrapper
 * to fold away; one with only a description is still a wrapper, as the native
 * tree treats it.
 *
 * @internal For the serializer's tree view; not public.
 */
export function carriesState(a11y: Facets): boolean {
  for (const rule of KEYS.values()) {
    if (rule.kind === TEXT) continue;
    if (rule.kind.write(rule.read(a11y), (t) => t) !== undefined) return true;
  }
  return false;
}
