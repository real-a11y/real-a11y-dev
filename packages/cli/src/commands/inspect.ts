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
  type FlagValues,
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
import { createSession, nativeSnapshot } from "../session.js";

import {
  ensurePageOpen,
  outputOf,
  pageIdentityOf,
  sessionFlags,
  singleTarget,
  type Target,
} from "./common.js";

function section(title: string, body: string): string {
  return `== ${title} ==\n${body.trim() === "" ? "(empty)" : body}\n`;
}

export async function runInspectOnSession(
  session: import("@real-a11y-dev/browser").BrowserSession,
  positionals: string[],
  flags: FlagValues,
): Promise<number> {
  const rules = parseRules(flags.rules);
  const failOn = parseFailOn(flags["fail-on"], "error");
  const format = parseFormat(flags.format, ["pretty", "json"] as const);
  const target = singleTarget(positionals, flags, "inspect");
  const output = outputOf(flags);
  const quiet = flags.quiet === true;

  progress(`inspecting ${target.name} …`, { quiet });
  const { url: finalUrl } = await ensurePageOpen(session, target, flags);
  const snapshot = await nativeSnapshot(session, {
    ...(rules ? { rules } : {}),
    includeGeneric: flags["include-generic"] === true,
  });
  const page: PageReport = {
    name: target.name,
    // The LANDED url is what gets displayed; identity keys on the requested one
    // through the shared derivation, matching `audit` and `snapshot` — one
    // finding must not carry a different "stable" id per command. No config
    // entry to consult: `inspect` takes a positional URL only, so there is
    // never an explicit id to honour here. Unscoped by `rootSelector` for the
    // same reason as `audit`: whole-document.
    url: redactUrl(finalUrl),
    findings: fingerprintFindings(pageIdentityOf(target), snapshot.findings),
    tree: snapshot.tree,
    outline: snapshot.outline,
  };

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
}

export function validateInspect(
  positionals: readonly string[],
  flags: FlagValues,
): Target {
  const target = singleTarget(positionals, flags, "inspect");
  parseRules(flags.rules);
  parseFailOn(flags["fail-on"], "error");
  parseFormat(flags.format, ["pretty", "json"] as const);
  parseOpenOptions(flags);
  outputOf(flags);
  return target;
}

export const inspectCommand: CommandFn = async (positionals, flags) => {
  const target = validateInspect(positionals, flags);
  const session = await createSession(sessionFlags(flags, [target]));
  try {
    return await runInspectOnSession(session, positionals, flags);
  } finally {
    await session.close();
  }
};
