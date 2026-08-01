/**
 * `real-a11y audit <url...>` — the flagship: findings grouped by rule, exit 1
 * on errors by default. Multi-page runs share one session; a failed page
 * becomes an `error` entry (exit 2) while the others still report.
 *
 * Audits Chromium's own accessibility tree: whole-document (so nothing scopes
 * it), and it reaches structure no in-page walk does — a `<video controls>`'s
 * user-agent-shadow media controls among it. Findings carry locators, so the
 * reach costs nothing in actionability.
 */

import { fingerprintFindings, redactUrl } from "@real-a11y-dev/snapshot";

import {
  parseFailOn,
  parseFormat,
  parseRules,
  type CommandFn,
  type FlagValues,
} from "../args.js";
import { CliError, EXIT, exceedsThreshold, formatCliError } from "../exit.js";
import { progress, writeReport } from "../output.js";
import {
  appendStepSummary,
  emitAnnotations,
  shouldAnnotate,
} from "../render/annotations.js";
import { colorEnabled } from "../render/color.js";
import { renderJson, type PageReport } from "../render/json.js";
import { renderPretty } from "../render/pretty.js";
import { createSession, nativeSnapshot } from "../session.js";

import {
  ensurePageOpen,
  outputOf,
  resolveAuditTargets,
  sessionFlags,
  warnUnscopable,
} from "./common.js";

export async function runAuditOnSession(
  session: import("@real-a11y-dev/browser").BrowserSession,
  positionals: string[],
  flags: FlagValues,
): Promise<number> {
  const rules = parseRules(flags.rules);
  const failOn = parseFailOn(flags["fail-on"], "error");
  const format = parseFormat(flags.format, ["pretty", "json"] as const);
  const targets = resolveAuditTargets(positionals, flags);
  // Whole-document now, so a route's `rootSelector` can't narrow the audit.
  // Say so once and keep going — see `warnUnscopable`.
  warnUnscopable(
    "audit",
    targets.map((t) => t.page),
  );
  const output = outputOf(flags);
  const quiet = flags.quiet === true;

  const pages: PageReport[] = [];
  for (const target of targets) {
    progress(`auditing ${target.name} …`, { quiet });
    const started = Date.now();
    try {
      const { url: finalUrl } = await ensurePageOpen(session, target, flags);
      const snapshot = await nativeSnapshot(session, {
        ...(rules ? { rules } : {}),
      });
      pages.push({
        name: target.name,
        url: redactUrl(finalUrl),
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
        // The target we tried to open — the success path reports the URL the
        // browser landed on, which doesn't exist here. Not `target.name`:
        // that's a display label for a named config entry, so this field
        // would stop being a URL for exactly the routes that have one.
        url: redactUrl(target.url),
        findings: [],
        error: err.hint ? `${err.message} (${err.hint})` : err.message,
      });
    }
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
      // The URL, not `name` — `inspect` is positional-URL-only, and a config
      // entry's name is a label ("Login"), which `normalizeTarget` rejects.
      `tip: run 'real-a11y inspect ${redactUrl(targets[0].url)}' to see the semantic tree\n`,
    );
  }

  if (pages.some((p) => p.error)) return EXIT.ERROR;
  const findings = pages.flatMap((p) => p.findings);
  return exceedsThreshold(findings, failOn) ? EXIT.FINDINGS : EXIT.OK;
}

export const auditCommand: CommandFn = async (positionals, flags) => {
  const targets = resolveAuditTargets(positionals, flags);
  const session = await createSession(sessionFlags(flags, targets));
  try {
    return await runAuditOnSession(session, positionals, flags);
  } finally {
    await session.close();
  }
};
