import { describe, it, expect } from "vitest";

import {
  blockedBy,
  classifyAttachError,
  classifyTabUrl,
  explainUnavailable,
  type NativeUnavailableReason,
} from "./capability.js";

const ALL_REASONS: NativeUnavailableReason[] = [
  "browser-ui",
  "extension-page",
  "web-store",
  "view-source",
  "file-url",
  "no-url",
  "devtools-conflict",
  "attach-refused",
];

describe("classifyTabUrl", () => {
  it("allows ordinary web pages", () => {
    for (const url of [
      "https://example.com/",
      "http://localhost:5173/app?x=1#y",
      "https://youtube.com/watch?v=abc",
    ]) {
      expect(classifyTabUrl(url)).toEqual({ native: true, domFallback: true });
    }
  });

  it("blocks browser UI across Chromium forks, not just chrome://", () => {
    // The dogfood build loads unpacked in forks too, where the scheme differs
    // but the rule doesn't.
    for (const url of [
      "chrome://extensions/",
      "chrome://newtab/",
      "chrome-untrusted://foo",
      "devtools://devtools/bundled/inspector.html",
      "edge://settings",
      "brave://settings",
    ]) {
      expect(classifyTabUrl(url).reason).toBe("browser-ui");
    }
  });

  it("treats about:blank and about:srcdoc as ordinary documents", () => {
    // They are attachable — refusing them would block a real debugging case
    // for the sake of a scheme match.
    expect(classifyTabUrl("about:blank").native).toBe(true);
    expect(classifyTabUrl("about:srcdoc").native).toBe(true);
  });

  it("blocks extension pages, the Web Store, view-source and file URLs", () => {
    expect(classifyTabUrl("chrome-extension://abc/panel.html").reason).toBe(
      "extension-page",
    );
    expect(
      classifyTabUrl("https://chromewebstore.google.com/detail/x").reason,
    ).toBe("web-store");
    // The legacy Web Store host is only blocked under /webstore — the rest of
    // chrome.google.com is an ordinary site.
    expect(
      classifyTabUrl("https://chrome.google.com/webstore/category/extensions")
        .reason,
    ).toBe("web-store");
    expect(
      classifyTabUrl("https://chrome.google.com/intl/en/chrome/").native,
    ).toBe(true);
    expect(classifyTabUrl("view-source:https://example.com").reason).toBe(
      "view-source",
    );
    expect(classifyTabUrl("file:///Users/x/page.html").reason).toBe("file-url");
    // ...but only by default: with "Allow access to file URLs" both producers
    // work, so refusing regardless would fail closed and would put a bogus
    // `file-url` row in the capability split for a correctly-configured setup.
    expect(
      classifyTabUrl("file:///Users/x/page.html", { fileAccess: true }).native,
    ).toBe(true);
  });

  it("reports an unreadable URL as no-url, but an uncommitted one as attachable", () => {
    // `chrome.tabs.get` returns `url: ""` for a tab mid-navigation — a
    // successful call about an ordinary page. Refusing it fails closed on the
    // one case that fixes itself, and files a bogus row in the split.
    expect(classifyTabUrl(undefined).reason).toBe("no-url");
    expect(classifyTabUrl("").native).toBe(true);
  });

  it("keeps about:blank attachable when it carries a fragment or query", () => {
    // Chrome produces `about:blank#blocked` itself. Slicing the raw url instead
    // of reading pathname sent these to `browser-ui` — the only reason that is
    // both non-retryable and claims no DOM fallback.
    for (const url of [
      "about:blank#x",
      "about:blank?a=1",
      "about:srcdoc#y",
      "about:BLANK",
    ]) {
      expect(classifyTabUrl(url).native).toBe(true);
    }
    expect(classifyTabUrl("about:settings").reason).toBe("browser-ui");
  });

  it("lets an unparseable URL through to the attach", () => {
    // The pre-flight is a heuristic; the attach is authoritative. Failing open
    // here costs one banner flash, failing closed would refuse a page that
    // works.
    expect(classifyTabUrl("not a url at all").native).toBe(true);
  });
});

describe("domFallback", () => {
  it("is false exactly where Chrome blocks the content script too", () => {
    // The expensive mistake is claiming a fallback that doesn't exist: it sends
    // a dogfooder to a panel that will also never load.
    for (const reason of [
      "browser-ui",
      "extension-page",
      "web-store",
      "view-source",
      "file-url",
    ] as const) {
      expect(blockedBy(reason).domFallback).toBe(false);
    }
    // `no-url` means chrome.tabs.get threw — the tab is gone or privileged, so
    // the content script is no better off there either.
    expect(blockedBy("no-url").domFallback).toBe(false);
    for (const reason of ["devtools-conflict", "attach-refused"] as const) {
      expect(blockedBy(reason).domFallback).toBe(true);
    }
  });

  it("agrees with what classifyTabUrl returns for the same page", () => {
    // blockedBy() is what the panel uses when only a reason code crossed the
    // message boundary, so the two must not drift.
    for (const url of [
      "chrome://extensions/",
      "chrome-extension://abc/x.html",
      "https://chromewebstore.google.com/",
      "view-source:https://example.com",
      "file:///tmp/x.html",
    ]) {
      const fromUrl = classifyTabUrl(url);
      expect(blockedBy(fromUrl.reason!)).toEqual(fromUrl);
    }
  });
});

describe("classifyAttachError", () => {
  it("keeps the DevTools conflict distinct from a generic refusal", () => {
    // It is the only transient, user-fixable reason, and one of the three
    // headline dogfood metrics — blurring it would lose both.
    expect(classifyAttachError("conflict")).toBe("devtools-conflict");
    expect(classifyAttachError("attach-failed")).toBe("attach-refused");
    expect(classifyAttachError(undefined)).toBe("attach-refused");
  });
});

describe("explainUnavailable", () => {
  it("has a non-empty sentence for every reason", () => {
    for (const reason of ALL_REASONS) {
      expect(explainUnavailable(reason).length).toBeGreaterThan(20);
    }
  });

  it("never promises a DOM fallback where there isn't one", () => {
    // "the DOM tree below" on a chrome:// page would be a second dead end
    // dressed up as a remedy.
    for (const reason of ALL_REASONS) {
      if (blockedBy(reason).domFallback) continue;
      expect(explainUnavailable(reason)).not.toMatch(/DOM tree below/i);
    }
  });
});
