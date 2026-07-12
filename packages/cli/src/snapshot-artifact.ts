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

import { CliError } from "./exit.js";
import type { FingerprintedFinding } from "./fingerprint.js";

export const ARTIFACT_SCHEMA_VERSION = 1;

export interface SnapshotPage {
  /** Join key across base/PR — never the URL (host/port legitimately differ). */
  name: string;
  url: string;
  root: string;
  status: "ok" | "error";
  /** Present (sanitized) when status is "error"; the page is incomparable. */
  error?: string;
  findings: FingerprintedFinding[];
  tree: string;
  outline: string;
  tabs: string;
}

export interface SnapshotArtifact {
  schemaVersion: number;
  /** Excluded from diffs — version churn must not read as a change. */
  tool: { name: string; version: string };
  meta: {
    rules: string[] | null;
    device: string | null;
    viewport: string | null;
  };
  pages: SnapshotPage[];
}

export interface ArtifactMeta {
  toolName: string;
  toolVersion: string;
  rules?: string[];
  device?: string;
  viewport?: string;
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
    },
    pages,
  };
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
    throw new CliError(`${label} is not valid JSON`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new CliError(`${label} is not a Real A11y snapshot artifact`);
  }
  const a = parsed as Partial<SnapshotArtifact>;
  if (a.schemaVersion !== ARTIFACT_SCHEMA_VERSION) {
    throw new CliError(
      `${label} has schemaVersion ${String(a.schemaVersion)} — this build reads ${ARTIFACT_SCHEMA_VERSION}.`,
      "re-generate it with a matching real-a11y version: real-a11y snapshot",
    );
  }
  if (!Array.isArray(a.pages)) {
    throw new CliError(`${label} has no "pages" array`);
  }
  for (const page of a.pages) {
    if (
      typeof page !== "object" ||
      page === null ||
      typeof (page as SnapshotPage).name !== "string"
    ) {
      throw new CliError(`${label} has a page without a "name"`);
    }
    const p = page as SnapshotPage;
    if (!Array.isArray(p.findings)) p.findings = [];
    if (typeof p.tree !== "string") p.tree = "";
    if (typeof p.outline !== "string") p.outline = "";
    if (typeof p.tabs !== "string") p.tabs = "";
    if (p.status !== "ok" && p.status !== "error") p.status = "ok";
  }
  return a as SnapshotArtifact;
}
