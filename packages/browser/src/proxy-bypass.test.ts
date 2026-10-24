import { describe, expect, it } from "vitest";

import { loopbackSafeBypass, withLoopbackBypass } from "./proxy-bypass.js";

// What Chromium's implicit rules cover, given back after `<-loopback>`.
const IMPLICIT =
  "localhost,*.localhost,127.0.0.1/8,[::1],169.254.0.0/16,fe80::/10";

describe("loopbackSafeBypass", () => {
  it("leads a list naming loopback with <-loopback> and the implicit rules", () => {
    // Up to Playwright 1.58.2, a list without `<-loopback>` got one appended,
    // and that later rule sent localhost to the proxy whatever the list said.
    expect(loopbackSafeBypass("localhost")).toBe(
      `<-loopback>,${IMPLICIT},localhost`,
    );
    expect(loopbackSafeBypass(".corp.example, 127.0.0.1")).toBe(
      `<-loopback>,${IMPLICIT},.corp.example, 127.0.0.1`,
    );
  });

  it.each([
    "LOCALHOST",
    ".localhost",
    "*.localhost",
    "127.0.0.0/8",
    "127.1.2.3",
    "::1",
    "::1/128",
    "[::1]",
    "[::]",
    "<loopback>",
  ])("counts %s as naming loopback", (entry) => {
    expect(loopbackSafeBypass(entry)).toBe(`<-loopback>,${IMPLICIT},${entry}`);
  });

  it("treats * as naming loopback, since it bypasses every host", () => {
    // Playwright doesn't count `*`, so this differs on every version: before,
    // a list bypassing every host still sent loopback to the proxy.
    expect(loopbackSafeBypass("*")).toBe(`<-loopback>,${IMPLICIT},*`);
  });

  it("returns a list naming no loopback host as it is", () => {
    // Every Playwright sends loopback through the proxy here, so they agree.
    expect(loopbackSafeBypass(".corp.example,intranet")).toBe(
      ".corp.example,intranet",
    );
    // A port makes it a narrower rule, as it does to Playwright, and 128/8 is
    // not loopback.
    expect(loopbackSafeBypass("localhost:3000")).toBe("localhost:3000");
    expect(loopbackSafeBypass("128.0.0.1")).toBe("128.0.0.1");
  });

  it("returns a list that already holds <-loopback> as it is", () => {
    // Asking for loopback through the proxy is honoured, as Playwright does.
    expect(loopbackSafeBypass("<-loopback>,localhost")).toBe(
      "<-loopback>,localhost",
    );
  });

  it("has nothing to add to an empty list", () => {
    expect(loopbackSafeBypass(undefined)).toBeUndefined();
    expect(loopbackSafeBypass("")).toBe("");
  });
});

describe("withLoopbackBypass", () => {
  it("rewrites only the bypass list, keeping the server and credentials", () => {
    expect(
      withLoopbackBypass({
        server: "http://proxy.corp.example:3128",
        username: "u",
        password: "p",
        bypass: "localhost",
      }),
    ).toEqual({
      server: "http://proxy.corp.example:3128",
      username: "u",
      password: "p",
      bypass: `<-loopback>,${IMPLICIT},localhost`,
    });
  });

  it("returns the same proxy when there is nothing to change", () => {
    const proxy = { server: "http://proxy.corp.example:3128" };
    expect(withLoopbackBypass(proxy)).toBe(proxy);
  });
});
