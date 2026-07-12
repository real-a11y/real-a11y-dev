/**
 * @real-a11y-dev/cli — programmatic surface.
 *
 * Pure only: fingerprints, the snapshot artifact, the findings-aware diff,
 * sanitization, and exit-code helpers. No browser, no playwright —
 * orchestration APIs live in `@real-a11y-dev/testing` (attach) and
 * `@real-a11y-dev/mcp` (BrowserSession).
 */

export { fingerprintFindings, hashId, componentsOf } from "./fingerprint.js";
export type {
  FingerprintedFinding,
  FingerprintId,
  FindingComponents,
} from "./fingerprint.js";

// Snapshot artifact — the diffable `a11y-snapshot.json`.
export {
  ARTIFACT_SCHEMA_VERSION,
  buildArtifact,
  serializeArtifact,
  parseSnapshotArtifact,
} from "./snapshot-artifact.js";
export type { SnapshotArtifact, SnapshotPage } from "./snapshot-artifact.js";

// Baselines — accept today's debt, gate only what's new. Pure (fs read/serialize
// helpers take/return data; the CLI owns the file writes).
export {
  applyBaseline,
  BASELINE_SCHEMA_VERSION,
  buildBaseline,
  loadBaseline,
  serializeBaseline,
} from "./baseline.js";
export type { Baseline, BaselineEntry, BaselinePage } from "./baseline.js";

// Findings-aware diff.
export { diffFindings } from "./diff/findings-diff.js";
export type {
  DiffEntry,
  DiffClass,
  DiffSummary,
} from "./diff/findings-diff.js";
export { diffArtifacts } from "./diff/page-diff.js";
export type { DiffResult, PageDiff } from "./diff/page-diff.js";
export { diffViews } from "./diff/views-diff.js";
export type { ViewDiff } from "./diff/views-diff.js";

export {
  projectFinding,
  projectFindings,
  redactUrl,
  sanitizeText,
} from "./sanitize.js";

export { CliError, EXIT, exceedsThreshold } from "./exit.js";
export type { FailOn } from "./exit.js";

export { JSON_SCHEMA_VERSION, renderJson, summarize } from "./render/json.js";
export type { PageReport, Summary } from "./render/json.js";

// Interop reporters — pure renderings of a snapshot artifact.
export { renderSarif } from "./render/sarif.js";
export type { SarifContext } from "./render/sarif.js";
export { renderJUnit } from "./render/junit.js";
export { renderJsonl } from "./render/jsonl.js";

export { ALL_RULES } from "@real-a11y-dev/testing";
export type { A11yRule, Finding } from "@real-a11y-dev/testing";
