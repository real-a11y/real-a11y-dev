/**
 * The view commands — tree / outline / tabs / list. Views, not gates: they
 * always exit 0 unless something actually failed. All three snapshot views
 * come from the shared single-extraction snapshot; `list` calls the page
 * bundle's listByRole directly.
 */

import {
  redactUrl,
  sanitizeText,
  type CleanSnapshot,
} from "@real-a11y-dev/snapshot";

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
import { callPage, createSession, openPage, snapshotPage } from "../session.js";

import {
  isAuthenticated,
  outputOf,
  rootOf,
  sessionFlags,
  singleTarget,
  producerOf,
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

function makeSnapshotView(
  command: "tree" | "outline" | "tabs",
  pick: (snapshot: CleanSnapshot) => string,
): CommandFn {
  return async (positionals, flags) => {
    const format = parseFormat(flags.format, ["pretty", "json"] as const);
    // tabs is a tab-order view; a native tree carries none, so only tree/outline
    // opt into native.
    const producer = producerOf(flags, command, command !== "tabs");
    const target = singleTarget(positionals, flags, command);
    const { value: text, finalUrl } = await withPage(
      target,
      flags,
      async (session) => {
        const snapshot = await snapshotPage(
          session,
          rootOf(flags),
          { includeGeneric: flags["include-generic"] === true },
          producer,
        );
        return pick(snapshot);
      },
    );
    if (format === "json") {
      const page: PageReport = {
        name: target.name,
        url: finalUrl,
        findings: [],
      };
      if (command === "tree") page.tree = text;
      else if (command === "outline") page.outline = text;
      else page.tabs = text;
      writeReport(outputOf(flags), renderJson(command, [page]));
    } else {
      writeReport(outputOf(flags), text.endsWith("\n") ? text : `${text}\n`);
    }
    return EXIT.OK;
  };
}

export const treeCommand = makeSnapshotView("tree", (s) => s.tree);
export const outlineCommand = makeSnapshotView("outline", (s) => s.outline);
export const tabsCommand = makeSnapshotView("tabs", (s) => s.tabOrder);

export const listCommand: CommandFn = async (positionals, flags) => {
  const category = parseListCategory(positionals[0]);
  // list runs the page-bundle's listByRole in the page; there's no native path.
  producerOf(flags, "list", false);
  const format = parseFormat(flags.format, ["pretty", "json"] as const);
  const target = singleTarget(positionals.slice(1), flags, "list");
  const { value: raw, finalUrl } = await withPage(target, flags, (session) =>
    callPage<string>(session, "listByRole", rootOf(flags), [category]),
  );
  const text = sanitizeText(typeof raw === "string" ? raw : String(raw));
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
