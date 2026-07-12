/**
 * JUnit XML — the lingua franca of CI test-report ingesters (Jenkins, GitLab,
 * Azure DevOps "Publish Test Results", CircleCI…). One `<testsuite>` per page;
 * one `<testcase>` per finding (as a `<failure>`); baseline-suppressed findings
 * are `<skipped>` (visible, non-failing — same "report truth, gate policy" as
 * everywhere else); a clean page emits one passing placeholder case so
 * ingesters that treat an empty suite as "no tests ran" stay happy.
 */

import type { SnapshotArtifact } from "../snapshot-artifact.js";

function esc(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function renderJUnit(artifact: SnapshotArtifact): string {
  const suites: string[] = [];
  let totalTests = 0;
  let totalFailures = 0;
  let totalErrors = 0;
  let totalSkipped = 0;

  for (const page of artifact.pages) {
    const cases: string[] = [];
    let failures = 0;
    let errors = 0;
    let skipped = 0;

    if (page.status === "error") {
      errors += 1;
      cases.push(
        `    <testcase name="page audited" classname="${esc(page.name)}">\n` +
          `      <error message="${esc(page.error ?? "page failed to audit")}"/>\n` +
          `    </testcase>`,
      );
    } else if (page.findings.length === 0) {
      cases.push(
        `    <testcase name="page audited" classname="${esc(page.name)}"/>`,
      );
    } else {
      for (const f of page.findings) {
        const name = esc(`${f.rule}${f.locator ? ` at ${f.locator}` : ""}`);
        const body = esc(
          `${f.message}${f.context ? ` (${f.context})` : ""} [${f.fingerprint}]`,
        );
        if (f.suppressed) {
          skipped += 1;
          cases.push(
            `    <testcase name="${name}" classname="${esc(page.name)}">\n` +
              `      <skipped message="baselined: ${body}"/>\n` +
              `    </testcase>`,
          );
        } else {
          failures += 1;
          cases.push(
            `    <testcase name="${name}" classname="${esc(page.name)}">\n` +
              `      <failure message="${body}" type="${esc(f.severity)}"/>\n` +
              `    </testcase>`,
          );
        }
      }
    }

    const tests = Math.max(cases.length, 1);
    totalTests += tests;
    totalFailures += failures;
    totalErrors += errors;
    totalSkipped += skipped;
    suites.push(
      `  <testsuite name="${esc(page.name)}" tests="${tests}" failures="${failures}" errors="${errors}" skipped="${skipped}">\n` +
        `${cases.join("\n")}\n` +
        `  </testsuite>`,
    );
  }

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<testsuites name="real-a11y" tests="${totalTests}" failures="${totalFailures}" errors="${totalErrors}" skipped="${totalSkipped}">\n` +
    `${suites.join("\n")}\n` +
    `</testsuites>\n`
  );
}
