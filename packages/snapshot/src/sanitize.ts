/**
 * The single sanitization boundary between the audited page and every output
 * sink. Audited pages are adversarial input: accessible names, locators, and
 * even exception messages originate in the page realm and flow into terminals
 * (escape-sequence injection), JSON, markdown, and CI annotations. Everything
 * crossing the browser→Node edge passes through here once; downstream
 * renderers assume clean input.
 */

import type { Finding } from "@real-a11y-dev/audit";
import { ALL_RULES } from "@real-a11y-dev/audit";

/**
 * C0 controls (minus \t \n), DEL, C1 controls, and bidi override/isolate
 * characters. \r is normalized away separately so CRLF input can't dodge the
 * single-line collapse. Escaped to visible `\u{…}` rather than stripped — a
 * control character in an accessible name is itself a bug worth seeing.
 */
const CONTROL_RE =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B-\u001F\u007F\u0080-\u009F\u202A-\u202E\u2066-\u2069]/g;

/** Max length for any single page-derived field (name, message, locator…). */
const FIELD_CAP = 1_000;

/**
 * SGR color sequences are stripped rather than escaped: Playwright colorizes
 * its own error messages, and rendering those as literal `\u{1B}[2m` noise in
 * every failure sink would bury the message. Everything non-SGR (OSC, other
 * CSI, C0/C1) still gets visibly escaped below — that's the injection surface.
 */
