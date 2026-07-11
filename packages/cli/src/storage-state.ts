/**
 * Storage-state file handling for authenticated audits. The file is a
 * CREDENTIAL — it holds live session cookies — so this module validates its
 * shape up front (before Playwright's raw ENOENT stack) and never echoes its
 * contents into an error message. It reads paths; it never logs values.
 */

import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { CliError } from "./exit.js";

/**
 * Validate that `path` is a readable Playwright storage-state JSON, returning
 * the resolved absolute path (what the engine loads). Throws a catalog-style
 * CliError otherwise — quoting the path only, never the file's contents.
 */
export function validateStorageStatePath(path: string): string {
  const abs = resolve(path);
  try {
    if (!statSync(abs).isFile()) {
      throw new CliError(`storage state path is not a file: ${abs}`);
    }
  } catch (err) {
    if (err instanceof CliError) throw err;
    throw new CliError(
      `storage state file not found: ${abs}`,
      "create it with: real-a11y login <url> --save <file>",
    );
  }

  let raw: string;
  try {
    raw = readFileSync(abs, "utf8");
  } catch {
    throw new CliError(`storage state file is not readable: ${abs}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CliError(
      `${abs} is not a Playwright storage state file (expected JSON with "cookies"/"origins").`,
      "re-create it with: real-a11y login <url> --save <file>",
    );
  }

  // Shape-sniff: Playwright's shape is { cookies: [], origins: [] }. Accept
  // either array being present — never inspect the values.
  const shape = parsed as { cookies?: unknown; origins?: unknown };
  const ok =
    (parsed !== null && typeof parsed === "object") &&
    (Array.isArray(shape.cookies) || Array.isArray(shape.origins));
  if (!ok) {
    throw new CliError(
      `${abs} is not a Playwright storage state file (expected JSON with "cookies"/"origins").`,
      "re-create it with: real-a11y login <url> --save <file>",
    );
  }
  return abs;
}
