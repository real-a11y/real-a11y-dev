/**
 * Environment variables the daemon is allowed to set or unset per-run. All
 * other keys are ignored by `withEnvSnapshot` so a caller cannot use the
 * session socket to override unrelated process state.
 *
 * Browser-launch steering variables are included here because the daemon's
 * `handleRun` calls `sessionFlags()` inside `withEnvSnapshot`. The caller's
 * `REAL_A11Y_CHROME_PATH`, `REAL_A11Y_BROWSERS_DIR`, and proxy env vars are
 * therefore visible to `sessionFlags()` and `resolveChromeExecutable()`, but
 * `SessionRegistry` pins them in the session `identityKey` so a run against an
 * existing session with different values is rejected rather than silently
 * retargeting the browser.
 *
 * `GITHUB_*` variables are propagated for CI context (`GITHUB_ACTIONS`,
 * `GITHUB_STEP_SUMMARY`) and cleared when the caller does not provide them, so
 * a local shell does not inherit the CI context of a previous run.
 *
 * `PLAYWRIGHT_*` variables are propagated the same way: the daemon clears
 * every Playwright key the caller did not send, so forwarding only some of
 * them would make a daemon-backed browser launch differ from the equivalent
 * one-shot run (the first `run` is exactly when the browser is launched).
 * Whatever the caller's shell has is what the run sees — same trust boundary
 * as the one-shot path, where the same user's shell sets the same variables.
 */
export const ALLOWED_ENV_OVERRIDES = new Set([
  "A11Y_PAGES",
  "A11Y_SNAPSHOT_OUT",
  // Terminal/output control only — these cannot steer the browser.
  "CI",
  "FORCE_COLOR",
  "NO_COLOR",
  // Playwright's browser cache path; only meaningful when a new browser is
  // launched, and the launched browser is reused for the session lifetime.
  // Kept in the set (despite the PLAYWRIGHT_ prefix rule below) so the client
  // sends an explicit `null` to clear it when the caller's shell unsets it.
  "PLAYWRIGHT_BROWSERS_PATH",
  // Browser-launch steering variables. Forwarded per-run so identity checks
  // can detect changes; the session registry rejects mismatches.
  "REAL_A11Y_CHROME_PATH",
  "REAL_A11Y_BROWSERS_DIR",
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "NO_PROXY",
  "no_proxy",
]);

export function isAllowedEnvKey(key: string): boolean {
  return (
    ALLOWED_ENV_OVERRIDES.has(key) ||
    key.startsWith("GITHUB_") ||
    key.startsWith("PLAYWRIGHT_")
  );
}
