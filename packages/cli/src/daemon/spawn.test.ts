import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CliError } from "../exit.js";

const mocks = vi.hoisted(() => ({
  version: vi.fn(),
  readPidfile: vi.fn(),
  isProcessAlive: vi.fn(),
  stopDaemonProcess: vi.fn(),
}));

vi.mock("./client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client.js")>();
  class FakeDaemonClient {
    version = mocks.version;
    quit = vi.fn();
  }
  return { ...actual, DaemonClient: FakeDaemonClient };
});
vi.mock("./pidfile.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./pidfile.js")>();
  return {
    ...actual,
    readPidfile: mocks.readPidfile,
    isProcessAlive: mocks.isProcessAlive,
  };
});
vi.mock("./stop-process.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./stop-process.js")>();
  return { ...actual, stopDaemonProcess: mocks.stopDaemonProcess };
});

import { ensureDaemonClient } from "./spawn.js";

// Characterizes how ensureDaemonClient treats a live daemon it cannot reuse:
// every route that finds a live pidfile process must stop it, and refuse to go
// on when it will not exit.
describe("ensureDaemonClient replacing an existing daemon", () => {
  let home: string;
  let prevHome: string | undefined;
  let prevProfile: string | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "real-a11y-spawn-"));
    prevHome = process.env["HOME"];
    prevProfile = process.env["USERPROFILE"];
    process.env["HOME"] = home;
    process.env["USERPROFILE"] = home; // os.homedir() on Windows
    vi.clearAllMocks();
    mocks.readPidfile.mockResolvedValue({ pid: 4242, startedAt: "t0" });
    mocks.isProcessAlive.mockReturnValue(true);
    mocks.stopDaemonProcess.mockResolvedValue(false);
  });

  afterEach(async () => {
    if (prevHome === undefined) delete process.env["HOME"];
    else process.env["HOME"] = prevHome;
    if (prevProfile === undefined) delete process.env["USERPROFILE"];
    else process.env["USERPROFILE"] = prevProfile;
    await rm(home, { recursive: true, force: true });
  });

  const unstoppable = {
    name: "CliError",
    message: 'existing daemon process for session "scout" could not be stopped',
  };

  it("refuses when a failed handshake's live daemon will not exit", async () => {
    mocks.version.mockRejectedValue(new Error("bad auth"));
    const err = await ensureDaemonClient("scout", "/nope").catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err).toMatchObject(unstoppable);
    expect(mocks.stopDaemonProcess).toHaveBeenCalledTimes(1);
  });

  it("rethrows the handshake error when there is no live pidfile process", async () => {
    const boom = new Error("bad auth");
    mocks.version.mockRejectedValue(boom);
    mocks.readPidfile.mockResolvedValue(undefined);
    await expect(ensureDaemonClient("scout", "/nope")).rejects.toBe(boom);
    expect(mocks.stopDaemonProcess).not.toHaveBeenCalled();
  });

  it("refuses when a version-mismatched daemon will not exit", async () => {
    mocks.version.mockResolvedValue({ version: "0.0.0-ancient" });
    const err = await ensureDaemonClient("scout", "/nope").catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err).toMatchObject(unstoppable);
    expect(mocks.stopDaemonProcess).toHaveBeenCalledTimes(1);
  });

  it("refuses when a stale-socket pidfile process will not exit", async () => {
    const stale = Object.assign(new Error("connect ENOENT"), {
      code: "ENOENT",
    });
    mocks.version.mockRejectedValue(stale);
    const err = await ensureDaemonClient("scout", "/nope").catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err).toMatchObject(unstoppable);
    expect(mocks.stopDaemonProcess).toHaveBeenCalledTimes(1);
  });
});
