/**
 * @real-a11y-dev/snapshot — the Real A11y snapshot engine.
 *
 * Node-only, pure-data. Deterministic finding fingerprints, the diffable
 * `a11y-snapshot.json` artifact, the findings/views/unified diff, and
 * baselines. This is the single home the CLI and MCP both capture and compare
 * through, so a snapshot taken by one and diffed by the other is identical.
 */

// Fingerprints — stable `v1:` ids over a finding's identity.
export { fingerprintFindings, hashId, componentsOf } from "./fingerprint.js";
export type {
  FingerprintedFinding,
  FingerprintId,
  FindingComponents,
} from "./fingerprint.js";

// Snapshot artifact — the diffable `a11y-snapshot.json`.
export {
  ARTIFACT_SCHEMA_VERSION,
  assertFullArtifact,
  buildArtifact,
  serializeArtifact,
  parseSnapshotArtifact,
} from "./snapshot-artifact.js";
export type { SnapshotArtifact, SnapshotPage } from "./snapshot-artifact.js";

// The shared page assembler — the single home for capture→fingerprint, so the
// CLI and the MCP server compute identical fingerprints for the same page.
export { buildSnapshotPage } from "./snapshot-page.js";
export type { BuildSnapshotPageOptions } from "./snapshot-page.js";

// Baselines — accept today's debt, gate only what's new.
export {
  applyBaseline,
  BASELINE_SCHEMA_VERSION,
  buildBaseline,
  DEFAULT_BASELINE_PATH,
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
export { diffArtifacts, noPagesMatched } from "./diff/page-diff.js";
export type { DiffResult, DiffOptions, PageDiff } from "./diff/page-diff.js";
export { diffViews } from "./diff/views-diff.js";
export type { ViewDiff } from "./diff/views-diff.js";

// Human structural summary — plain-language statements over the view diffs.
export { summarizeViews, VIEW_CHANGE_ORDER } from "./diff/views-summary.js";
export type {
  ViewChange,
  ViewChangeKind,
  RawViews,
  SummarizeViewsInput,
} from "./diff/views-summary.js";

// Unified structural diff — git-style hunks with context.
export { unifiedDiff, hunkHeader, hunkLineCount } from "./diff/unified-diff.js";
export type { DiffLine, Hunk, ViewHunks } from "./diff/unified-diff.js";

// Sanitization — redact sensitive values before an artifact leaves the process.
export {
  projectFinding,
  projectFindings,
  projectSnapshot,
  redactUrl,
  redactUrlsIn,
  sanitizeText,
} from "./sanitize.js";
export type { CleanSnapshot } from "./sanitize.js";

// Native producer projection — turn a CDP-read `ExtractionResult` into the same
// CleanSnapshot the DOM producer yields (serialize + audit in Node).
export { projectNativeTree } from "./native-snapshot.js";
export type { NativeSnapshotOptions } from "./native-snapshot.js";

// Errors — a malformed artifact/baseline the reader can't accept.
export { SnapshotFormatError } from "./errors.js";
