/**
 * Per-request process.env management for the session daemon.
 */

import { ALLOWED_ENV_OVERRIDES, isAllowedEnvKey } from "./env-allowlist.js";

export function withEnvSnapshot(
  env: Record<string, string | undefined | null> | undefined,
): () => void {
  if (!env) {
    delete process.env.REAL_A11Y_MCP_ALLOW_FILE;
    return () => {
      delete process.env.REAL_A11Y_MCP_ALLOW_FILE;
    };
  }

  // Build the full set of keys we are going to manage: the caller may only
  // provide some of them, but we also clear all other allow-listed keys so a
  // value inherited from the daemon's spawning shell doesn't leak into a later
  // run whose caller didn't set it.
  const keysToManage = new Set<string>(ALLOWED_ENV_OVERRIDES);
  for (const key of Object.keys(env)) {
    if (isAllowedEnvKey(key)) keysToManage.add(key);
  }

  // Clear any GITHUB_/PLAYWRIGHT_ keys currently set that the caller did not
  // send, so they don't leak from one shell into another.
  for (const key of Object.keys(process.env)) {
    if (
      (key.startsWith("GITHUB_") || key.startsWith("PLAYWRIGHT_")) &&
      !(key in env)
    ) {
      keysToManage.add(key);
    }
  }

  const previous = new Map<string, string | undefined>();
  for (const key of keysToManage) {
    previous.set(key, process.env[key]);
    const value = env[key];
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return () => {
    for (const key of previous.keys()) {
      const value = previous.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}
