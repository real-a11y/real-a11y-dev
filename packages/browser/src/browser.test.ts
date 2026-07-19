import { afterEach, describe, expect, it } from "vitest";

import { assertOpenableUrl } from "./browser.js";

describe("assertOpenableUrl", () => {
  const original = process.env.REAL_A11Y_MCP_ALLOW_FILE;
  afterEach(() => {
    if (original === undefined) delete process.env.REAL_A11Y_MCP_ALLOW_FILE;
    else process.env.REAL_A11Y_MCP_ALLOW_FILE = original;
  });

  it("allows http, https, and data URLs", () => {
    expect(() => assertOpenableUrl("https://example.com/")).not.toThrow();
    expect(() => assertOpenableUrl("http://example.com/")).not.toThrow();
    expect(() => assertOpenableUrl("data:text/html,<h1>hi</h1>")).not.toThrow();
  });

  it("refuses file:// by default and points at the opt-in flag", () => {
    delete process.env.REAL_A11Y_MCP_ALLOW_FILE;
    expect(() => assertOpenableUrl("file:///etc/passwd")).toThrow(
      /REAL_A11Y_MCP_ALLOW_FILE/,
    );
  });

  it("permits file:// only when REAL_A11Y_MCP_ALLOW_FILE=1", () => {
    process.env.REAL_A11Y_MCP_ALLOW_FILE = "1";
    expect(() => assertOpenableUrl("file:///tmp/page.html")).not.toThrow();
  });

  it("refuses other schemes even with the file flag set", () => {
    process.env.REAL_A11Y_MCP_ALLOW_FILE = "1";
    expect(() => assertOpenableUrl("chrome://settings")).toThrow(/Refusing/);
    expect(() => assertOpenableUrl("ftp://example.com/x")).toThrow(/Refusing/);
  });

  it("rejects a string that isn't an absolute URL", () => {
    expect(() => assertOpenableUrl("not a url")).toThrow(/valid absolute URL/);
  });
});
