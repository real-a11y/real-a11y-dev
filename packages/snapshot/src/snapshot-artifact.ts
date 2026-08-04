/**
 * The snapshot artifact (`a11y-snapshot.json`) — what `snapshot` writes and
 * `diff` consumes. A single JSON file with, per page, the fingerprinted
 * findings PLUS the serialized views. Findings are the input to the
 * findings-aware diff; the views drive the advisory structural diff. `diff`
 * reads this, never markdown.
 *
 * `schemaVersion` is the contract: readers ignore unknown fields (additive
 * changes need no bump); a version mismatch is a hard error ("re-snapshot").
 */

import { SnapshotFormatError } from "./errors.js";
import {
  fingerprintFindings,
  type FingerprintedFinding,
} from "./fingerprint.js";
import { pageIdOf, scopeId } from "./page-id.js";

/**
 * Bumped to 2 when the fingerprint's page component became the page **id**
 * rather than the display label.
 *
 * The field layout is back-compatible — `id` back-fills from `url` on read —
 * but the `v1:` hashes inside a pre-bump artifact were computed over a
 * different tuple than a fresh one's. Left at 1, the two would be compared as
 * though they were the same scheme: exact matching misses every pair, the fuzzy
 * tier has to rescue all of them, and anything it can't rescue (a doc-scoped
 * finding, or one whose locator moved in the same change) surfaces as FIXED +
 * NEW — a spurious gating regression on the first diff after upgrading.
 *
 * Baselines were protected with a version bump for exactly this change, and
 * they are *refused* because a baseline stores no url — its identity cannot be
 * derived from what it holds, and guessing would silently suppress a real
 * finding. An artifact holds both the url and each finding's components, so it
 * is **converted** on read instead: same protection, no data loss, no re-record.
 */
export const ARTIFACT_SCHEMA_VERSION = 2;

/** The serialized views a run can measure. */
export const SNAPSHOT_VIEWS = ["tree", "outline", "tabs"] as const;
export type SnapshotView = (typeof SNAPSHOT_VIEWS)[number];

export interface SnapshotPage {
  /**
   * Join key across base/PR, baselines and fingerprints — the page's identity.
   *
   * Derived from the URL's path (see `pageIdOf`), never from the origin and
   * never from `name`. Both of those were tried: the origin fails across
   * environments, the label fails across a rename, and until this field existed
   * `name` was doing both jobs — which is why renaming a page silently
   * un-suppressed its baseline.
   */
  id: string;
  /**
   * Display label only. Free to change without changing what page this is.
   * Defaults to the redacted URL when the config doesn't name one.
   */
  name: string;
  url: string;
  root: string;
  /** Repo-relative source file for this page (from the config) — the SARIF
   *  anchor. Absent when the config doesn't declare one. */
  sourcePath?: string;
  status: "ok" | "error";
  /** Present (sanitized) when status is "error"; the page is incomparable. */
  error?: string;
  findings: FingerprintedFinding[];
  tree: string;
  outline: string;
  /**
   * Absent when the run didn't measure tab order — see `meta.views`. NOT the
   * same as `""` (measured, nothing focusable): an absent view means "not
   * measured", and the diff skips that axis instead of reporting every stop as
   * removed. `parseSnapshotArtifact` keeps the two apart.
   */
  tabs?: string;
}

export interface SnapshotArtifact {
  schemaVersion: number;
  /** Excluded from diffs — version churn must not read as a change. */
  tool: { name: string; version: string };
  meta: {
    rules: string[] | null;
    device: string | null;
    viewport: string | null;
    /**
     * Set when the artifact was captured with `--only` — it carries ONE axis
     * and is a machine EXPORT, not a diffable snapshot. `diff` rejects partial
     * artifacts (an empty-because-filtered axis is indistinguishable from
     * empty-because-clean and would read as everything-new / all-removed).
     * Additive: absent/null = full artifact.
     */
    only: "findings" | "views" | null;
    /**
     * Which views this run actually measured. The producer decides: the native
     * a11y tree carries no tab order, so a native run measures tree + outline
     * and omits `tabs` from every page.
     *
     * This exists because omission alone doesn't survive a round trip — a
     * reader can't tell a missing field from an empty one, and would read
     * "not measured" as "everything focusable disappeared", firing the tool's
     * most safety-critical signal at volume on an upgrade where no page
     * changed. The list is the presence signal; `tabs` is the payload.
     *
     * Additive: absent/null = a legacy artifact, captured when every run
     * measured all three. Read it through {@link measuredViews}.
     */
    views?: SnapshotView[] | null;
  };
  pages: SnapshotPage[];
}

