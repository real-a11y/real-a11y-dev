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
  parseOpenOptions,
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
  openPage,
  snapshotPage,
} from "../session.js";

import {
  isAuthenticated,
  outputOf,
  rootOf,
  sessionFlags,
  singleTarget,
  type Target,
} from "./common.js";

async function withPage<T>(
  target: Target,
  flags: FlagValues,
  body: (session: Awaited<ReturnType<typeof createSession>>) => Promise<T>,
): Promise<{ value: T; finalUrl: string }> {
  const openOptions = parseOpenOptions(flags);
  const session = await createSession(sessionFlags(flags, [target]));
  try {
    progress(`opening ${target.name} …`, { quiet: flags.quiet === true });
    const opened = await openPage(
      session,
      target.url,
      openOptions,
      target.fileApproved,
      isAuthenticated(flags),
    );
    return { value: await body(session), finalUrl: redactUrl(opened.url) };
  } finally {
    await session.close();
  }
}

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

function makeNativeView(
  command: "tree" | "outline",
  pick: (snapshot: { tree: string; outline: string }) => string,
): CommandFn {
  return async (positionals, flags) => {
    // Validate the format before a browser launches.
    parseFormat(flags.format, ["pretty", "json"] as const);
    const target = singleTarget(positionals, flags, command);
    const { value: text, finalUrl } = await withPage(target, flags, (session) =>
      nativeSnapshot(session, {
        includeGeneric: flags["include-generic"] === true,
      }).then(pick),
    );
    return writeView(command, target, flags, finalUrl, text);
  };
}

export const treeCommand = makeNativeView("tree", (s) => s.tree);
export const outlineCommand = makeNativeView("outline", (s) => s.outline);

/** The one DOM read left: tab ORDER is layout work Chromium's AX tree doesn't
 *  expose (`tabindex` never reaches a native node), so this walks the page. */
export const tabsCommand: CommandFn = async (positionals, flags) => {
  parseFormat(flags.format, ["pretty", "json"] as const);
  const target = singleTarget(positionals, flags, "tabs");
  const { value: text, finalUrl } = await withPage(target, flags, (session) =>
    snapshotPage(session, rootOf(flags), {}).then((s) => s.tabOrder),
  );
  return writeView("tabs", target, flags, finalUrl, text);
};

export const listCommand: CommandFn = async (positionals, flags) => {
  const category = parseListCategory(positionals[0]);
  const format = parseFormat(flags.format, ["pretty", "json"] as const);
  const target = singleTarget(positionals.slice(1), flags, "list");
  // Listed from the native tree in Node — the same category engine the page
  // bundle runs, over the tree `audit` and `tree` already agree on.
  const { value: raw, finalUrl } = await withPage(target, flags, (session) =>
    nativeTree(session).then((tree) =>
      listByRole(tree, category as RoleFilter),
    ),
  );
  const text = sanitizeText(raw);
  if (format === "json") {
    const page: PageReport = {
      name: target.name,
      url: finalUrl,
      findings: [],
      items: text === "" ? [] : text.split("\n"),
    };
    writeReport(outputOf(flags), renderJson("list", [page]));
  } else {
    writeReport(outputOf(flags), text.endsWith("\n") ? text : `${text}\n`);
  }
  return EXIT.OK;
};
