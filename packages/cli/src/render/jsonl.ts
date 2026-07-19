/**
 * JSONL — one finding per line, for `jq`/grep pipelines and log ingesters.
 * Just findings: no header/footer framing records (deliberately cut — a
 * consumer that wants the run metadata reads the JSON artifact instead).
 * Suppressed findings are included, flagged — filter with
 * `jq 'select(.suppressed | not)'`.
 */

import type { SnapshotArtifact } from "@real-a11y-dev/snapshot";

export function renderJsonl(artifact: SnapshotArtifact): string {
  const lines: string[] = [];
  for (const page of artifact.pages) {
    for (const f of page.findings) {
      lines.push(
        JSON.stringify({
          page: page.name,
          url: page.url,
          rule: f.rule,
          severity: f.severity,
          message: f.message,
          ...(f.locator !== undefined ? { locator: f.locator } : {}),
          ...(f.context !== undefined ? { context: f.context } : {}),
          fingerprint: f.fingerprint,
          ...(f.suppressed ? { suppressed: true } : {}),
        }),
      );
    }
  }
  return lines.length ? `${lines.join("\n")}\n` : "";
}
