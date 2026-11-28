// `timeline start|stop` over a fake session: what each subcommand accepts,
// and what `stop` prints from the events the recorder handed out. The real
// browser path is `e2e/timeline.e2e.test.ts`.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  BrowserSession,
  PageTimeline,
  PageTimelineOptions,
  PageTimelineResult,
} from "@real-a11y-dev/browser";
import { afterEach, describe, expect, it, vi } from "vitest";

import { clearConfigCache } from "../config.js";
import { CliError } from "../exit.js";

import {
  runTimelineOnSession,
  timelineCommand,
  timelineTargets,
  validateTimeline,
} from "./timeline.js";

const URL = "https://example.test/drafts";
const FOCUS = {
  kind: "focus",
  stop: {
    role: "button",
    name: "Draft 12",
    description: "",
    states: {},
    properties: {},
    isExposedToAT: true,
  },
  hidden: false,
} as const;
const ANNOUNCE = {
  kind: "announce",
  role: "status",
  text: "Draft 12 deleted.\u001b]0;pwned\u0007",
  live: "polite",
} as const;

/** A session whose page is already on `URL`, and whose timeline stops
 *  with `result`. */
function fakeSession(
  result: Partial<PageTimelineResult> = {},
  ended: ReturnType<PageTimeline["ended"]> = null,
) {
  const started: PageTimelineOptions[] = [];
  const session = {
    currentUrl: () => URL,
    currentEmulationKey: () => "",
    assertAllowedOrigin: () => {},
    open: vi.fn(async () => ({ title: "", url: URL })),
    startTimeline: vi.fn(async (options: PageTimelineOptions) => {
      started.push(options);
      const timeline: PageTimeline = {
        events: () => [],
        ended: () => ended,
        stop: async () => ({
          events: [FOCUS, ANNOUNCE],
          end: "stopped",
          truncated: false,
          ...result,
        }),
      };
      return timeline;
    }),
  };
  return { session: session as unknown as BrowserSession, started };
}

function captureStdout() {
  const chunks: string[] = [];
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    });
  return { text: () => chunks.join(""), restore: () => spy.mockRestore() };
}

afterEach(() => {
  vi.restoreAllMocks();
  clearConfigCache();
});

const flags = { session: "s", quiet: true, "no-config": true };

describe("validateTimeline", () => {
  it("takes a URL on start and none on stop", () => {
    expect(() => validateTimeline(["start", URL], flags)).not.toThrow();
    expect(() => validateTimeline(["stop"], flags)).not.toThrow();
    expect(() => validateTimeline(["start"], flags)).toThrow(
      /takes exactly one URL/,
    );
    expect(() => validateTimeline(["stop", URL], flags)).toThrow(
      /takes no URL/,
    );
  });

  it("names the subcommands it knows", () => {
    expect(() => validateTimeline([], flags)).toThrow(/no timeline subcommand/);
    expect(() => validateTimeline(["pause"], flags)).toThrow(
      /unknown timeline subcommand "pause"/,
    );
  });

  it("builds session flags from the start URL, and none for stop", () => {
    expect(timelineTargets(["start", URL], flags)).toHaveLength(1);
    expect(timelineTargets(["stop"], flags)).toEqual([]);
  });

  it("needs --session to run at all", async () => {
    await expect(timelineCommand(["start", URL], {})).rejects.toThrow(
      /timeline needs --session/,
    );
  });
});

