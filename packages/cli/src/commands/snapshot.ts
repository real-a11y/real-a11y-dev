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
  parseFailOn,
  parseFormat,
  parseOpenOptions,
  parseRules,
  type CommandFn,
} from "../args.js";
import {
  applyBaseline,
  buildBaseline,
  DEFAULT_BASELINE_PATH,
  loadBaseline,
  serializeBaseline,
  type Baseline,
} from "../baseline.js";
import { loadConfig, type ConfigPage } from "../config.js";
import { CliError, EXIT, exceedsThreshold } from "../exit.js";
import { fingerprintFindings } from "../fingerprint.js";
import { progress, writeReport } from "../output.js";
import { renderJsonl } from "../render/jsonl.js";
import { renderJUnit } from "../render/junit.js";
import { renderSnapshotMarkdown } from "../render/md.js";
import { renderSarif } from "../render/sarif.js";
import { redactUrl } from "../sanitize.js";
import { createSession, openPage, snapshotPage } from "../session.js";
import {
  buildArtifact,
  serializeArtifact,
  type SnapshotPage,
} from "../snapshot-artifact.js";
import { assertAllowedUrl, normalizeTarget } from "../url-gate.js";

import { sessionFlags, type Target } from "./common.js";

function toolVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    return (require("../package.json") as { version: string }).version;
  } catch {
    return "0.0.0";
  }
}

/** Pages from A11Y_PAGES env (diff-bot compat) if set, else the config file.
 *  `configPath` (absolute) is set only on the config path — `sarif` anchors
 *  its results to it. */
function resolvePages(flags: Record<string, string | boolean | undefined>): {
  pages: ConfigPage[];
  rules?: string[];
  device?: string;
  configPath?: string;
} {
  const env = process.env.A11Y_PAGES;
  if (env) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(env);
    } catch {
      throw new CliError(
        "A11Y_PAGES is not valid JSON (expected [{name,url}])",
      );
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new CliError("A11Y_PAGES must be a non-empty [{name,url}] array");
    }
    const pages = parsed.map((p, i) => {
      const o = p as Record<string, unknown>;
      if (typeof o?.name !== "string" || typeof o?.url !== "string") {
        throw new CliError(`A11Y_PAGES[${i}] needs string "name" and "url"`);
      }
      return { name: o.name, url: o.url } satisfies ConfigPage;
    });
    return { pages };
  }

  const configPath =
    typeof flags.config === "string"
      ? flags.config
      : flags["no-config"] === true
        ? undefined
        : existsSync("a11y.config.json")
          ? "a11y.config.json"
          : undefined;
  if (!configPath) {
    throw new CliError(
      "snapshot needs pages to audit",
      "add an a11y.config.json (or set A11Y_PAGES) — see --help",
    );
  }
  const config = loadConfig(configPath);
  return {
    pages: config.pages,
    rules: config.rules,
    device: config.device,
    configPath: resolve(configPath),
  };
}

const SNAPSHOT_FORMATS = ["json", "md", "sarif", "junit", "jsonl"] as const;
type SnapshotFormat = (typeof SNAPSHOT_FORMATS)[number];

export const snapshotCommand: CommandFn = async (positionals, flags) => {
  if (positionals.length > 0) {
    throw new CliError(
      "snapshot takes no positional URLs — list pages in a11y.config.json or A11Y_PAGES",
    );
  }
  const {
    pages: configPages,
    rules: configRules,
    device: configDevice,
    configPath,
  } = resolvePages(flags);
  const flagRules = parseRules(flags.rules);
  const rules = flagRules ?? (configRules as ReturnType<typeof parseRules>);
  const openOptions = parseOpenOptions(flags);
  if (configDevice && !openOptions.device) openOptions.device = configDevice;
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
        snapshotPages.push({
          name: target.name,
          url: redactUrl(target.url),
          root,
          ...(target.page.sourcePath
            ? { sourcePath: target.page.sourcePath }
            : {}),
          status: "ok",
          findings: fingerprintFindings(target.name, snap.findings),
          tree: snap.tree,
          outline: snap.outline,
          tabs: snap.tabOrder,
        });
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
  const content =
    effectiveFormat === "md"
      ? renderSnapshotMarkdown(artifact)
      : effectiveFormat === "sarif"
        ? renderSarif(artifact, { configPath: configPath as string })
        : effectiveFormat === "junit"
          ? renderJUnit(artifact)
          : effectiveFormat === "jsonl"
            ? renderJsonl(artifact)
            : serializeArtifact(artifact);
  writeReport(output, content);

  if (snapshotPages.some((p) => p.status === "error")) return EXIT.ERROR;
  const active = snapshotPages
    .flatMap((p) => p.findings)
    .filter((f) => !f.suppressed);
  return exceedsThreshold(active, failOn) ? EXIT.FINDINGS : EXIT.OK;
};
