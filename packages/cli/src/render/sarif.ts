/**
 * SARIF 2.1.0 — the interop format for GitHub code scanning (Security tab),
 * Azure DevOps, and the VS Code SARIF viewer.
 *
 * The non-obvious constraints (each learned the hard way by other tools):
 *
 * - GitHub only DISPLAYS results located by a repo file path — a bare page URL
 *   renders nothing (Trivy hit exactly this, aquasecurity/trivy#1038). So every
 *   result anchors to `pages[].sourcePath ?? <the config file>`, which is why
 *   `--format sarif` requires a config file.
 * - `partialFingerprints.primaryLocationLineHash` is the ONE key GitHub uses
 *   for alert identity; without a tool-supplied value it backfills from the
 *   anchored line's text, so same-file findings collapse into one alert and any
 *   config edit churns them all. We supply the stable `v1:` fingerprint.
 * - `automationDetails.id` is per CONFIG, not per page — a per-page id would
 *   orphan its alert "category" whenever a page is renamed.
 * - Baseline-suppressed findings are EXCLUDED (GitHub ignores `suppressions[]`
 *   — the dismiss-alerts action exists precisely because of this); a suppressed
 *   finding surfacing as a Security alert would defeat the baseline.
 */

import { basename, isAbsolute, relative } from "node:path";

import { ALL_RULES } from "@real-a11y-dev/audit";

import type { SnapshotArtifact } from "../snapshot-artifact.js";

/** Most severe level each rule can emit (per assertions.ts) — SARIF wants the
 *  rule-level default; the per-result `level` still carries the actual one. */
const RULE_LEVEL: Record<string, "error" | "warning"> = {
  "no-unlabeled-interactive": "error",
  "image-alt": "warning",
  "heading-order": "warning",
  "dialog-labeled": "error",
  "landmark-structure": "error",
};

const RULE_DESCRIPTION: Record<string, string> = {
  "no-unlabeled-interactive":
    "Interactive elements must have an accessible name.",
  "image-alt": "Images must have alternative text (or be marked decorative).",
  "heading-order":
    "Headings must start at h1 and not skip levels; exactly one h1.",
  "dialog-labeled": "Dialogs must have an accessible name.",
  "landmark-structure":
    "Pages need a main landmark and at most one banner/contentinfo.",
};

const MESSAGE_CAP = 1_000; // GitHub truncates message fields at 1 000 chars.

export interface SarifContext {
  /** Absolute path of the loaded a11y.config.json — the anchoring fallback. */
  configPath: string;
  /** Repo root the artifact URIs are made relative to (default: cwd). */
  rootDir?: string;
}

/** Repo-relative, forward-slash URI for `artifactLocation`. */
function toUri(path: string, rootDir: string): string {
  const rel = isAbsolute(path) ? relative(rootDir, path) : path;
  return rel.replaceAll("\\", "/");
}

function cap(text: string): string {
  return text.length > MESSAGE_CAP
    ? `${text.slice(0, MESSAGE_CAP - 1)}…`
    : text;
}

export function renderSarif(
  artifact: SnapshotArtifact,
  ctx: SarifContext,
): string {
  const rootDir = ctx.rootDir ?? process.cwd();
  const configUri = toUri(ctx.configPath, rootDir);
  const configStem = basename(ctx.configPath).replace(/\.[^.]+$/, "");

  // sourcePath map comes from the artifact pages themselves (the snapshot
  // command stores it when the config provides one).
  const results = [];
  for (const page of artifact.pages) {
    const uri = page.sourcePath ? toUri(page.sourcePath, rootDir) : configUri;
    for (const f of page.findings) {
      if (f.suppressed) continue; // excluded — see the header comment
      const where = [
        f.locator ? ` — at ${f.locator}` : "",
        f.context ? ` (${f.context})` : "",
        ` [page: ${page.name}, ${page.url}]`,
      ].join("");
      results.push({
        ruleId: f.rule,
        level: f.severity,
        message: { text: cap(`${f.message}${where}`) },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri },
              region: { startLine: 1 },
            },
            ...(f.locator
              ? {
                  logicalLocations: [
                    { fullyQualifiedName: f.locator, kind: "element" },
                  ],
                }
              : {}),
          },
        ],
        partialFingerprints: { primaryLocationLineHash: f.fingerprint },
      });
    }
  }

  const sarif = {
    $schema:
      "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "real-a11y",
            informationUri: "https://real-a11y.dev/",
            version: artifact.tool.version,
            rules: ALL_RULES.map((rule) => ({
              id: rule,
              name: rule,
              shortDescription: { text: RULE_DESCRIPTION[rule] ?? rule },
              helpUri: "https://real-a11y.dev/packages/testing/assertions",
              defaultConfiguration: { level: RULE_LEVEL[rule] ?? "warning" },
            })),
          },
        },
        automationDetails: { id: `real-a11y/${configStem}` },
        results,
      },
    ],
  };
  return `${JSON.stringify(sarif, null, 2)}\n`;
}
