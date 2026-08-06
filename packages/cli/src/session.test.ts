import type { BrowserSession } from "@real-a11y-dev/browser";
import { describe, expect, it } from "vitest";

import { CliError } from "./exit.js";
import { openPage } from "./session.js";

function fakeSessionThatThrows(message: string): BrowserSession {
  return {
    open: async () => {
      throw new Error(message);
    },
  } as unknown as BrowserSession;
}

describe("openPage — error catalog", () => {
  it("maps a missing browser to a real-a11y install hint", async () => {
    const session = fakeSessionThatThrows(
      "browserType.launch: Executable doesn't exist at /some/path",
    );
    const err = await openPage(session, "https://example.com", {}, false).then(
      () => {
        // `.catch` alone types this `ResolvedValue | CliError`, so the old
        // `const err: CliError` annotation was false on the success path — and
        // reported it as "expected {…} to be an instance of CliError", which
        // names the wrong problem. Rejecting here says what actually went
        // wrong and leaves the variable genuinely a CliError.
        throw new Error("expected the call to reject, but it resolved");
      },
      (e: unknown) => e as CliError,
    );
    expect(err).toBeInstanceOf(CliError);
    expect(err.message).toBe("No browser is downloaded yet.");
    expect(err.hint).toMatch(/real-a11y install/);
  });

  it("maps a shared-library load failure to an install-deps hint", async () => {
    const session = fakeSessionThatThrows(
      "error while loading shared libraries: libnss3.so: cannot open shared object file",
    );
    const err = await openPage(session, "https://example.com", {}, false).then(
      () => {
        // `.catch` alone types this `ResolvedValue | CliError`, so the old
        // `const err: CliError` annotation was false on the success path — and
        // reported it as "expected {…} to be an instance of CliError", which
        // names the wrong problem. Rejecting here says what actually went
        // wrong and leaves the variable genuinely a CliError.
        throw new Error("expected the call to reject, but it resolved");
      },
      (e: unknown) => e as CliError,
    );
    expect(err).toBeInstanceOf(CliError);
    expect(err.hint).toMatch(/install-deps/);
  });

  it("maps a broken configured binary to a --force reinstall hint", async () => {
    const session = fakeSessionThatThrows("Failed to launch chrome!");
    const err = await openPage(session, "https://example.com", {}, false).then(
      () => {
        // `.catch` alone types this `ResolvedValue | CliError`, so the old
        // `const err: CliError` annotation was false on the success path — and
        // reported it as "expected {…} to be an instance of CliError", which
        // names the wrong problem. Rejecting here says what actually went
        // wrong and leaves the variable genuinely a CliError.
        throw new Error("expected the call to reject, but it resolved");
      },
      (e: unknown) => e as CliError,
    );
    expect(err).toBeInstanceOf(CliError);
    expect(err.hint).toMatch(/install --force/);
  });
});
