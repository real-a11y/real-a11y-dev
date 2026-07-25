/**
 * `real-a11y audit <url...>` — the flagship: findings grouped by rule, exit 1
 * on errors by default. Multi-page runs share one session; a failed page
 * becomes an `error` entry (exit 2) while the others still report.
 */

import { fingerprintFindings, redactUrl } from "@real-a11y-dev/snapshot";

import {
  parseFailOn,
  parseFormat,
  parseOpenOptions,
  parseRules,
  type CommandFn,
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

import { createSession, openPage, snapshotPage } from "../session.js";

import {
  isAuthenticated,
  outputOf,
  resolveAuditTargets,
  rootOf,
  sessionFlags,
  producerOf,
} from "./common.js";

export const auditCommand: CommandFn = async (
  positionals,
  flags,
  seededFromConfig,
) => {
  // Everything user-typed validates before a browser launches.
  const rules = parseRules(flags.rules);
  const failOn = parseFailOn(flags["fail-on"], "error");
  const format = parseFormat(flags.format, ["pretty", "json"] as const);
  const producer = producerOf(flags, "audit", true);
  const openOptions = parseOpenOptions(flags);
  const targets = resolveAuditTargets(positionals, flags);
  // A `--root` the user actually typed. A config `defaults.root` also lands in
  // `flags.root` (run.ts seeds unset flags from `defaults`), and the two are
  // indistinguishable there — but only the typed one means "override whatever
  // this route configured, just for this run". Treating a project-wide default
  // as an override would let it silently beat every per-URL `rootSelector`.
  const typedRoot =
    typeof flags.root === "string" && !seededFromConfig?.has("root")
      ? flags.root
      : undefined;
  // `producerOf` already refuses `--producer native` alongside `--root`, but it
  // only sees flags. Now that a config `rootSelector` scopes the audit too, the
  // same combination has to fail here rather than silently auditing the whole
  // document and reporting findings from outside the configured subtree.
  // Keyed on `typedRoot`, so a `defaults.root` can't skip the check either.
  if (producer === "native" && typedRoot === undefined) {
    const scoped = targets.find((t) => t.page.rootSelector !== undefined);
    if (scoped) {
      throw new CliError(
        `--producer native audits the whole document — it can't be combined with the rootSelector on "${scoped.name}".`,
        "drop rootSelector from that URL entry, or use --producer dom (the default) to scope to a selector.",
      );
    }
  }
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
        // Precedence: a typed `--root` (a deliberate override for this run) >
        // the route's own `rootSelector` > a project-wide `defaults.root` >
        // `body`. `rootOf` supplies the last two, since a seeded `flags.root`
        // is exactly the project-wide default.
        const root = typedRoot ?? target.page.rootSelector ?? rootOf(flags);
        const snapshot = await snapshotPage(
          session,
          root,
          { ...(rules ? { rules } : {}) },
          producer,
        );
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
      // The URL, not `name` — `inspect` is positional-URL-only, and a config
      // entry's name is a label ("Login"), which `normalizeTarget` rejects.
      `tip: run 'real-a11y inspect ${redactUrl(targets[0].url)}' to see the semantic tree\n`,
    );
  }

  if (pages.some((p) => p.error)) return EXIT.ERROR;
  const findings = pages.flatMap((p) => p.findings);
  return exceedsThreshold(findings, failOn) ? EXIT.FINDINGS : EXIT.OK;
};
