import type { BrowserSession } from "@real-a11y-dev/browser";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CliError } from "./exit.js";
import { installCommand } from "./playwright-resolve.js";
import {
  createSession,
  loopbackSafeBypass,
  openPage,
  proxyFromEnv,
} from "./session.js";

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
    // The install command for this layout, never the unscoped
    // `npx real-a11y` outside a project, nor `npx playwright install
    // chromium`, which fetches some other Playwright's revision.
    expect(err.hint).toBe(
      `${installCommand()}  (CI on Linux may also need: npx playwright install-deps chromium)`,
    );
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
    expect(err.hint).toContain(`re-run: ${installCommand()} --force`);
  });

  it("names this layout's install command for a --chrome-path that isn't there", async () => {
    const err = await createSession({
      chromePath: "/definitely/not/a/chrome",
    }).then(
      () => {
        throw new Error("expected the call to reject, but it resolved");
      },
      (e: unknown) => e as CliError,
    );
    expect(err).toBeInstanceOf(CliError);
    expect(err.hint).toBe(
      `re-run: ${installCommand()} — or fix/unset --chrome-path / REAL_A11Y_CHROME_PATH.`,
    );
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

  it("names the proxy's env vars for a proxy failure, not a --proxy flag", async () => {
    // There is no --proxy flag: the proxy comes from HTTPS_PROXY and NO_PROXY.
    const hint = await hintFor(
      "page.goto: net::ERR_PROXY_CONNECTION_FAILED at http://localhost:8712/",
    );
    expect(hint).toMatch(/HTTPS_PROXY/);
    expect(hint).toMatch(/NO_PROXY/);
    expect(hint).not.toMatch(/--proxy/);
  });

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

it("ignores a full net::ERR_ token echoed back from the URL itself", async () => {
  const session = fakeSessionThatThrows(
    "page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/search?q=net::ERR_NAME_NOT_RESOLVED",
  );
  const err = await openPage(session, "http://localhost:3000/", {}, false).then(
    () => {
      throw new Error("expected the call to reject, but it resolved");
    },
    (e: unknown) => e as CliError,
  );
  expect(err.hint).toMatch(/nothing is listening there/);
});

it("ignores an ERR_ token echoed back from the URL itself", async () => {
  const session = fakeSessionThatThrows(
    "page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/search?q=ERR_NAME_NOT_RESOLVED",
  );
  const err = await openPage(session, "http://localhost:3000/", {}, false).then(
    () => {
      throw new Error("expected the call to reject, but it resolved");
    },
    (e: unknown) => e as CliError,
  );
  expect(err.hint).toMatch(/nothing is listening there/);
});

describe("loopbackSafeBypass", () => {
  // What Chromium's implicit rules cover, given back after `<-loopback>`.
  const IMPLICIT =
    "localhost,*.localhost,127.0.0.1/8,[::1],169.254.0.0/16,fe80::/10";

  it("leads a list naming loopback with <-loopback> and the implicit rules", () => {
    // Up to Playwright 1.58.2, a list without `<-loopback>` got one appended,
    // and that later rule sent localhost to the proxy whatever NO_PROXY said.
    expect(loopbackSafeBypass("localhost")).toBe(
      `<-loopback>,${IMPLICIT},localhost`,
    );
    expect(loopbackSafeBypass(".corp.example, 127.0.0.1")).toBe(
      `<-loopback>,${IMPLICIT},.corp.example, 127.0.0.1`,
    );
    expect(loopbackSafeBypass("[::1]")).toBe(`<-loopback>,${IMPLICIT},[::1]`);
  });

  it("treats * as naming loopback, since it bypasses every host", () => {
    // Playwright doesn't count `*`, so this differs on every version: before,
    // a list bypassing every host still sent loopback to the proxy.
    expect(loopbackSafeBypass("*")).toBe(`<-loopback>,${IMPLICIT},*`);
  });

  it("passes a list naming no loopback host on as it is", () => {
    // Every Playwright sends loopback through the proxy here, so they agree.
    expect(loopbackSafeBypass(".corp.example,intranet")).toBe(
      ".corp.example,intranet",
    );
    // A port makes it a different rule, as it does to Playwright.
    expect(loopbackSafeBypass("localhost:3000")).toBe("localhost:3000");
  });

  it("passes a list that already holds <-loopback> on as it is", () => {
    // Asking for loopback through the proxy is honoured, as Playwright does.
    expect(loopbackSafeBypass("<-loopback>,localhost")).toBe(
      "<-loopback>,localhost",
    );
  });

  it("has nothing to add without a NO_PROXY", () => {
    expect(loopbackSafeBypass(undefined)).toBeUndefined();
    expect(loopbackSafeBypass("")).toBe("");
  });
});

describe("proxyFromEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Every proxy variable unset, then the given ones set. Unset rather than
  // empty, since an empty value is not nullish and would hide the lowercase
  // spelling behind it; and all unset first, since Windows treats the two
  // spellings as one variable, so unsetting `https_proxy` after setting
  // `HTTPS_PROXY` would undo it.
  function stubProxyEnv(env: Record<string, string>): void {
    for (const name of [
      "HTTPS_PROXY",
      "https_proxy",
      "HTTP_PROXY",
      "http_proxy",
      "NO_PROXY",
      "no_proxy",
    ]) {
      vi.stubEnv(name, undefined);
    }
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  }

  it("keeps loopback named in NO_PROXY off the proxy", () => {
    stubProxyEnv({
      HTTPS_PROXY: "http://user:p%40ss@proxy.corp.example:3128",
      NO_PROXY: "localhost,.corp.example",
    });
    expect(proxyFromEnv()).toEqual({
      server: "http://proxy.corp.example:3128",
      username: "user",
      password: "p@ss",
      bypass: loopbackSafeBypass("localhost,.corp.example"),
    });
  });

  it("passes a NO_PROXY naming no loopback host on unchanged", () => {
    stubProxyEnv({
      HTTPS_PROXY: "http://proxy.corp.example:3128",
      no_proxy: ".corp.example",
    });
    expect(proxyFromEnv()).toEqual({
      server: "http://proxy.corp.example:3128",
      bypass: ".corp.example",
    });
  });

  it("returns nothing without a proxy in the environment", () => {
    stubProxyEnv({ NO_PROXY: "localhost" });
    expect(proxyFromEnv()).toBeUndefined();
  });
});
