/**
 * `real-a11y timeline start|stop` — record what a keyboard and screen-reader
 * user meets between two commands on a `--session`: where focus goes, and
 * what live regions announce, in the order the page made them.
 *
 * The second DOM holdout after `tabs` (ADR-0002): that order exists only in
 * the page, so the recorder runs there, injected only while a timeline
 * records (`BrowserSession.startTimeline`). Each run of events leaves the
 * page as it settles, so when a navigation replaces the document, and the
 * recorder with it, what came before is kept, and `stop` says so. No
 * producer header, since the ADR fixes the producer.
 *
 * The recording lives in the session's daemon between the two commands, so
 * both need `--session`.
 */

import type { BrowserSession, PageTimeline } from "@real-a11y-dev/browser";
import type { TimelineEvent } from "@real-a11y-dev/core";
import { redactString, serializeTimeline } from "@real-a11y-dev/serialize";
import { redactUrl, sanitizeText } from "@real-a11y-dev/snapshot";

import {
  inputPolicy,
  parseFormat,
  parseOpenOptions,
  type CommandFn,
  type FlagValues,
} from "../args.js";
import { resolveConfig } from "../config.js";
import { CliError, EXIT } from "../exit.js";
import { progress, writeReport } from "../output.js";
import { renderJson, type PageReport } from "../render/json.js";

import { ensurePageOpen, outputOf, rootOf, singleTarget } from "./common.js";

const USAGE = "usage: real-a11y timeline <start <url>|stop> --session <name>";

/** A recording, and what it was started with, per daemon session. */
interface Held {
  timeline: PageTimeline;
  /** Strict mode reached the recorder: the focus names are strict ones. */
  strict: boolean;
  root: string;
}

// Keyed by the daemon's session object: the recording dies with it.
const recordings = new WeakMap<BrowserSession, Held>();

type Subcommand = "start" | "stop";

function subcommandOf(positionals: readonly string[]): Subcommand {
  const sub = positionals[0];
  if (sub === "start" || sub === "stop") return sub;
  throw new CliError(
    sub === undefined || sub === ""
      ? "no timeline subcommand given"
      : `unknown timeline subcommand "${sub}"`,
    USAGE,
  );
}

/** Fail fast on a malformed invocation, before a daemon or browser starts. */
export function validateTimeline(
  positionals: readonly string[],
  flags: FlagValues,
): void {
  const sub = subcommandOf(positionals);
  if (sub === "start") {
    singleTarget(positionals.slice(1), flags, "timeline start");
    parseOpenOptions(flags);
    return;
  }
  if (positionals.length > 1) {
    throw new CliError(
      "timeline stop takes no URL — it reads the session's page as it is",
      "usage: real-a11y timeline stop --session <name>",
    );
  }
  parseFormat(flags.format, ["pretty", "json"] as const);
  outputOf(flags);
}

/** The page targets the daemon builds its session flags from: the start
 *  URL, and none for `stop`, which never navigates. */
export function timelineTargets(
  positionals: readonly string[],
  flags: FlagValues,
) {
  return subcommandOf(positionals) === "start"
    ? [singleTarget(positionals.slice(1), flags, "timeline start")]
    : [];
}

/** A one-shot run has no daemon to hold the recording between commands. */
export const timelineCommand: CommandFn = async (positionals) => {
  subcommandOf(positionals);
  throw new CliError(
    "timeline needs --session — the recording lives in the session's page between commands",
    "real-a11y timeline start <url> --session <name>, act with --session <name>, then real-a11y timeline stop --session <name>",
  );
};

export async function runTimelineOnSession(
  session: BrowserSession,
  positionals: string[],
  flags: FlagValues,
): Promise<number> {
  validateTimeline(positionals, flags);
  return subcommandOf(positionals) === "start"
    ? startOnSession(session, positionals.slice(1), flags)
    : stopOnSession(session, flags);
}

/** The page's own refusal of `--root`, as a CLI error, or `undefined` for
 *  anything else. Playwright wraps it in its own prefix and stack. */
function rootError(err: unknown): CliError | undefined {
  const message = err instanceof Error ? err.message : String(err);
  const match =
    /(Invalid root selector: "[^\n]*"\.|root selector "[^\n]*" matched no element on the page\.)/.exec(
      message,
    );
  return match
    ? new CliError(
        sanitizeText(match[1].replace(/root selector/i, "--root"), {
          singleLine: true,
        }),
        "pass a CSS selector that matches an element on the page",
      )
    : undefined;
}

/** The session's name as typed, for the hints that name the next command. */
function sessionName(flags: FlagValues): string {
  return typeof flags.session === "string" && flags.session !== ""
    ? sanitizeText(flags.session, { singleLine: true })
    : "<name>";
}

