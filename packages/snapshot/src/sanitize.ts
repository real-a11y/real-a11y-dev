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
const SECRET_PARAM_RE =
  /^(?:token|key|secret|sig|signature|auth|jwt|session|access[-_]?token|id[-_]?token|api[-_]?key|code|x-amz-[\w-]+)$/i;

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
 * a case that announces itself. So this only rewrites a fragment that actually
 * parses as key/value pairs, and only the keys {@link SECRET_PARAM_RE} names.
 * A hash router carrying its own query (`#/cb?code=…`) is handled by splitting
 * on the first `?`.
 *
 * Untouched fragments are returned verbatim rather than re-serialized, so a
 * plain anchor cannot pick up percent-encoding on the way through.
 */
function redactFragment(hash: string): string {
  if (hash === "" || hash === "#") return hash;
  const body = hash.slice(1);

  // A hash router puts its route before the `?` (`#/cb?code=…`), and that
  // prefix is not parameters — but `?` is legal and unencoded *inside* a
  // fragment value too, so a bare `indexOf("?")` split is not safe: an OAuth
  // `state=/dash?tab=1` would put the `?` AFTER the token and leave the token
  // in the un-scanned prefix. Only treat the prefix as a route when it holds no
  // `=` or `&` — i.e. when it cannot itself be carrying a parameter.
  const queryAt = body.indexOf("?");
  const isRoute = queryAt !== -1 && !/[=&]/.test(body.slice(0, queryAt));
  const path = isRoute ? body.slice(0, queryAt) : "";
  const pairs = isRoute ? body.slice(queryAt + 1) : body;

  // No `=` or `&` means an anchor or a route, not parameters. Leave it alone.
  if (!/[=&]/.test(pairs)) return hash;

  // Rebuilt by appending rather than `set()`, which collapses repeated keys
  // into one — and a valueless key (`#a=1&token`) is left alone rather than
  // handed a fabricated `[REDACTED]` it never had.
  const rebuilt = new URLSearchParams();
  let redacted = false;
  for (const [key, value] of new URLSearchParams(pairs)) {
    if (value !== "" && SECRET_PARAM_RE.test(key)) {
      rebuilt.append(key, "[REDACTED]");
      redacted = true;
    } else {
      rebuilt.append(key, value);
    }
  }
  if (!redacted) return hash;
  return `#${path}${isRoute ? "?" : ""}${rebuilt.toString()}`;
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
