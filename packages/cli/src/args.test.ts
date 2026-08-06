import { describe, expect, it } from "vitest";

import {
  COMMANDS,
  parseChannel,
  parseFailOn,
  parseFormat,
  parseListCategory,
  parseOnly,
  parseOpenOptions,
  parseStepSettle,
  DEFAULT_STEP_SETTLE_MS,
  parseRules,
  isNativeCommand,
  nativeCommands,
  rootHelp,
} from "./args.js";
import { CliError } from "./exit.js";

describe("parseRules", () => {
  it("accepts a valid csv subset", () => {
    expect(parseRules("image-alt, heading-order")).toEqual([
      "image-alt",
      "heading-order",
    ]);
  });

  it("returns undefined (= all rules) when omitted", () => {
    expect(parseRules(undefined)).toBeUndefined();
  });

  it("lists every valid rule on an unknown one", () => {
    expect(() => parseRules("imgalt")).toThrow(/no-unlabeled-interactive/);
  });
});

describe("parseFailOn / parseFormat", () => {
  it("applies per-command defaults", () => {
    expect(parseFailOn(undefined, "error")).toBe("error");
    expect(parseFailOn("never", "error")).toBe("never");
    expect(() => parseFailOn("any", "error")).toThrow(CliError);
  });

  it("validates formats against the shipped list", () => {
    expect(parseFormat(undefined, ["pretty", "json"])).toBe("pretty");
    expect(() => parseFormat("sarif", ["pretty", "json"])).toThrow(
      /pretty \| json/,
    );
  });
});

describe("the producer axis is gone", () => {
  it("no command declares --producer", () => {
    // Each surface has exactly one correct producer now, so there is nothing
    // to choose — and a flag that silently did nothing would be worse.
    for (const [name, spec] of Object.entries(COMMANDS)) {
      expect(
        spec.options,
        `${name} still declares --producer`,
      ).not.toHaveProperty("producer");
      expect(spec.help, `${name}'s help still mentions --producer`).not.toMatch(
        /--producer/,
      );
    }
  });

  it("declares --root on `tabs` alone", () => {
    // The one DOM holdout: tab ORDER is layout work the native tree doesn't
    // expose, and a DOM walk is the only thing a selector can scope.
    const withRoot = Object.entries(COMMANDS)
      .filter(([, spec]) => "root" in spec.options)
      .map(([name]) => name);
    expect(withRoot).toEqual(["tabs"]);
  });

  it("derives the native set from the table, so it can't drift", () => {
    // This is what turns a leftover `--root` into an explanation rather than
    // "Unknown option". A hand-written second copy is exactly the drift the
    // surface extraction exists to prevent — so it reads `producers`.
    for (const name of nativeCommands()) {
      expect(COMMANDS, `${name} is not a command`).toHaveProperty(name);
      expect(
        COMMANDS[name].options,
        `${name} declares --root`,
      ).not.toHaveProperty("root");
    }
    expect(isNativeCommand("tabs")).toBe(false);
    expect(isNativeCommand("audit")).toBe(true);
    // An unknown name is not native — the safe direction: it falls through to
    // the parser rather than claiming a scope refusal for a command that
    // doesn't exist.
    expect(isNativeCommand("nope")).toBe(false);
  });

  it("gives every command exactly one producer, or none", () => {
    for (const [name, spec] of Object.entries(COMMANDS)) {
      expect(
        spec.producers.length,
        `${name} declares ${spec.producers.length} producers`,
      ).toBeLessThanOrEqual(1);
    }
    // `tabs` is the lone DOM holdout; nothing else reads the in-page walk.
    const dom = Object.entries(COMMANDS)
      .filter(([, s]) => s.producers.includes("dom"))
      .map(([n]) => n);
    expect(dom).toEqual(["tabs"]);
  });
});

describe("parseOnly", () => {
  it("returns undefined (= full report) when omitted", () => {
    expect(parseOnly(undefined)).toBeUndefined();
  });

  it("accepts the two axes", () => {
    expect(parseOnly("findings")).toBe("findings");
    expect(parseOnly("views")).toBe("views");
  });

  it("rejects anything else, naming the valid values", () => {
    expect(() => parseOnly("a11y-trees")).toThrow(CliError);
    expect(() => parseOnly("a11y-trees")).toThrow(/findings \| views/);
    // A bare `--only` (boolean true from parseArgs) is not a valid axis.
    expect(() => parseOnly(true)).toThrow(CliError);
  });
});

