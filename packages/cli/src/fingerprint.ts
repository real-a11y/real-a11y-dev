/**
 * Finding identity (`v1`) — the stable fingerprint behind the findings-aware
 * diff, baselines (phase 2), and SARIF alert persistence. The component tuple
 * is stored alongside the hash: fuzzy matching and baselines need the
 * components, not the digest.
 *
 * v1 is immutable. A better algorithm ships as v2 emitted alongside v1 — never
 * mutate this one, or every committed baseline silently un-suppresses.
 */

import { createHash } from "node:crypto";

import type { Finding } from "@real-a11y-dev/testing";

/** The canonical identity tuple — JSON-serializable, human-inspectable. */
export type FingerprintId = (string | number)[];

export interface FingerprintedFinding extends Finding {
  /** `v1:` + first 16 hex chars of sha256 over the id tuple. */
  fingerprint: string;
  /** The tuple the hash was computed from. */
  id: FingerprintId;
}

/** Rules whose findings describe the document, not one node. */
const DOC_RULES: ReadonlySet<string> = new Set([
  "heading-order",
  "landmark-structure",
]);

/**
 * Classify a doc-level finding by its (fixed) message template, so counts and
 * names embedded in the text stay out of the identity — "found 2 → found 3"
 * should read as CHANGED, not FIXED+NEW. Unknown template falls back to the
 * message itself.
 */
function docKind(finding: Finding): string {
  const m = finding.message;
  if (finding.rule === "heading-order") {
    if (m.startsWith("Missing <h1>")) return "missing-h1";
    if (m.startsWith("Expected exactly one <h1>")) return "multiple-h1";
    if (m.startsWith("Heading level skipped")) return "skipped-level";
  } else {
    if (m.startsWith("Missing <main>")) return "missing-main";
    if (m.startsWith("Expected exactly one <main>")) return "multiple-main";
    if (m.startsWith("More than one top-level <header>")) {
      return "multiple-banner";
    }
    if (m.startsWith("More than one top-level <footer>")) {
      return "multiple-contentinfo";
    }
  }
  return m;
}

const BARE_ID_RE = /^#[A-Za-z][\w-]*$/;

/**
 * The locator component. A locator that IS a bare `#id` is stable — keep it
 * verbatim. Anything else (including parent-id-anchored paths like
 * `#nav > ul > li:nth-of-type(3)`) embeds sibling indices, so strip the
 * `:nth-of-type(N)` steps and keep only the structural shape — a single
 * inserted sibling must not re-identify every finding after it.
 */
function anchorOf(locator: string | undefined): string {
  if (!locator) return "";
  if (BARE_ID_RE.test(locator)) return locator;
  return locator.replace(/:nth-of-type\(\d+\)/g, "");
}

/**
 * The context component, minus volatile URL query strings — hrefs embed build
 * hashes and session params that would re-identify link findings on every
 * deploy.
 */
function contextOf(context: string | undefined): string {
  if (!context) return "";
  return context.replace(/\?[^"\s…]*/g, "");
}

function tupleBase(page: string, finding: Finding): FingerprintId {
  if (DOC_RULES.has(finding.rule)) {
    return ["v1", page, finding.rule, docKind(finding), finding.name ?? ""];
  }
  return [
    "v1",
    page,
    finding.rule,
    finding.role ?? "",
    finding.tagName ?? "",
    anchorOf(finding.locator),
    contextOf(finding.context),
  ];
}

export function hashId(id: FingerprintId): string {
  const digest = createHash("sha256").update(JSON.stringify(id)).digest("hex");
  return `v1:${digest.slice(0, 16)}`;
}

/**
 * Annotate findings with their identity. `occ` (the tuple's last component) is
 * the 0-based index among identical siblings in document order — node messages
 * are pure functions of (rule, role, tagName), so three unlabeled icon buttons
 * in one nav are otherwise indistinguishable.
 */
export function fingerprintFindings(
  page: string,
  findings: readonly Finding[],
): FingerprintedFinding[] {
  const seen = new Map<string, number>();
  return findings.map((finding) => {
    const base = tupleBase(page, finding);
    const key = JSON.stringify(base);
    const occ = seen.get(key) ?? 0;
    seen.set(key, occ + 1);
    const id: FingerprintId = [...base, occ];
    return { ...finding, id, fingerprint: hashId(id) };
  });
}