describe("runTimelineOnSession", () => {
  it("starts on --root with strict mode as asked, and prints nothing", async () => {
    const { session, started } = fakeSession();
    const out = captureStdout();
    try {
      await runTimelineOnSession(session, ["start", URL], {
        ...flags,
        root: "main",
        "redact-input": true,
      });
    } finally {
      out.restore();
    }
    expect(started).toEqual([{ root: "main", redactInput: true }]);
    expect(out.text()).toBe("");
    await runTimelineOnSession(session, ["stop"], {
      ...flags,
      "redact-input": true,
    }).catch(() => {});
  });

  it("refuses a second start on the session until it stops", async () => {
    const { session } = fakeSession();
    await runTimelineOnSession(session, ["start", URL], flags);
    await expect(
      runTimelineOnSession(session, ["start", URL], flags),
    ).rejects.toThrow(/already recording/);
    const out = captureStdout();
    try {
      await runTimelineOnSession(session, ["stop"], flags);
    } finally {
      out.restore();
    }
    await expect(
      runTimelineOnSession(session, ["stop"], flags),
    ).rejects.toThrow(/no timeline is recording/);
  });

  it("prints the lines, made safe for a terminal, with no producer header", async () => {
    const { session } = fakeSession();
    await runTimelineOnSession(session, ["start", URL], flags);
    const out = captureStdout();
    try {
      await runTimelineOnSession(session, ["stop"], flags);
    } finally {
      out.restore();
    }
    expect(out.text()).toBe(
      'focus     button "Draft 12"\n' +
        'announce  status "Draft 12 deleted.\\u{1B}]0;pwned\\u{7}"\n',
    );
  });

  it("says when a navigation ended the recording", async () => {
    const { session } = fakeSession({
      end: "navigated",
      url: "https://example.test/next?token=abc",
    });
    await runTimelineOnSession(session, ["start", URL], flags);
    const out = captureStdout();
    try {
      await runTimelineOnSession(session, ["stop"], flags);
    } finally {
      out.restore();
    }
    const last = out.text().trimEnd().split("\n").at(-1);
    expect(last).toMatch(
      /^\(a navigation ended the recording: the page moved to https:\/\/example\.test\/next/,
    );
    // The landed URL is redacted like every other URL the CLI prints.
    expect(last).not.toContain("abc");
  });

  it("applies the config's redact patterns to the lines and to every JSON event", async () => {
    const dir = mkdtempSync(join(tmpdir(), "real-a11y-timeline-unit-"));
    const config = join(dir, "a11y.config.json");
    writeFileSync(config, JSON.stringify({ redact: ["Draft \\d+"] }));
    const { session } = fakeSession();
    const withConfig = { session: "s", quiet: true, config };
    await runTimelineOnSession(session, ["start", URL], withConfig);
    const out = captureStdout();
    try {
      await runTimelineOnSession(session, ["stop"], {
        ...withConfig,
        format: "json",
      });
    } finally {
      out.restore();
    }
    expect(out.text()).not.toContain("Draft 12");
    expect(out.text()).not.toContain("\u001b");
    const page = JSON.parse(out.text()).pages[0];
    expect(page.timeline).toContain('button "[REDACTED]"');
    expect(page.events[0].stop.name).toBe("[REDACTED]");
    expect(page.events[1].text).toBe(
      "[REDACTED] deleted.\\u{1B}]0;pwned\\u{7}",
    );
    expect(page.navigated).toBe(false);
  });

  it("refuses strict output of a recording that wasn't strict, printing nothing", async () => {
    const { session } = fakeSession();
    await runTimelineOnSession(session, ["start", URL], flags);
    const out = captureStdout();
    let err: unknown;
    try {
      await runTimelineOnSession(session, ["stop"], {
        ...flags,
        "redact-input": true,
      });
    } catch (e) {
      err = e;
    } finally {
      out.restore();
    }
    expect(err).toBeInstanceOf(CliError);
    expect(String((err as Error).message)).toMatch(
      /--redact-input was not set/,
    );
    expect(out.text()).toBe("");
    // Kept: a `stop` without the flag still reads it.
    const again = captureStdout();
    try {
      await runTimelineOnSession(session, ["stop"], flags);
    } finally {
      again.restore();
    }
    expect(again.text()).toContain('focus     button "Draft 12"');
  });

  it("says an unread recording ended, rather than that one is recording", async () => {
    const { session } = fakeSession({}, "navigated");
    await runTimelineOnSession(session, ["start", URL], flags);
    await expect(
      runTimelineOnSession(session, ["start", URL], flags),
    ).rejects.toThrow(
      /ended when the page navigated, and hasn't been read yet/,
    );
  });

  it("says in JSON how the recording ended, and never redacts a role", async () => {
    const dir = mkdtempSync(join(tmpdir(), "real-a11y-timeline-unit-"));
    const config = join(dir, "a11y.config.json");
    writeFileSync(config, JSON.stringify({ redact: ["status|button"] }));
    const { session } = fakeSession({ end: "closed" });
    const withConfig = { session: "s", quiet: true, config };
    await runTimelineOnSession(session, ["start", URL], withConfig);
    const out = captureStdout();
    try {
      await runTimelineOnSession(session, ["stop"], {
        ...withConfig,
        format: "json",
      });
    } finally {
      out.restore();
    }
    const page = JSON.parse(out.text()).pages[0];
    expect(page.end).toBe("closed");
    expect(page.navigated).toBe(false);
    expect(page.events[0].stop.role).toBe("button");
    expect(page.events[1].role).toBe("status");
    // As the lines print them: roles as they are.
    expect(page.timeline).toMatch(/^focus {5}button /);
  });

  it("makes a state's key safe to print in JSON, as its value is", async () => {
    const { session } = fakeSession({
      events: [
        {
          ...FOCUS,
          stop: { ...FOCUS.stop, states: { "x\u009bkey": "y\u202Ez" } },
        },
      ],
    });
    await runTimelineOnSession(session, ["start", URL], flags);
    const out = captureStdout();
    try {
      await runTimelineOnSession(session, ["stop"], {
        ...flags,
        format: "json",
      });
    } finally {
      out.restore();
    }
    const { states } = JSON.parse(out.text()).pages[0].events[0].stop;
    expect(states).toEqual({ "x\\u{9B}key": "y\\u{202E}z" });
  });

  it("keeps the recording when its report can't be written, for a retry", async () => {
    const dir = mkdtempSync(join(tmpdir(), "real-a11y-timeline-unit-"));
    // A file where a directory should be: the target passes the up-front
    // check, then the write itself fails.
    writeFileSync(join(dir, "afile"), "");
    const { session } = fakeSession();
    await runTimelineOnSession(session, ["start", URL], flags);
    await expect(
      runTimelineOnSession(session, ["stop"], {
        ...flags,
        output: join(dir, "afile", "out.txt"),
      }),
    ).rejects.toThrow();
    const out = captureStdout();
    try {
      await runTimelineOnSession(session, ["stop"], flags);
    } finally {
      out.restore();
    }
    expect(out.text()).toContain('focus     button "Draft 12"');
  });

  it("applies the config's redact patterns to the landed URL too", async () => {
    const dir = mkdtempSync(join(tmpdir(), "real-a11y-timeline-unit-"));
    const config = join(dir, "a11y.config.json");
    writeFileSync(config, JSON.stringify({ redact: ["acct-\\d+"] }));
    const { session } = fakeSession({
      end: "navigated",
      url: "https://example.test/acct-4242/next",
    });
    const withConfig = { session: "s", quiet: true, config };
    await runTimelineOnSession(session, ["start", URL], withConfig);
    const pretty = captureStdout();
    try {
      await runTimelineOnSession(session, ["stop"], withConfig);
    } finally {
      pretty.restore();
    }
    expect(pretty.text()).not.toContain("4242");
    expect(pretty.text()).toContain("https://example.test/[REDACTED]/next");
  });

  it("turns the page's refusal of --root into a CLI error naming the flag", async () => {
    const { session } = fakeSession();
    vi.mocked(session.startTimeline).mockRejectedValueOnce(
      new Error(
        'page.evaluate: Error: root selector "#nope" matched no element on the page.\n    at start (eval)',
      ),
    );
    await expect(
      runTimelineOnSession(session, ["start", URL], {
        ...flags,
        root: "#nope",
      }),
    ).rejects.toThrow(/^--root "#nope" matched no element on the page\.$/);
  });
});
