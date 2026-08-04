/**
 * The view commands — tree / outline / tabs / list. Views, not gates: they
 * always exit 0 unless something actually failed.
 *
 * `tree`, `outline`, and `list` read Chromium's own accessibility tree, so they
 * agree with `audit` node for node and reach what an in-page walk can't.
 * `tabs` is the deliberate holdout: native knows whether a node is focusable
 * but not the SEQUENCE, so the tab view is built from the in-page DOM walk —
 * the only source, not a fallback.
 */

import { listByRole, type RoleFilter } from "@real-a11y-dev/audit";
import { numberTabStops } from "@real-a11y-dev/serialize";
import { redactUrl, sanitizeText } from "@real-a11y-dev/snapshot";

import {
  parseFormat,
  parseListCategory,
  type CommandFn,
  type FlagValues,
} from "../args.js";
import { EXIT } from "../exit.js";
import { progress, writeReport } from "../output.js";
import { renderJson, type PageReport } from "../render/json.js";
import {
  createSession,
  nativeSnapshot,
  nativeTree,
  snapshotPage,
} from "../session.js";

import {
  ensurePageOpen,
  outputOf,
  rootOf,
  sessionFlags,
  singleTarget,
  type Target,
} from "./common.js";

/** Emit one view, either as `--format json` or as plain text. */
function writeView(
  command: "tree" | "outline" | "tabs",
  target: Target,
  flags: FlagValues,
  finalUrl: string,
  text: string,
): number {
  const format = parseFormat(flags.format, ["pretty", "json"] as const);
  if (format === "json") {
    const page: PageReport = { name: target.name, url: finalUrl, findings: [] };
    if (command === "tree") page.tree = text;
    else if (command === "outline") page.outline = text;
    else page.tabs = text;
    writeReport(outputOf(flags), renderJson(command, [page]));
  } else {
    // Number the tab-order view at print time — a terminal listing reads
    // better with an explicit ordinal. The stored `json` form above and the
    // shared snapshot stay canonical (unnumbered) so nothing committed churns.
    const pretty = command === "tabs" ? numberTabStops(text) : text;
    writeReport(
      outputOf(flags),
      pretty.endsWith("\n") ? pretty : `${pretty}\n`,
    );
  }
  return EXIT.OK;
}

export async function runTreeOnSession(
  session: import("@real-a11y-dev/browser").BrowserSession,
  positionals: string[],
  flags: FlagValues,
): Promise<number> {
  parseFormat(flags.format, ["pretty", "json"] as const);
  const target = singleTarget(positionals, flags, "tree");
  progress(`opening ${target.name} …`, { quiet: flags.quiet === true });
  const { url: finalUrl } = await ensurePageOpen(session, target, flags);
  const snapshot = await nativeSnapshot(session, {
    includeGeneric: flags["include-generic"] === true,
  });
  return writeView("tree", target, flags, redactUrl(finalUrl), snapshot.tree);
}

export async function runOutlineOnSession(
  session: import("@real-a11y-dev/browser").BrowserSession,
  positionals: string[],
  flags: FlagValues,
): Promise<number> {
  parseFormat(flags.format, ["pretty", "json"] as const);
  const target = singleTarget(positionals, flags, "outline");
  progress(`opening ${target.name} …`, { quiet: flags.quiet === true });
  const { url: finalUrl } = await ensurePageOpen(session, target, flags);
  const snapshot = await nativeSnapshot(session, {
    includeGeneric: flags["include-generic"] === true,
  });
  return writeView(
    "outline",
    target,
    flags,
    redactUrl(finalUrl),
    snapshot.outline,
  );
}

export async function runTabsOnSession(
  session: import("@real-a11y-dev/browser").BrowserSession,
  positionals: string[],
  flags: FlagValues,
): Promise<number> {
  parseFormat(flags.format, ["pretty", "json"] as const);
  const target = singleTarget(positionals, flags, "tabs");
  progress(`opening ${target.name} …`, { quiet: flags.quiet === true });
  const { url: finalUrl } = await ensurePageOpen(session, target, flags);
  const text = await snapshotPage(session, rootOf(flags), {}).then(
    (s) => s.tabOrder,
  );
  return writeView("tabs", target, flags, redactUrl(finalUrl), text);
}

export async function runListOnSession(
  session: import("@real-a11y-dev/browser").BrowserSession,
  positionals: string[],
  flags: FlagValues,
): Promise<number> {
  const category = parseListCategory(positionals[0]);
  const format = parseFormat(flags.format, ["pretty", "json"] as const);
  const target = singleTarget(positionals.slice(1), flags, "list");
  progress(`opening ${target.name} …`, { quiet: flags.quiet === true });
  const { url: finalUrl } = await ensurePageOpen(session, target, flags);
  const raw = await nativeTree(session).then((tree) =>
    listByRole(tree, category as RoleFilter),
  );
  const text = sanitizeText(raw);
  if (format === "json") {
    const page: PageReport = {
      name: target.name,
      url: redactUrl(finalUrl),
      findings: [],
      items: text === "" ? [] : text.split("\n"),
    };
    writeReport(outputOf(flags), renderJson("list", [page]));
  } else {
    writeReport(outputOf(flags), text.endsWith("\n") ? text : `${text}\n`);
  }
  return EXIT.OK;
}

async function withOneShotCommand<T>(
  command: string,
  positionals: string[],
  flags: FlagValues,
  runner: (session: Awaited<ReturnType<typeof createSession>>) => Promise<T>,
): Promise<T> {
  const target = singleTarget(positionals, flags, command);
  parseFormat(flags.format, ["pretty", "json"] as const);
  outputOf(flags);
  const session = await createSession(sessionFlags(flags, [target]));
  try {
    return await runner(session);
  } finally {
    await session.close();
  }
}

export const treeCommand: CommandFn = async (positionals, flags) =>
  withOneShotCommand("tree", positionals, flags, (session) =>
    runTreeOnSession(session, positionals, flags),
  );

export const outlineCommand: CommandFn = async (positionals, flags) =>
  withOneShotCommand("outline", positionals, flags, (session) =>
    runOutlineOnSession(session, positionals, flags),
  );

export const tabsCommand: CommandFn = async (positionals, flags) =>
  withOneShotCommand("tabs", positionals, flags, (session) =>
    runTabsOnSession(session, positionals, flags),
  );

export const listCommand: CommandFn = async (positionals, flags) => {
  parseListCategory(positionals[0]);
  parseFormat(flags.format, ["pretty", "json"] as const);
  outputOf(flags);
  const target = singleTarget(positionals.slice(1), flags, "list");
  const session = await createSession(sessionFlags(flags, [target]));
  try {
    return await runListOnSession(session, positionals, flags);
  } finally {
    await session.close();
  }
};
