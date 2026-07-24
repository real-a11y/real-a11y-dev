/**
 * `real-a11y snapshot` — audit a whole set of pages and write a single JSON
 * artifact (`a11y-snapshot.json`) with each page's fingerprinted findings PLUS
 * the serialized views. That artifact is what `diff` consumes — findings and
 * all, which is why it's JSON, not the old markdown snapshot (which had no
 * findings for `diff` to compare). `--md` additionally/instead renders a human
 * report.
 *
 * Pages come from `A11Y_PAGES` (drop-in compat with the diff-bot guide), else
 * an `a11y.config.json` (`--config` or auto-discovered). Output goes to
 * `--output`, else `A11Y_SNAPSHOT_OUT`, else stdout.
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import {
  applyBaseline,
  buildArtifact,
  buildBaseline,
  buildSnapshotPage,
  DEFAULT_BASELINE_PATH,
  loadBaseline,
  redactUrl,
  serializeArtifact,
  serializeBaseline,
  type Baseline,
  type SnapshotPage,
} from "@real-a11y-dev/snapshot";

import {
  parseFailOn,
  parseFormat,
  parseOnly,
  parseOpenOptions,
  parseRules,
  type CommandFn,
} from "../args.js";
import { type ConfigPage } from "../config.js";
import { CliError, EXIT, exceedsThreshold } from "../exit.js";

import { progress, writeReport } from "../output.js";
import { renderJsonl } from "../render/jsonl.js";
import { renderJUnit } from "../render/junit.js";
import { renderSnapshotMarkdown } from "../render/md.js";
import { renderSarif } from "../render/sarif.js";

import { createSession, openPage, snapshotPage } from "../session.js";

import { assertAllowedUrl, normalizeTarget } from "../url-gate.js";

import {
  resolvePageList,
  sessionFlags,
  producerOf,
  type Target,
} from "./common.js";

function toolVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    return (require("../package.json") as { version: string }).version;
  } catch {
    return "0.0.0";
  }
}

const SNAPSHOT_FORMATS = ["json", "md", "sarif", "junit", "jsonl"] as const;
type SnapshotFormat = (typeof SNAPSHOT_FORMATS)[number];

export const snapshotCommand: CommandFn = async (positionals, flags) => {
  const { pages: configPages, configPath } = resolvePageList(
    positionals,
    flags,
  );
  if (configPages.length === 0) {
    throw new CliError(
      "snapshot needs URLs to audit",
      "pass a URL (real-a11y snapshot <url>), add `urls` to a11y.config.json, or set A11Y_PAGES",
    );
  }
  // rules/device (and every other policy flag) already carry the config
  // `defaults` — run.ts merged them into `flags` before dispatch.
  const rules = parseRules(flags.rules);
  // The artifact carries tab-order per page for `diff`; a native tree has none.
  producerOf(flags, "snapshot", false);
  const openOptions = parseOpenOptions(flags);
  // `--md` predates `--format` here and stays as an alias for `--format md`.
  const format = parseFormat(flags.format, SNAPSHOT_FORMATS);
  if (flags.md === true && flags.format !== undefined && format !== "md") {
    throw new CliError(
      `--md conflicts with --format ${format} — pick one`,
      "(--md is shorthand for --format md)",
    );
  }
  const effectiveFormat: SnapshotFormat =
    flags.md === true && flags.format === undefined ? "md" : format;
  if (effectiveFormat === "sarif" && !configPath) {
    throw new CliError(
      "--format sarif needs a config file — SARIF results anchor to repo file paths, and the config (or its pages' sourcePath) is that anchor",
      "run with --config a11y.config.json instead of A11Y_PAGES",
    );
  }

  // --only shapes the md report, or writes a PARTIAL json artifact (marked
  // `meta.only` — a machine export `diff` refuses, so a filtered base can
  // never silently poison a CI diff). sarif/junit/jsonl are findings-shaped
  // by construction and reject the flag. The --fail-on gate always runs on
  // the FULL findings, captured before any stripping.
  const only = parseOnly(flags.only);
  if (only && effectiveFormat !== "md" && effectiveFormat !== "json") {
    throw new CliError(
      `--only ${only} shapes the md report or the json export — --format ${effectiveFormat} is findings-shaped by construction`,
      "use --format md for a filtered report, or --format json for a partial artifact",
    );
  }
  const output =
    typeof flags.output === "string"
      ? flags.output
      : process.env.A11Y_SNAPSHOT_OUT;
  const quiet = flags.quiet === true;
  const failOn = parseFailOn(flags["fail-on"], "never");
  const baselinePath =
    typeof flags.baseline === "string" ? flags.baseline : undefined;
  const updateBaseline = flags["update-baseline"] === true;

  // Normalize + gate every target up front (config-sourced → the stricter gate).
  const targets: (Target & { page: ConfigPage })[] = configPages.map((page) => {
    const url = normalizeTarget(page.url);
    const fileApproved = assertAllowedUrl(url, {
      source: "config",
      allowFile: flags["allow-file"] === true,
    });
    return { url, name: page.name, fileApproved, page };
  });
  if (targets.some((t) => t.fileApproved)) {
    process.env.REAL_A11Y_MCP_ALLOW_FILE = "1";
  }

  const session = await createSession(sessionFlags(flags));
  const snapshotPages: SnapshotPage[] = [];
  try {
    for (const target of targets) {
      progress(`snapshotting ${target.name} …`, { quiet });
      const root = target.page.rootSelector ?? "body";
      try {
        await openPage(session, target.url, openOptions, target.fileApproved);
        const snap = await snapshotPage(session, root, {
          ...(rules ? { rules } : {}),
        });
        snapshotPages.push(
          buildSnapshotPage(target.name, target.url, snap, {
            root,
            ...(target.page.sourcePath
              ? { sourcePath: target.page.sourcePath }
              : {}),
          }),
        );
      } catch (err) {
        if (!(err instanceof CliError)) throw err;
        snapshotPages.push({
          name: target.name,
          url: redactUrl(target.url),
          root,
          status: "error",
          error: err.message,
          findings: [],
          tree: "",
          outline: "",
          tabs: "",
        });
      }
    }
  } finally {
    await session.close();
  }

  const baselinePages = snapshotPages.map((p) => ({
    name: p.name,
    findings: p.findings,
  }));

  // --update-baseline: accept the current state as the new baseline and stop —
  // it writes the baseline file (not the artifact) and never gates.
  if (updateBaseline) {
    const writePath = baselinePath ?? DEFAULT_BASELINE_PATH;
    let old: Baseline | undefined;
    if (existsSync(resolve(writePath))) old = loadBaseline(writePath);
    const { baseline, added, removed } = buildBaseline(baselinePages, old);
    writeReport(writePath, serializeBaseline(baseline));
    process.stderr.write(
      `baseline ${writePath}: +${added} new, -${removed} stale\n`,
    );
    return snapshotPages.some((p) => p.status === "error")
      ? EXIT.ERROR
      : EXIT.OK;
  }

  // --baseline: suppress accepted findings (kept in the artifact, out of the
  // gate) and warn about entries that no longer match.
  if (baselinePath) {
    const { suppressed, stale } = applyBaseline(
      baselinePages,
      loadBaseline(baselinePath),
    );
    if (suppressed > 0 && !quiet) {
      process.stderr.write(`baseline: ${suppressed} finding(s) suppressed\n`);
    }
    if (stale.length > 0) {
      process.stderr.write(
        `real-a11y: warning: ${stale.length} baseline entr${
          stale.length === 1 ? "y no longer matches" : "ies no longer match"
        } — run --update-baseline to prune\n`,
      );
    }
  }

  const artifact = buildArtifact(snapshotPages, {
    toolName: "@real-a11y-dev/cli",
    toolVersion: toolVersion(),
    ...(rules ? { rules } : {}),
    ...(openOptions.device ? { device: openOptions.device } : {}),
  });
  // json + --only: a partial artifact — the filtered axis is stripped from
  // the pages and `meta.only` marks it so `diff` can refuse it outright.
  // Built AFTER the gate's findings are captured; never fed to the renderers
  // below (md filters at render time; sarif/junit/jsonl reject --only).
  const partial =
    only && effectiveFormat === "json"
      ? buildArtifact(
          snapshotPages.map((p) =>
            only === "views"
              ? { ...p, findings: [] }
              : { ...p, tree: "", outline: "", tabs: "" },
          ),
          {
            toolName: "@real-a11y-dev/cli",
            toolVersion: toolVersion(),
            ...(rules ? { rules } : {}),
            ...(openOptions.device ? { device: openOptions.device } : {}),
            only,
          },
        )
      : undefined;
  const content =
    effectiveFormat === "md"
      ? renderSnapshotMarkdown(artifact, only)
      : effectiveFormat === "sarif"
        ? renderSarif(artifact, { configPath: configPath as string })
        : effectiveFormat === "junit"
          ? renderJUnit(artifact)
          : effectiveFormat === "jsonl"
            ? renderJsonl(artifact)
            : serializeArtifact(partial ?? artifact);
  writeReport(output, content);

  if (snapshotPages.some((p) => p.status === "error")) return EXIT.ERROR;
  const active = snapshotPages
    .flatMap((p) => p.findings)
    .filter((f) => !f.suppressed);
  const gateFired = exceedsThreshold(active, failOn);
  // A views-only report carries no findings content, so a gating exit would
  // be inexplicable from the output alone — say why on stderr, where CI logs
  // show it next to the exit code. (The gate always runs on the FULL
  // findings; --only never changes what gates, only what's reported.)
  if (gateFired && only === "views") {
    const errors = active.filter((f) => f.severity === "error").length;
    process.stderr.write(
      `real-a11y: gate: ${active.length} unsuppressed finding(s) — ${errors} error(s) — at/above --fail-on ${failOn}; the report is views-only, drop --only views to see them\n`,
    );
  }
  return gateFired ? EXIT.FINDINGS : EXIT.OK;
};
