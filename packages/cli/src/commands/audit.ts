/**
 * `real-a11y audit <url...>` — the flagship: findings grouped by rule, exit 1
 * on errors by default. Multi-page runs share one session; a failed page
 * becomes an `error` entry (exit 2) while the others still report.
 */

import {
  parseFailOn,
  parseFormat,
  parseOpenOptions,
  parseRules,
  type CommandFn,
} from "../args.js";
import { CliError, EXIT, exceedsThreshold, formatCliError } from "../exit.js";
import { fingerprintFindings } from "../fingerprint.js";
import { progress, writeReport } from "../output.js";
import {
  appendStepSummary,
  emitAnnotations,
  shouldAnnotate,
} from "../render/annotations.js";
import { colorEnabled } from "../render/color.js";
import { renderJson, type PageReport } from "../render/json.js";
import { renderPretty } from "../render/pretty.js";
import { redactUrl } from "../sanitize.js";
import { createSession, openPage, snapshotPage } from "../session.js";

import {
  isAuthenticated,
  outputOf,
  resolveTargets,
  rootOf,
  sessionFlags,
} from "./common.js";

export const auditCommand: CommandFn = async (positionals, flags) => {
  // Everything user-typed validates before a browser launches.
  const rules = parseRules(flags.rules);
  const failOn = parseFailOn(flags["fail-on"], "error");
  const format = parseFormat(flags.format, ["pretty", "json"] as const);
  const openOptions = parseOpenOptions(flags);
  const targets = resolveTargets(positionals, flags);
  const output = outputOf(flags);
  const quiet = flags.quiet === true;
  const authed = isAuthenticated(flags);

  const session = await createSession(sessionFlags(flags, targets));
  const pages: PageReport[] = [];
  try {
    for (const target of targets) {
      progress(`auditing ${target.name} …`, { quiet });
      const started = Date.now();
      try {
        const opened = await openPage(
          session,
          target.url,
          openOptions,
          target.fileApproved,
          authed,
        );
        const snapshot = await snapshotPage(session, rootOf(flags), {
          ...(rules ? { rules } : {}),
        });
        pages.push({
          name: target.name,
          url: redactUrl(opened.url),
          findings: fingerprintFindings(target.name, snapshot.findings),
        });
        if (flags.verbose === true) {
          progress(`  done in ${Date.now() - started}ms`, { quiet });
        }
      } catch (err) {
        if (!(err instanceof CliError)) throw err;
        // The report entry keeps multi-page context; the stderr line keeps
        // the error-catalog contract (errors are visible on stderr).
        process.stderr.write(`${formatCliError(err)}\n`);
        pages.push({
          name: target.name,
          url: target.name,
          findings: [],
          error: err.hint ? `${err.message} (${err.hint})` : err.message,
        });
      }
    }
  } finally {
    await session.close();
  }

  const content =
    format === "json"
      ? renderJson("audit", pages)
      : renderPretty(pages, { color: output === undefined && colorEnabled() });
  writeReport(output, content);

  if (shouldAnnotate(flags)) {
    emitAnnotations(pages);
    appendStepSummary("audit", pages);
  }
  if (format === "pretty" && !quiet && process.stdout.isTTY) {
    process.stderr.write(
      `tip: run 'real-a11y inspect ${targets[0].name}' to see the semantic tree\n`,
    );
  }

  if (pages.some((p) => p.error)) return EXIT.ERROR;
  const findings = pages.flatMap((p) => p.findings);
  return exceedsThreshold(findings, failOn) ? EXIT.FINDINGS : EXIT.OK;
};
