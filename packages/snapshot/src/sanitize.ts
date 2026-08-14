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
  "token|key|secret|sig|signature|auth|jwt|session|access[-_]?token|id[-_]?token|api[-_]?key|code|x-amz-[\\w-]+";

const SECRET_PARAM_RE = new RegExp(`^(?:${SECRET_KEYS})$`, "i");

/**
 * A secret-looking key followed by an assignment, ANYWHERE in a fragment —
 * after a second `#`, after a `/`, or written with a percent-encoded `=`.
 *
 * This is the backstop, and it exists because the per-pair pass below can only
 * redact what it manages to tokenize the same way the app did. Where the two
 * disagree, "no pair matched" must not be allowed to mean "print it verbatim";
 * this catches the leftovers so the fragment can be dropped wholesale instead.
 * Built from the same key list as `SECRET_PARAM_RE` so the two cannot drift.
 *
 * The trailing `[^#?&]` requires a non-empty value — `#token=` has nothing to
 * leak — and the negative lookahead keeps an already-redacted fragment from
 * re-triggering it. The placeholder is written pre-encoded so a fragment reads
 * the same as the query half, which `URLSearchParams` encodes for us.
 */
const SECRET_IN_FRAGMENT_RE = new RegExp(
  `(?:^|[#?&/])(?:${SECRET_KEYS})(?:=|%3D)(?!%5BREDACTED%5D)[^#?&]`,
  "i",
);

/**
 * One `key=value` inside a fragment. `#`, `?` and `&` all act as separators:
 * a fragment is opaque to the URL parser, so an app may use any of them, and a
 * hash-routed SPA that completes an implicit flow produces a *second* `#`
 * (`…/#/callback#access_token=…`) which is a separator in every sense but the
 * parser's.
 */
const FRAGMENT_PAIR_RE = /(^|[#?&])([^#?&=]+)=([^#?&]*)/g;

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
  if (hash === "" || hash === "#") return hash;
  const body = hash.slice(1);

  const rebuilt = body.replace(
    FRAGMENT_PAIR_RE,
    (match, separator: string, key: string, value: string) => {
      // A valueless key (`#a=1&token`) has nothing to leak; handing it a
      // fabricated `[REDACTED]` would report a secret that was never there.
      if (value === "") return match;
      // Decode for the test only — `#access%5Ftoken=…` is the same key — while
      // the original spelling is what gets written back.
      return SECRET_PARAM_RE.test(decodeSafe(key))
        ? `${separator}${key}=%5BREDACTED%5D`
        : match;
    },
  );

  // Fail closed: a secret-shaped key is still legible, so the pair scan and
  // whatever produced this fragment disagree about where it splits. Rewriting
  // it precisely is not possible; printing it is not acceptable.
  if (SECRET_IN_FRAGMENT_RE.test(rebuilt)) return "#%5BREDACTED%5D";

  return rebuilt === body ? hash : `#${rebuilt}`;
}

/**
 * Strip userinfo and redact secret-looking parameters from a URL for display —
 * in the query string **and** in the fragment.
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

const URL_IN_TEXT_RE = /\bhttps?:\/\/[^\s"'<>)\]]+/g;

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
