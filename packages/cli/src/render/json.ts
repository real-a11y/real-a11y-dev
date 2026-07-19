/**
 * The stable machine envelope — one shape for every command, single- or
 * multi-page, so scripts always read `.pages[0].…` with no special cases.
 *
 * `schemaVersion` is the contract: within 0.x changes are additive-only;
 * breaking changes bump it (and get a changeset).
 */

import type { Finding } from "@real-a11y-dev/audit";

import type { FingerprintedFinding } from "@real-a11y-dev/snapshot";

export const JSON_SCHEMA_VERSION = 1;

export interface Summary {
  total: number;
  errors: number;
  warnings: number;
}

/** One audited page — the unit both renderers and annotations consume. */
export interface PageReport {
  /** Display identity (redacted URL today; config page name in phase 2). */
  name: string;
  /** Final (redacted) URL after navigation. */
  url: string;
  findings: FingerprintedFinding[];
  /** Serialized views — present per command (tree/inspect etc.). */
  tree?: string;
  outline?: string;
  tabs?: string;
  /** `list` lines. */
  items?: string[];
  /** Page-level failure; other pages still report. */
  error?: string;
}

export function summarize(findings: readonly Finding[]): Summary {
  let errors = 0;
  for (const f of findings) if (f.severity === "error") errors += 1;
  return { total: findings.length, errors, warnings: findings.length - errors };
}

export function summarizeAll(pages: readonly PageReport[]): Summary {
  return summarize(pages.flatMap((p) => p.findings));
}

export function renderJson(
  command: string,
  pages: readonly PageReport[],
): string {
  const payload = {
    schemaVersion: JSON_SCHEMA_VERSION,
    command,
    summary: summarizeAll(pages),
    pages: pages.map((page) => ({
      name: page.name,
      url: page.url,
      summary: summarize(page.findings),
      findings: page.findings,
      ...(page.tree !== undefined ? { tree: page.tree } : {}),
      ...(page.outline !== undefined ? { outline: page.outline } : {}),
      ...(page.tabs !== undefined ? { tabs: page.tabs } : {}),
      ...(page.items !== undefined ? { items: page.items } : {}),
      ...(page.error !== undefined ? { error: page.error } : {}),
    })),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}