export interface ArtifactMeta {
  toolName: string;
  toolVersion: string;
  rules?: string[];
  device?: string;
  viewport?: string;
  only?: "findings" | "views";
  /** Views this run measured. Defaults to all of {@link SNAPSHOT_VIEWS}. */
  views?: readonly SnapshotView[];
}

/**
 * Refuse an artifact whose pages share an identity.
 *
 * Two pages with one id would be joined as a single page by every consumer —
 * the diff would compare one against the other and report the difference as a
 * regression, and a baseline entry would suppress on whichever matched first.
 * Blending two pages' findings is the worst outcome this model can produce, and
 * it is silent, so it is a hard error rather than a warning.
 *
 * Reachable in practice by auditing two sites that share a route (`/` is the
 * usual one). The remedy is an explicit `id` on the config entry, which the
 * message names.
 *
 * `readLabel` marks the read path. An artifact already on disk cannot be fixed
 * by editing today's config — the collision is baked into a file that was
 * written before ids existed — so it is pointed at a re-capture instead. Same
 * defect, two honest remedies.
 */
export function assertDistinctPageIds(
  pages: readonly SnapshotPage[],
  readLabel?: string,
): void {
  const seen = new Map<string, string>();
  for (const page of pages) {
    // `id` is required by the type, but this package is published and callable
    // from JS, and a page built by hand is the one way to reach here without
    // one. Caught by name: two id-less pages would otherwise both key on
    // `undefined` and be reported as a collision, which names the wrong defect
    // and sends the reader looking for a route clash that isn't there.
    if (typeof page.id !== "string" || page.id.length === 0) {
      throw new SnapshotFormatError(
        `page ${page.url} has no id — a page's identity is what the diff, ` +
          `baselines and fingerprints all join on, so it cannot be omitted.`,
        "build pages with buildSnapshotPage(), or read them back through parseSnapshotArtifact(), which derives an id from the url",
      );
    }
    const first = seen.get(page.id);
    if (first !== undefined) {
      throw new SnapshotFormatError(
        (readLabel === undefined ? "" : `${readLabel}: `) +
          `two pages share the id "${page.id}" — ${first} and ${page.url}. ` +
          `Page identity is the URL's path, so two sites sharing a route collide.`,
        // The remedy has to be reachable from whichever page source the caller
        // actually used. A config `urls` entry and an `A11Y_PAGES` entry both
        // take an `id`; positional URLs carry no such field, so naming only the
        // config would hand a CLI user advice they cannot act on without
        // rewriting their whole invocation.
        readLabel === undefined
          ? 'give one an explicit "id" — a config `urls` entry or an `A11Y_PAGES` entry both accept { "id": "marketing-home", "url": "…" }. Positional URLs carry no id, so use one of those for a run whose routes collide'
          : 'this artifact predates page identity and cannot be repaired in place — re-capture it with an explicit "id" on one of the colliding pages',
      );
    }
    seen.set(page.id, page.url);
  }
}

export function buildArtifact(
  pages: SnapshotPage[],
  meta: ArtifactMeta,
): SnapshotArtifact {
  assertDistinctPageIds(pages);
  return {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    tool: { name: meta.toolName, version: meta.toolVersion },
    meta: {
      rules: meta.rules ?? null,
      device: meta.device ?? null,
      viewport: meta.viewport ?? null,
      only: meta.only ?? null,
      views: [...(meta.views ?? SNAPSHOT_VIEWS)],
    },
    pages,
  };
}

/**
 * The views an artifact measured — the authority on whether a view's absence
 * means "nothing there" or "never looked".
 *
 * A legacy artifact (no `meta.views`) predates the native migration, when every
 * run measured all three; that is what its silence means, so that is what it
 * reads as.
 */
