import { describe, expect, it } from "vitest";

import { CliError } from "../exit.js";

import { sessionCommand } from "./session.js";

/**
 * The inapplicable-flag rejections throw before any daemon is contacted, so
 * these tests never spawn or probe a session.
 */
describe("session subcommand flag scoping", () => {
  it("rejects --format on `session stop`", async () => {
    await expect(
      sessionCommand(["stop", "x"], { format: "json" }),
    ).rejects.toThrow(/--format applies to `session list`, not `session stop`/);
  });

  it("rejects --output on `session stop`", async () => {
    await expect(
      sessionCommand(["stop", "x"], { output: "report.json" }),
    ).rejects.toThrow(/--output applies to `session list`, not `session stop`/);
  });

  it("rejects --strict on `session stop`", async () => {
    await expect(
      sessionCommand(["stop", "x"], { strict: true }),
    ).rejects.toThrow(
      /--strict applies to `session stop-all`, not `session stop`/,
    );
  });

  it("rejects --strict on `session list`", async () => {
    await expect(sessionCommand(["list"], { strict: true })).rejects.toThrow(
      /--strict applies to `session stop-all`, not `session list`/,
    );
  });

  it("rejects --format on `session stop-all`", async () => {
    await expect(
      sessionCommand(["stop-all"], { format: "json" }),
    ).rejects.toThrow(
      /--format applies to `session list`, not `session stop-all`/,
    );
  });

  it("rejects with a CliError, not a generic failure", async () => {
    await expect(
      sessionCommand(["stop", "x"], { format: "json" }),
    ).rejects.toBeInstanceOf(CliError);
  });
});