async function startOnSession(
  session: BrowserSession,
  positionals: string[],
  flags: FlagValues,
): Promise<number> {
  const quiet = flags.quiet === true;
  const held = recordings.get(session);
  if (held) {
    const ended = held.timeline.ended();
    throw new CliError(
      ended === null
        ? "a timeline is already recording on this session"
        : `the last timeline on this session ended when the page ${ended === "navigated" ? "navigated" : "closed"}, and hasn't been read yet`,
      `read it first: real-a11y timeline stop --session ${sessionName(flags)}`,
    );
  }
  const target = singleTarget(positionals, flags, "timeline start");
  progress(`opening ${target.name} …`, { quiet });
  const { url } = await ensurePageOpen(session, target, flags);
  const root = rootOf(flags);
  const strict = inputPolicy(flags).redactInput;
  const timeline = await session
    .startTimeline({ root, redactInput: strict })
    .catch((err: unknown) => {
      throw rootError(err) ?? err;
    });
  recordings.set(session, { timeline, strict, root });
  progress(
    `recording a timeline on ${redactUrl(url)} (root: ${root}) — stop it with: real-a11y timeline stop --session ${sessionName(flags)}`,
    { quiet },
  );
  return EXIT.OK;
}

/** The `redact` patterns of the run's a11y.config.json, if any. */
function configRedact(flags: FlagValues): RegExp[] | undefined {
  const patterns = resolveConfig(flags)?.config.redact;
  return patterns?.length
    ? patterns.map((pattern) => new RegExp(pattern, "g"))
    : undefined;
}

/** `text` redacted with the user's patterns, then made safe for a
 *  terminal or a report: it comes from the audited page. */
function clean(text: string, redact: RegExp[] | undefined): string {
  return sanitizeText(redactString(text, redact), { singleLine: true });
}

/** `record` with each key made safe to print and each string value
 *  cleaned; other values as they are. */
function cleanValues<T extends object>(
  record: T,
  redact: RegExp[] | undefined,
): T {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      // The key too: what crosses from the page is the page's to write.
      clean(key, undefined),
      typeof value === "string" ? clean(value, redact) : value,
    ]),
  ) as T;
}

/**
 * `event` as `--format json` hands it out: the user's `redact` patterns
 * applied to the text a line would carry (a name, a description, a state's
 * value, what a region said), since the events carry text from before
 * redaction, and every string made safe to print. A role is vocabulary, not
 * page text, and a line never redacts it, so neither does this.
 */
function cleanEvent(
  event: TimelineEvent,
  redact: RegExp[] | undefined,
): TimelineEvent {
  if (event.kind === "announce") {
    return {
      ...event,
      role: clean(event.role, undefined),
      text: clean(event.text, redact),
    };
  }
  if (!event.stop) return event;
  return {
    ...event,
    stop: {
      ...event.stop,
      role: clean(event.stop.role, undefined),
      name: clean(event.stop.name, redact),
      description: clean(event.stop.description, redact),
      states: cleanValues(event.stop.states, redact),
      properties: cleanValues(event.stop.properties, redact),
    },
  };
}

/** The line that says a navigation ended the recording. */
function navigationNote(url: string): string {
  return `(a navigation ended the recording: the page moved to ${url}, and the lines above came before it)`;
}

async function stopOnSession(
  session: BrowserSession,
  flags: FlagValues,
): Promise<number> {
  const format = parseFormat(flags.format, ["pretty", "json"] as const);
  const held = recordings.get(session);
  if (!held) {
    throw new CliError(
      "no timeline is recording on this session",
      `start one: real-a11y timeline start <url> --session ${sessionName(flags)}`,
    );
  }
  // Strict mode is the recorder's to apply: a focus name is built in the
  // page. A stop asked for strict output of a recording that wasn't strict
  // has nothing it can honestly print, so it prints nothing.
  if (inputPolicy(flags).redactInput && !held.strict) {
    // Kept: the recording is still there for a `stop` that asks for what it
    // holds, and nothing of it has left the page's events yet.
    throw new CliError(
      "--redact-input was not set when this timeline started, so its lines may carry typed text — nothing was printed",
      "pass --redact-input to timeline start as well, or stop it without --redact-input",
    );
  }
  // Stopped, a timeline returns the same result again, so the recording is
  // let go only once its report is written: a write that fails (an
  // unwritable --output) leaves it for a retried `stop`.
  const result = await held.timeline.stop().catch((err: unknown) => {
    // A stop that failed keeps failing (the timeline holds its result), so
    // the recording is let go: holding it would block every later `start`.
    recordings.delete(session);
    throw err;
  });
  const redact = configRedact(flags);
  const lines = sanitizeText(serializeTimeline(result.events, { redact }));
  const navigated = result.end === "navigated";
  // The config's `redact` patterns cover URLs as well as text.
  const url = redactString(
    redactUrl(
      (navigated ? result.url : undefined) ?? session.currentUrl() ?? "",
    ),
    redact,
  );
  const notes = [
    ...(navigated ? [navigationNote(url)] : []),
    ...(result.end === "closed"
      ? ["(the page closed, which ended the recording)"]
      : []),
    ...(result.truncated
      ? ["(the recording kept its first 10000 events and dropped the rest)"]
      : []),
  ];

  if (format === "json") {
    const page: PageReport = {
      name: url,
      url,
      findings: [],
      timeline: lines,
      events: result.events.map((event) => cleanEvent(event, redact)),
      navigated,
      end: result.end,
      ...(result.truncated ? { truncated: true } : {}),
    };
    writeReport(outputOf(flags), renderJson("timeline", [page]));
  } else {
    writeReport(outputOf(flags), [lines, ...notes].join("\n") + "\n");
  }
  recordings.delete(session);
  return EXIT.OK;
}
