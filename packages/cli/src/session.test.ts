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

// A failed navigation used to get one hint for every cause: "is the server
// running? Try --wait-until …". That is timeout advice, and it sent people to
// tune timeouts when the real answer was a typo'd hostname or a port Chrome
// refuses (both hit during CLI dogfooding).
describe("openPage — navigation hints name the failure", () => {
  async function hintFor(message: string): Promise<string | undefined> {
    const session = fakeSessionThatThrows(message);
    const err = await openPage(session, "https://example.com", {}, false).then(
      () => {
        throw new Error("expected the call to reject, but it resolved");
      },
      (e: unknown) => e as CliError,
    );
    expect(err).toBeInstanceOf(CliError);
    return err.hint;
  }

  it.each([
    [
      "DNS",
      "page.goto: net::ERR_NAME_NOT_RESOLVED at https://no-such-host.invalid/",
      /hostname does not resolve/,
    ],
    [
      "unsafe port",
      "page.goto: net::ERR_UNSAFE_PORT at http://127.0.0.1:1/",
      /refuses to connect on this port/,
    ],
    [
      "connection refused",
      "page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:4000/",
      /nothing is listening there/,
    ],
    [
      "offline",
      "page.goto: net::ERR_INTERNET_DISCONNECTED at https://example.com/",
      /network is unreachable/,
    ],
    [
      "TLS",
      "page.goto: net::ERR_CERT_AUTHORITY_INVALID at https://self-signed.example/",
      /TLS certificate was rejected/,
    ],
    [
      "redirect loop",
      "page.goto: net::ERR_TOO_MANY_REDIRECTS at https://example.com/app",
      /redirects in a loop/,
    ],
    [
      "reset",
      "page.goto: net::ERR_EMPTY_RESPONSE at http://localhost:8443/",
      /closed the connection without answering/,
    ],
  ])(
    "names a %s failure instead of talking about timeouts",
    async (_label, message, expected) => {
      const hint = await hintFor(message);
      expect(hint).toMatch(expected);
      expect(hint).not.toMatch(/--wait-until/);
    },
  );

  it("keeps the wait-until hint for a genuine timeout", async () => {
    expect(
      await hintFor(
        'page.goto: Timeout 30000ms exceeded.\n=========================== logs ===========================\nnavigating to "http://localhost:3000/", waiting until "load"',
      ),
    ).toMatch(/--wait-until domcontentloaded or --timeout 60000/);
  });

  it("keeps the wait-until hint for an unrecognised failure", async () => {
    expect(await hintFor("page.goto: something new went wrong")).toMatch(
      /is the server running\?/,
    );
  });
});
