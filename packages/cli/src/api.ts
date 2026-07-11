/**
 * @real-a11y-dev/cli — programmatic surface.
 *
 * Pure only: fingerprints, sanitization, exit-code helpers, and the envelope
 * types. No browser, no playwright — orchestration APIs live in
 * `@real-a11y-dev/testing` (attach) and `@real-a11y-dev/mcp` (BrowserSession).
 * Phase 2 adds `toSarif`, `diffFindings`, and `parseSnapshotArtifact` here.
 */

export {
  fingerprintFindings,
  hashId,
} from "./fingerprint.js";
export type { FingerprintedFinding, FingerprintId } from "./fingerprint.js";

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

export { ALL_RULES } from "@real-a11y-dev/testing";
export type { A11yRule, Finding } from "@real-a11y-dev/testing";
