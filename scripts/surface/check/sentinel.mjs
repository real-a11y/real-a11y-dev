// The one string the renderer and the CI workflow both have to agree on.
//
// `docs-currency.yml` decides whether to post a sticky comment by looking for a
// marker in the rendered report. That is a coupling across two files in two
// languages, and it has already failed once: the workflow matched on the
// report's PROSE (`report.includes("No public-surface changes")`), someone
// reworded the report — deliberately, to stop it overclaiming — and the test
// silently became always-false. Every PR with no inventory movement would have
// received a comment it used to be spared, and no existing comment would ever
// have cleared itself.
//
// Nothing failed. That is the point: a string match that stops matching doesn't
// throw, it just quietly takes the other branch. So the agreement is asserted
// here, in the check that already runs on every PR.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { NOTHING_TO_REPORT } from "../plan/report.mjs";

const WORKFLOW = ".github/workflows/docs-currency.yml";

/** Pull the literal the workflow actually tests against, not one we assume. */
const MATCHER = /const nothingToSay = report\.includes\((['"])(.*?)\1\)/;

/**
 * @returns {Promise<{where: string, message: string}[]>}
 */
export async function checkPlanSentinel(repoRoot) {
  let workflow;
  try {
    workflow = await readFile(join(repoRoot, WORKFLOW), "utf8");
  } catch {
    return [
      {
        where: WORKFLOW,
        message:
          `is missing. The sticky surface-plan comment is posted from it, so ` +
          `either it moved — update ${"scripts/surface/check/sentinel.mjs"} — or ` +
          `the comment silently stopped happening.`,
      },
    ];
  }

  const found = MATCHER.exec(workflow);
  if (!found) {
    return [
      {
        where: WORKFLOW,
        message:
          `no \`const nothingToSay = report.includes(…)\` line found. That is how ` +
          `the workflow decides whether to post at all; if it was restructured, ` +
          `re-point this check at whatever replaced it rather than deleting it — ` +
          `the coupling is still there, just unguarded.`,
      },
    ];
  }

  const matched = found[2];
  if (matched !== NOTHING_TO_REPORT) {
    return [
      {
        where: WORKFLOW,
        message:
          `looks for ${JSON.stringify(matched)} but the renderer emits ` +
          `${JSON.stringify(NOTHING_TO_REPORT)} (NOTHING_TO_REPORT in ` +
          `scripts/surface/plan/report.mjs). They must be identical: when they ` +
          `drift, nothing errors — the workflow just posts a sticky comment on ` +
          `every quiet PR and never clears an existing one.`,
      },
    ];
  }

  return [];
}