describe("parseOpenOptions", () => {
  it("parses viewport WxH", () => {
    expect(parseOpenOptions({ viewport: "1280x800" }).viewport).toEqual({
      width: 1280,
      height: 800,
    });
    expect(() => parseOpenOptions({ viewport: "big" })).toThrow(/WIDTHxHEIGHT/);
  });

  it("validates wait states", () => {
    expect(parseOpenOptions({ "wait-until": "networkidle" }).waitUntil).toBe(
      "networkidle",
    );
    expect(() => parseOpenOptions({ "wait-until": "ready" })).toThrow(CliError);
  });

  it("clamps settle and timeout to their caps", () => {
    expect(parseOpenOptions({ settle: "99999999" }).settleMs).toBe(30_000);
    expect(parseOpenOptions({ timeout: "999999" }).timeoutMs).toBe(120_000);
    expect(() => parseOpenOptions({ timeout: "-4" })).toThrow(CliError);
  });

  it("rejects empty and zero timeouts — 0 means wait-forever in Playwright", () => {
    expect(() => parseOpenOptions({ timeout: "" })).toThrow(CliError);
    expect(() => parseOpenOptions({ timeout: "  " })).toThrow(CliError);
    expect(() => parseOpenOptions({ timeout: "0" })).toThrow(CliError);
    expect(parseOpenOptions({ settle: "0" }).settleMs).toBe(0);
  });

  it("rejects emulation flags over --cdp", () => {
    expect(() =>
      parseOpenOptions({ cdp: "http://localhost:9222", device: "iPhone 13" }),
    ).toThrow(/--cdp/);
  });

  it("rejects --chrome-path combined with --cdp", () => {
    expect(() =>
      parseOpenOptions({
        cdp: "http://localhost:9222",
        "chrome-path": "/usr/bin/chrome",
      }),
    ).toThrow(/--chrome-path/);
  });

  it("allows --chrome-path without --cdp", () => {
    expect(() =>
      parseOpenOptions({ "chrome-path": "/usr/bin/chrome" }),
    ).not.toThrow();
  });
});

describe("parseListCategory", () => {
  it("accepts the six categories, rejects the rest", () => {
    expect(parseListCategory("landmark")).toBe("landmark");
    expect(() => parseListCategory("widgets")).toThrow(/heading, link/);
    expect(() => parseListCategory(undefined)).toThrow(CliError);
  });
});

describe("parseChannel", () => {
  it("returns undefined when --channel wasn't passed at all", () => {
    expect(parseChannel(undefined)).toBeUndefined();
  });

  it("accepts the four Chrome for Testing channels", () => {
    expect(parseChannel("stable")).toBe("stable");
    expect(parseChannel("beta")).toBe("beta");
    expect(parseChannel("dev")).toBe("dev");
    expect(parseChannel("canary")).toBe("canary");
  });

  it("rejects anything else", () => {
    expect(() => parseChannel("nightly")).toThrow(CliError);
    expect(() => parseChannel("nightly")).toThrow(
      /stable \| beta \| dev \| canary/,
    );
  });
});

describe("COMMANDS.install", () => {
  it("is registered with no positional usage and shows up in root help", () => {
    expect(COMMANDS.install).toBeDefined();
    expect(COMMANDS.install.summary).toMatch(/Chrome for Testing/);
    expect(rootHelp()).toContain("install");
    expect(rootHelp()).not.toMatch(/install <url>/);
  });
});

describe("parseStepSettle", () => {
  it("defaults to the shared debounce when the flag is absent", () => {
    expect(parseStepSettle({})).toBe(DEFAULT_STEP_SETTLE_MS);
    expect(DEFAULT_STEP_SETTLE_MS).toBe(200);
  });

  it("takes an explicit value, including 0 to opt out", () => {
    expect(parseStepSettle({ "step-settle": "750" })).toBe(750);
    // 0 is meaningful, not "unset" — a caller that wants the old immediate
    // read must be able to ask for it.
    expect(parseStepSettle({ "step-settle": "0" })).toBe(0);
  });

  it("caps a runaway value rather than hanging the run", () => {
    expect(parseStepSettle({ "step-settle": "99999999" })).toBe(30_000);
  });

  it("rejects nonsense instead of silently falling back to the default", () => {
    // Silently defaulting would turn a typo into a run that looks fine and
    // waits the wrong amount.
    expect(() => parseStepSettle({ "step-settle": "soon" })).toThrow(CliError);
    expect(() => parseStepSettle({ "step-settle": "-1" })).toThrow(CliError);
    expect(() => parseStepSettle({ "step-settle": "1.5" })).toThrow(CliError);
    // Number("") === 0, so an unset shell var must not read as "no wait".
    expect(() => parseStepSettle({ "step-settle": "" })).toThrow(CliError);
  });
});

describe("FlagValue covers what parseArgs can actually produce", () => {
  it("every multiple:true flag is type string, so the array arm is complete", () => {
    // `FlagValue` carries exactly one array arm — `string[]`. That is only
    // sufficient while every repeatable flag is a string flag: a
    // `{ type: "boolean", multiple: true }` would have parseArgs hand back
    // `boolean[]`, which the union does not admit, and the failure would look
    // exactly like the one this file's `FlagValue` widening fixed — a type
    // quietly narrower than the runtime.
    //
    // Asserted over the declaration space rather than the flags that happen to
    // be repeatable today, because the original bug survived precisely by being
    // checked against known cases instead of against what the parser can emit.
    const repeatable: string[] = [];
    for (const [command, spec] of Object.entries(COMMANDS)) {
      for (const [flag, opt] of Object.entries(spec.options)) {
        if (opt?.multiple !== true) continue;
        repeatable.push(`${command} --${flag}`);
        expect(opt.type, `${command} --${flag} is repeatable`).toBe("string");
      }
    }
    // Guard the guard: if the options tables stop being reachable this way, the
    // loop above would pass by iterating nothing.
    expect(repeatable.length).toBeGreaterThan(0);
  });
});
