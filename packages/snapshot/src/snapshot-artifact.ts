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
import type { FingerprintedFinding } from "./fingerprint.js";

export const ARTIFACT_SCHEMA_VERSION = 1;

/** The serialized views a run can measure. */
export const SNAPSHOT_VIEWS = ["tree", "outline", "tabs"] as const;
export type SnapshotView = (typeof SNAPSHOT_VIEWS)[number];

export interface SnapshotPage {
  /** Join key across base/PR — never the URL (host/port legitimately differ). */
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

export function buildArtifact(
  pages: SnapshotPage[],
  meta: ArtifactMeta,
): SnapshotArtifact {
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
  if (a.schemaVersion !== ARTIFACT_SCHEMA_VERSION) {
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
  for (const page of a.pages) {
    if (
      typeof page !== "object" ||
      page === null ||
      typeof (page as SnapshotPage).name !== "string"
    ) {
      throw new SnapshotFormatError(`${label} has a page without a "name"`);
    }
    const p = page as SnapshotPage;
    if (!Array.isArray(p.findings)) p.findings = [];
    if (typeof p.tree !== "string") p.tree = "";
    if (typeof p.outline !== "string") p.outline = "";
    if (!measured.has("tabs")) delete p.tabs;
    else if (typeof p.tabs !== "string") p.tabs = "";
    if (p.status !== "ok" && p.status !== "error") p.status = "ok";
  }
  return a as SnapshotArtifact;
}
