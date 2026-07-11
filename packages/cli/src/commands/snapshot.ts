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

import { parseOpenOptions, parseRules, type CommandFn } from "../args.js";
import { loadConfig, type ConfigPage } from "../config.js";
import { CliError, EXIT } from "../exit.js";
import { fingerprintFindings } from "../fingerprint.js";
import { progress, writeReport } from "../output.js";
import { renderSnapshotMarkdown } from "../render/md.js";
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

/** Pages from A11Y_PAGES env (diff-bot compat) if set, else the config file. */
function resolvePages(flags: Record<string, string | boolean | undefined>): {
  pages: ConfigPage[];
  rules?: string[];
  device?: string;
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
  return { pages: config.pages, rules: config.rules, device: config.device };
}

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
  } = resolvePages(flags);
  const flagRules = parseRules(flags.rules);
  const rules = flagRules ?? (configRules as ReturnType<typeof parseRules>);
  const openOptions = parseOpenOptions(flags);
  if (configDevice && !openOptions.device) openOptions.device = configDevice;
  const asMarkdown = flags.md === true;
  const output =
    typeof flags.output === "string"
      ? flags.output
      : process.env.A11Y_SNAPSHOT_OUT;
  const quiet = flags.quiet === true;

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

  const artifact = buildArtifact(snapshotPages, {
    toolName: "@real-a11y-dev/cli",
    toolVersion: toolVersion(),
    ...(rules ? { rules } : {}),
    ...(openOptions.device ? { device: openOptions.device } : {}),
  });
  writeReport(
    output,
    asMarkdown ? renderSnapshotMarkdown(artifact) : serializeArtifact(artifact),
  );

  return snapshotPages.some((p) => p.status === "error") ? EXIT.ERROR : EXIT.OK;
};