export function measuredViews(
  artifact: Pick<SnapshotArtifact, "meta">,
): ReadonlySet<SnapshotView> {
  const declared = artifact.meta?.views;
  return new Set(Array.isArray(declared) ? declared : SNAPSHOT_VIEWS);
}

/**
 * The views a single PAGE carries — for re-wrapping a loose page into an
 * artifact, where there is no `meta` to read and assuming would be a lie.
 *
 * Both callers hold pages of mixed provenance: a checkpoint captured natively
 * has no tabs view, while one loaded from a DOM-era artifact does. Declaring a
 * fixed set either drops that page's tab data or tells the next reader every
 * stop vanished. The page itself is the only honest source.
 */
export function viewsOfPage(page: SnapshotPage): SnapshotView[] {
  return page.tabs !== undefined ? [...SNAPSHOT_VIEWS] : ["tree", "outline"];
}

/**
 * Reject a partial (`--only`) artifact where a FULL one is required — the diff
 * path. Reads defensively: hand-made artifacts may lack `meta` entirely.
 */
export function assertFullArtifact(
  artifact: SnapshotArtifact,
  label = "snapshot",
): void {
  const only = artifact.meta?.only;
  if (only === "findings" || only === "views") {
    throw new SnapshotFormatError(
      `${label} is a partial snapshot (captured with --only ${only}) — diff needs full artifacts; an empty-because-filtered axis would read as everything-new or all-removed`,
      "re-generate it without --only: real-a11y snapshot --output <file>",
    );
  }
}

