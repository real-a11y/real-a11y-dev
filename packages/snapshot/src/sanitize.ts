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

/** Strip userinfo and redact secret-looking query params from a URL for display. */
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
