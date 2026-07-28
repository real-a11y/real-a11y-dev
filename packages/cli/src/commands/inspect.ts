/**
 * `real-a11y inspect <url>` — findings plus the tree and outline from ONE read
 * of Chromium's own accessibility tree (they can never disagree). Views print
 * first; findings and the summary line come last, so the gate outcome is the
 * final thing on screen.
 *
 * No tab order any more: a native tree carries none, and this command's whole
 * promise is that everything it prints describes the same instant — pairing a
 * native tree with a second, DOM-derived tab-order read would break exactly
 * that. `real-a11y tabs` is the tab sequence, and it agrees with `audit` on
 * findings, which it previously did not.
 */

import { fingerprintFindings, redactUrl } from "@real-a11y-dev/snapshot";

import {
  parseFailOn,
  parseFormat,
  parseOpenOptions,
  parseRules,
  type CommandFn,
} from "../args.js";
import { EXIT, exceedsThreshold } from "../exit.js";
import { progress, writeReport } from "../output.js";
import {
  appendStepSummary,
  emitAnnotations,
  shouldAnnotate,
} from "../render/annotations.js";
import { colorEnabled } from "../render/color.js";
import { renderJson, type PageReport } from "../render/json.js";
import { renderPretty } from "../render/pretty.js";

import { createSession, nativeSnapshot, openPage } from "../session.js";

import {
  isAuthenticated,
  outputOf,
  sessionFlags,
  singleTarget,
} from "./common.js";

function section(title: string, body: string): string {
  return `== ${title} ==\n${body.trim() === "" ? "(empty)" : body}\n`;
}

export const inspectCommand: CommandFn = async (positionals, flags) => {
  const rules = parseRules(flags.rules);
  const failOn = parseFailOn(flags["fail-on"], "error");
  const format = parseFormat(flags.format, ["pretty", "json"] as const);
  const openOptions = parseOpenOptions(flags);
  const target = singleTarget(positionals, flags, "inspect");
  const output = outputOf(flags);
  const quiet = flags.quiet === true;

  const session = await createSession(sessionFlags(flags, [target]));
  let page: PageReport;
  try {
    progress(`inspecting ${target.name} …`, { quiet });
    const opened = await openPage(
      session,
      target.url,
      openOptions,
      target.fileApproved,
      isAuthenticated(flags),
    );
    const snapshot = await nativeSnapshot(session, {
      ...(rules ? { rules } : {}),
      includeGeneric: flags["include-generic"] === true,
    });
    page = {
      name: target.name,
      url: redactUrl(opened.url),
      findings: fingerprintFindings(target.name, snapshot.findings),
      tree: snapshot.tree,
      outline: snapshot.outline,
    };
  } finally {
    await session.close();
  }

  const content =
    format === "json"
      ? renderJson("inspect", [page])
      : [
          section("Semantic tree", page.tree ?? ""),
          section("Heading outline", page.outline ?? ""),
          renderPretty([page], {
            color: output === undefined && colorEnabled(),
          }),
        ].join("\n");
  writeReport(output, content);

  if (shouldAnnotate(flags)) {
    emitAnnotations([page]);
    appendStepSummary("inspect", [page]);
  }

  return exceedsThreshold(page.findings, failOn) ? EXIT.FINDINGS : EXIT.OK;
};