export function serializeArtifact(artifact: SnapshotArtifact): string {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

/**
 * Parse and validate an artifact from JSON. Rejects a schema-version mismatch
 * with exit 2 (a stale base can't be diffed against a newer PR), and sniffs the
 * shape enough that a garbage file fails fast rather than mid-diff. Unknown
 * fields are ignored (forward-compatible).
 */
export function parseSnapshotArtifact(
  json: string,
  label = "snapshot",
): SnapshotArtifact {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new SnapshotFormatError(`${label} is not valid JSON`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new SnapshotFormatError(
      `${label} is not a Real A11y snapshot artifact`,
    );
  }
  const a = parsed as Partial<SnapshotArtifact>;
  // A version-1 artifact is CONVERTED, not refused.
  //
  // Its hashes were keyed on the display label, so reading it as-is would
  // compare two different fingerprint schemes and report unchanged findings as
  // fixed + new. But everything needed to redo them is in the file: the page's
  // `url` yields the identity, and each finding carries its own components
  // (rule, role, locator, …), so re-keying reproduces exactly what a fresh
  // capture of the same page would hash. The conversion happens below, once the
  // ids are back-filled — nothing here is a guess.
  //
  // This is where artifacts and baselines diverge, and the asymmetry is the
  // whole reason baselines are refused instead: a baseline stores no url, so
  // its identity cannot be derived from what it holds. An artifact's can.
  const legacy = a.schemaVersion === 1;
  if (!legacy && a.schemaVersion !== ARTIFACT_SCHEMA_VERSION) {
    throw new SnapshotFormatError(
      `${label} has schemaVersion ${String(a.schemaVersion)} — this build reads ${ARTIFACT_SCHEMA_VERSION}.`,
      "re-generate it with a matching real-a11y version: real-a11y snapshot",
    );
  }
  if (!Array.isArray(a.pages)) {
    throw new SnapshotFormatError(`${label} has no "pages" array`);
  }
  // Normalize the presence signal before the pages, so the two can never
  // disagree: an unmeasured view is dropped from every page even if a
  // hand-made artifact carried one, and a measured-but-missing one still
  // defaults to "" (measured, nothing there) exactly as it always did.
  const declared = a.meta?.views;
  const measured: ReadonlySet<SnapshotView> = new Set(
    Array.isArray(declared)
      ? declared.filter((v): v is SnapshotView =>
          (SNAPSHOT_VIEWS as readonly string[]).includes(v),
        )
      : SNAPSHOT_VIEWS,
  );
  // Which pages had no id of their own. Only these may fall back to `name` on a
  // collision — a page that carries an explicit id means it, and two of those
  // clashing is a malformed artifact rather than a legacy one.
  const backFilled = new Set<SnapshotPage>();
  for (const page of a.pages) {
    if (
      typeof page !== "object" ||
      page === null ||
      typeof (page as SnapshotPage).name !== "string"
    ) {
      throw new SnapshotFormatError(`${label} has a page without a "name"`);
    }
    const p = page as SnapshotPage;
    // Back-fill identity for any page that arrived without one: a v1 artifact
    // (written before pages had an id) or a hand-made v2 one. The `url` is on
    // every page, so the id is derivable and the file stays readable rather
    // than needing a re-record. When the url won't parse there is nothing
    // honest to derive, so fall back to the name — which is exactly what that
    // artifact was joined on when it was written.
    if (typeof p.id !== "string" || p.id.length === 0) {
      const derived =
        (typeof p.url === "string" ? pageIdOf(p.url) : undefined) ?? p.name;
      // Scope by the recorded root, exactly as `buildSnapshotPage` does, so an
      // old artifact holding one URL at two roots back-fills to two ids instead
      // of collapsing into one.
      p.id = scopeId(derived, typeof p.root === "string" ? p.root : undefined);
      backFilled.add(p);
    }
    if (!Array.isArray(p.findings)) p.findings = [];
    if (typeof p.tree !== "string") p.tree = "";
    if (typeof p.outline !== "string") p.outline = "";
    if (!measured.has("tabs")) delete p.tabs;
    else if (typeof p.tabs !== "string") p.tabs = "";
    if (p.status !== "ok" && p.status !== "error") p.status = "ok";
  }
  // A back-filled id can collide where the artifact itself was coherent: two
  // sites sharing a route (`/` is the usual one) were distinct pages when this
  // file was written, because back then pages joined on `name`. Throwing here
  // would make a file that diffed correctly for months permanently unreadable,
  // and the remedy an in-place error can offer — "re-capture it" — is not open
  // to an archived CI artifact.
  //
  // So the read path falls back to what that artifact was ACTUALLY joined on,
  // which is the same reasoning the unparseable-url case already follows above.
  // Only the colliding pages move, so a legacy `/` that collides with nothing
  // keeps the derived id and still joins a freshly-captured page of that route.
  // Two legacy artifacts both land on `name` and join exactly as they did
  // before ids existed.
  const collided = new Map<string, SnapshotPage[]>();
  for (const p of a.pages as SnapshotPage[]) {
    const pool = collided.get(p.id);
    if (pool) pool.push(p);
    else collided.set(p.id, [p]);
  }
  for (const pool of collided.values()) {
    if (pool.length < 2 || !pool.every((p) => backFilled.has(p))) continue;
    for (const p of pool) p.id = p.name;
  }
  // The same guard `buildArtifact` applies, on the way in rather than the way
  // out. Without it an artifact written in-process could never hold colliding
  // ids while one read from disk could, and `diffArtifacts` joins pages through
  // a Map — so a collision drops the first page's findings from the comparison
  // silently, which is the single outcome this model must never produce.
  //
  // Still reached by a collision the fallback can't resolve: an artifact whose
  // pages carry explicit ids that clash (genuinely malformed, not legacy), or a
  // legacy one whose names clash too — which had the same silent-merge defect
  // when it was written and cannot be repaired by reading it differently.
  assertDistinctPageIds(a.pages as SnapshotPage[], label);
  if (legacy) {
    // Re-key every finding under the identity settled above. A v1 hash was
    // computed with the display label in the tuple's page slot; every other
    // component (rule, role, locator, …) is carried on the finding itself and
    // is unchanged, so hashing again with the id in that slot yields exactly
    // what a fresh capture of this page produces. `occ` recomputes from array
    // order, which the file preserves, so repeated identical findings keep
    // their numbering.
    //
    // Without this the artifact would parse and then mis-compare in silence,
    // which is the one failure mode worth refusing over — so the version is
    // stamped forward only once the conversion has actually happened.
    for (const p of a.pages as SnapshotPage[]) {
      p.findings = fingerprintFindings(p.id, p.findings);
    }
    a.schemaVersion = ARTIFACT_SCHEMA_VERSION;
  }
  return a as SnapshotArtifact;
}
