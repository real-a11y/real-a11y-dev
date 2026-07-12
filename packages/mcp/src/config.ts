/**
 * Environment-sourced configuration for the stdio server (index.ts). Kept
 * separate from the bin so the validation — which must refuse to start on a
 * bad credential file — is unit-testable without running `main()`.
 */

import { readFileSync, statSync } from "node:fs";

/**
 * Validate the storage-state file BEFORE the server accepts tool calls — a
 * server that silently audits logged-out pages is worse than one that refuses
 * to start. The file is a credential, so errors quote the path only, never its
 * contents.
 */
export function assertValidStorageState(path: string): void {
  let raw: string;
  try {
    if (!statSync(path).isFile()) {
      throw new Error(`REAL_A11Y_MCP_STORAGE_STATE is not a file: ${path}`);
    }
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if (err instanceof Error && err.message.includes("STORAGE_STATE"))
      throw err;
    // The fs error carries the path (already in our message), never contents.
    throw new Error(`REAL_A11Y_MCP_STORAGE_STATE could not be read: ${path}`, {
      cause: err,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `REAL_A11Y_MCP_STORAGE_STATE is not valid JSON: ${path} (expected a Playwright storage-state file with "cookies"/"origins").`,
    );
  }
  const shape = parsed as { cookies?: unknown; origins?: unknown };
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !(Array.isArray(shape.cookies) || Array.isArray(shape.origins))
  ) {
    throw new Error(
      `REAL_A11Y_MCP_STORAGE_STATE is not a Playwright storage-state file: ${path} (expected JSON with "cookies"/"origins").`,
    );
  }
}

/** Parse the comma-separated origin allowlist, normalizing each to its origin. */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((value) => {
      try {
        return new URL(value).origin;
      } catch {
        throw new Error(
          `REAL_A11Y_MCP_ALLOWED_ORIGINS contains an invalid origin: "${value}" (expected e.g. https://app.example.com).`,
        );
      }
    });
}