const SGR_RE =
  // eslint-disable-next-line no-control-regex
  /\u001B\[[0-9;]*m/g;

export interface SanitizeOptions {
  /**
   * Collapse all whitespace runs (incl. newlines) to a single space — for
   * fields rendered on one line, so a multiline `aria-label` can't forge
   * extra report lines.
   */
  singleLine?: boolean;
}

/** Escape control/bidi characters; never strips letters — CJK/RTL text passes through. */
export function sanitizeText(
  value: unknown,
  options: SanitizeOptions = {},
): string {
  let s =
    typeof value === "string" ? value : value == null ? "" : String(value);
  s = s.replace(SGR_RE, "");
  s = options.singleLine ? s.replace(/[\r\n\t]+/g, " ") : s.replace(/\r/g, "");
  return s.replace(
    CONTROL_RE,
    (ch) => `\\u{${ch.codePointAt(0)!.toString(16).toUpperCase()}}`,
  );
}

/**
 * Query-string parameter names that commonly carry secrets. Values of matching
 * params are replaced, never printed — preview URLs with tokens end up in
 * reports, CI logs, and PR comments otherwise.
 */
const SECRET_KEYS =
  // `x-amz-` names are bounded rather than `+`: an unbounded greedy run has to
  // give back one character at a time when the assignment does not follow, which
  // is quadratic in the length of the run and is what CodeQL flags as polynomial.
  // Real AWS sigv4 parameters are far short of this (`x-amz-security-token` is
  // the longest at 20), so the bound changes nothing a caller can observe.
  "token|key|secret|sig|signature|auth|jwt|session|access[-_]?token|id[-_]?token|api[-_]?key|code|x-amz-[\\w-]{1,64}";

const SECRET_PARAM_RE = new RegExp(`^(?:${SECRET_KEYS})$`, "i");

/**
 * One `key=value` inside a fragment.
 *
 * A fragment is opaque to the URL parser, so nothing decides authoritatively
 * how it splits — the *app* does. `#`, `?`, `&`, `/`, `;` and `,` are therefore
 * all separators here: a hash-routed SPA finishing an implicit flow produces a
 * second `#`, a route segment separates with `/`, and Angular Router's matrix
 * parameters use `;` and land in the fragment under `HashLocationStrategy`.
 * The assignment may be a literal `=` or a percent-encoded `%3D`.
 *
 * Values exclude `=` as well, so a value cannot swallow a following pair —
 * `#a=b&c=d=access_token=…` used to tokenize as one `c` whose value ate the
 * token, which no amount of separator-widening would have caught. The `={0,2}`
 * tail is base64 padding: without it a padded token left a stray `=` outside
 * the rewrite, which re-armed the backstop against the scan's own output and
 * cost the whole fragment.
 *
 * Both classes are bounded. An unbounded run in front of the `(=|%3D)`
 * alternation is a polynomial-backtracking shape — the engine gives back one
 * character at a time and re-tries `%3D` at each — and while it measures linear
 * here (0.2ms over 96KB, because the alternation's branches start with
 * different characters), the bound removes the shape rather than relying on
 * that. The limits are far above any real key or token: 256 for a parameter
 * name, 8192 for a value, both an order of magnitude past a JWT.
 */
const FRAGMENT_PAIR_RE = /(^|[#?&/;,])([^#?&/;,=]+)(=|%3D)([^#?&/;,=]*={0,2})/g;

/**
 * The backstop: a secret-shaped key followed by an assignment that the pair
 * scan did not rewrite.
 *
 * The boundary is a NEGATED class rather than a list of separators. Enumerating
 * them is what made this leak repeatedly — every round closed one character and
 * the next exotic one was a fresh hole — so this asks only that the key not run
 * on from other key text.
 *
 * The lookahead must be anchored to the WHOLE remaining value: a bare
 * `(?!%5BREDACTED%5D)` is satisfied by a *prefix*, so a page could disarm this
 * by prefixing its token with the placeholder. It is still load-bearing and
 * must not simply be deleted — without it the backstop matches the pair scan's
 * own output and collapses every successfully-redacted fragment.
 *
 * Only the encoded spelling appears: the decoded pass re-encodes the
 * placeholder before testing, which keeps a `\[` escape out of a template
 * literal — where it silently degrades to a character class.
 */
const SECRET_IN_FRAGMENT_RE = new RegExp(
  `(?:^|[^A-Za-z0-9_-])(?:${SECRET_KEYS})(?:=|%3D)` +
    `(?!%5BREDACTED%5D(?:[#?&/;,]|$))[^#?&]`,
  "i",
);

/** decodeURIComponent that yields the raw text rather than throwing on `%zz`. */
function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Redact secret-looking pairs out of a URL fragment, leaving ordinary
 * fragments untouched.
 *
 * The fragment is where OAuth's implicit flow puts its tokens — a redirect
 * lands on `…/callback#access_token=ya29.…&token_type=bearer`, and the
 * fragment never reaches the server, so it is *only* ever visible client-side,
 * which is exactly where this toolchain reads it. It is easy to assume the
 * query-string pass covers this; it does not, because `searchParams` stops at
 * the `#`.
 *
 * Most fragments are not secrets, though — `#installation`, `#/dashboard/users`
 * — and blanking those would make every printed URL less useful for the sake of
 * a case that announces itself. So pairs are rewritten **in place**: only a
 * matched value changes, and every other byte, separators and encoding
 * included, survives exactly as it arrived.
 *
 * A fragment is opaque to the URL parser, so there is no authority on how it
 * splits. `#`, `?` and `&` are therefore all treated as separators — a
 * hash-routed SPA completing an implicit flow lands on `…/#/callback#access_token=…`,
 * where the second `#` separates in every sense except the parser's.
 *
 * Anything the pair scan cannot tokenize falls to {@link SECRET_IN_FRAGMENT_RE},
 * which drops the whole fragment. That direction is deliberate: an earlier
 * revision returned the fragment verbatim whenever no pair matched, which meant
 * any tokenization the app and this code disagreed about printed the token in
 * full — the exact bug this function exists to prevent.
 */
function redactFragment(hash: string): string {
  if (hash === "") return hash;
  const body = hash.slice(1);

  const rebuilt = body.replace(
    FRAGMENT_PAIR_RE,
    (match, separator: string, key: string, assign: string, value: string) => {
      // A valueless key (`#a=1&token`) has nothing to leak; handing it a
      // fabricated `[REDACTED]` would report a secret that was never there.
      if (value === "") return match;
      // `decodeURIComponent` is the identity without a `%`, so only pay for it
      // when one is present — `#access%5Ftoken=…` is the same key.
      const secret =
        SECRET_PARAM_RE.test(key) ||
        (key.includes("%") && SECRET_PARAM_RE.test(decodeSafe(key)));
      return secret ? `${separator}${key}${assign}%5BREDACTED%5D` : match;
    },
  );

  // Fail closed on anything the scan could not tokenize — but keep the route.
  // Replacing the whole fragment erases it, and page identity is derived from
  // the redacted URL: for a hash-routed SPA every route lives at pathname `/`,
  // so two distinct pages collapse onto one id and the artifact writer throws
  // naming the same URL twice. Cutting back to the last separator keeps the
  // fail-closed property without the identity loss.
  // Tested decoded as well as raw, because the two encodings defeat opposite
  // passes: `#access%5Ftoken%3D…` tokenizes as no pair (no literal `=`) and
  // reads as no secret key (no literal `_`). Re-encoding the placeholder first
  // keeps one spelling in the lookahead.
  const raw = SECRET_IN_FRAGMENT_RE.exec(rebuilt);
  if (raw) {
    // Cut back to the last separator before the match, keeping the route in
    // front of it — page identity is derived from this, and replacing the whole
    // fragment collapses distinct hash routes onto one id.
    let cut = -1;
    for (const ch of "#?&/;,")
      cut = Math.max(cut, rebuilt.lastIndexOf(ch, raw.index));
    return `#${rebuilt.slice(0, cut + 1)}%5BREDACTED%5D`;
  }
  // The decoded pass catches keys the raw text hides (`#%74oken%3D…`), but its
  // indices do not map onto `rebuilt` — re-encoding the placeholder even grows
  // the string — so there is no route to keep here that could be trusted.
  // Drop the whole fragment rather than cut at an offset that means something
  // else, which is how a secret ended up on the printed side of the cut.
  const decoded = decodeSafe(rebuilt)
    .split("[REDACTED]")
    .join("%5BREDACTED%5D");
  if (SECRET_IN_FRAGMENT_RE.test(decoded)) return "#%5BREDACTED%5D";

  return rebuilt === body ? hash : `#${rebuilt}`;
}

/**
 * Strip userinfo and redact secret-looking parameters from a URL for display.
 *
 * The two halves are not equally thorough, and the difference is worth knowing
 * before trusting one to behave like the other. The **fragment** is scanned by
 * this module's own tokenizer, which treats `#?&/;,` as separators, accepts
 * `%3D` as an assignment, and falls closed on anything it cannot read as pairs.
 * The **query** is handled by `URLSearchParams`, so it sees only `&` and a
 * literal `=`, and has no backstop: `?access_token%3D…` and `?a=1;access_token=…`
 * still print in full. Extending the fragment's treatment to the query is
 * deliberate follow-up work, not an oversight — it is a wider behaviour change
 * than this fix, and the query half is unchanged from before it.
 */
export function redactUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return sanitizeText(raw, { singleLine: true });
  }
  url.username = "";
  url.password = "";
  const keys = [...new Set([...url.searchParams.keys()])];
  for (const key of keys) {
    if (SECRET_PARAM_RE.test(key)) url.searchParams.set(key, "[REDACTED]");
  }
  // Assign only on a real change: the getter reports an empty fragment as "",
  // and the setter reads "" as "remove it", so an unconditional round-trip
  // would silently drop a bare trailing `#`.
  const hash = redactFragment(url.hash);
  if (hash !== url.hash) url.hash = hash;
  return sanitizeText(url.toString(), { singleLine: true });
}

// Schemes beyond http(s), because the MCP error path relays Playwright's text
// verbatim and `open_page` accepts any URL zod's `.url()` allows. `ws://` is the
// one that matters most: a CDP endpoint's browser GUID is a full-capability
// token, and MCP attaches over one via REAL_A11Y_MCP_CDP. `]` stays IN the
// character class so an IPv6 authority (`https://[::1]:3000/…`) is not cut at
// the bracket — which truncated the URL before its fragment and left the tail
// unscanned.
const URL_IN_TEXT_RE = /\b(?:https?|wss?|file|ftp|sftp):\/\/[^\s"'<>)]+/g;

/**
 * Redact every http(s) URL embedded in free text — Playwright error messages
 * quote the full target URL (userinfo, query secrets and all), and those
 * messages flow into reports, annotations, and CI logs.
 */
export function redactUrlsIn(text: string): string {
  return text.replace(URL_IN_TEXT_RE, (match) => redactUrl(match));
}

const RULE_SET: ReadonlySet<string> = new Set(ALL_RULES);
const OPTIONAL_FIELDS = [
  "role",
  "name",
  "tagName",
  "locator",
  "context",
] as const;

/** Max findings accepted from a single page (hostile bundles can fabricate millions). */
export const FINDINGS_CAP = 5_000;

/**
 * Rebuild one finding field-by-field into a fresh object. The injected bundle
 * runs in the page realm and can be monkey-patched, so returned shapes are
 * untrusted: unknown keys are dropped, every field is type-checked, sanitized,
 * and capped. Returns null when the required fields are missing/mistyped.
 */
export function projectFinding(raw: unknown): Finding | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.rule !== "string" || !RULE_SET.has(r.rule)) return null;
  if (r.severity !== "error" && r.severity !== "warning") return null;
  if (typeof r.message !== "string") return null;

  const clean = (v: string): string =>
    sanitizeText(v, { singleLine: true }).slice(0, FIELD_CAP);
  const finding: Finding = {
    rule: r.rule as Finding["rule"],
    severity: r.severity,
    message: clean(r.message),
  };
  for (const key of OPTIONAL_FIELDS) {
    const v = r[key];
    if (typeof v === "string") finding[key] = clean(v);
  }
  return finding;
}

export function projectFindings(raw: unknown): Finding[] {
  if (!Array.isArray(raw)) return [];
  const out: Finding[] = [];
  for (const item of raw) {
    if (out.length >= FINDINGS_CAP) break;
    const finding = projectFinding(item);
    if (finding) out.push(finding);
  }
  return out;
}

/** A `PageSnapshot` after projection — same fields, provably clean strings. */
export interface CleanSnapshot {
  findings: Finding[];
  tree: string;
  outline: string;
  tabOrder: string;
}

export function projectSnapshot(raw: unknown): CleanSnapshot {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  const text = (v: unknown): string =>
    typeof v === "string" ? sanitizeText(v) : "";
  return {
    findings: projectFindings(r.findings),
    tree: text(r.tree),
    outline: text(r.outline),
    tabOrder: text(r.tabOrder),
  };
}
