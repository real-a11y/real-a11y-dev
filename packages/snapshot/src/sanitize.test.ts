import { describe, expect, it } from "vitest";

import {
  projectFinding,
  projectFindings,
  projectSnapshot,
  redactUrl,
  redactUrlsIn,
  sanitizeText,
} from "./sanitize.js";

describe("sanitizeText", () => {
  it("escapes terminal escape sequences to visible text", () => {
    expect(sanitizeText("evil\u001B]0;owned\u0007name")).toBe(
      "evil\\u{1B}]0;owned\\u{7}name",
    );
  });

  it("escapes bidi override characters", () => {
    expect(sanitizeText("a‮b⁦c")).toBe("a\\u{202E}b\\u{2066}c");
  });

  it("passes CJK and RTL letters through untouched", () => {
    const text = "ボタン عربى héllo";
    expect(sanitizeText(text)).toBe(text);
  });

  it("collapses newlines in singleLine mode so a name can't forge lines", () => {
    expect(sanitizeText("a\r\nb\tc", { singleLine: true })).toBe("a b c");
  });

  it("normalizes CR away in multiline mode", () => {
    expect(sanitizeText("a\r\nb")).toBe("a\nb");
  });

  it("stringifies non-strings defensively", () => {
    expect(sanitizeText(42)).toBe("42");
    expect(sanitizeText(null)).toBe("");
  });

  it("strips SGR color codes (Playwright errors) but keeps non-SGR escapes visible", () => {
    expect(sanitizeText("a\u001B[2mdim\u001B[22mb")).toBe("adimb");
    expect(sanitizeText("x\u001B[2Ky")).toBe("x\\u{1B}[2Ky");
    expect(sanitizeText("literal [31m text")).toBe("literal [31m text");
  });
});

describe("redactUrl", () => {
  it("strips userinfo", () => {
    expect(redactUrl("https://user:pass@host/x")).toBe("https://host/x");
  });

  it("redacts secret-looking query params, keeps the rest", () => {
    expect(redactUrl("https://h/p?q=1&token=abc&API_KEY=zz")).toBe(
      "https://h/p?q=1&token=%5BREDACTED%5D&API_KEY=%5BREDACTED%5D",
    );
  });

  it("sanitizes but returns non-URLs as-is", () => {
    expect(redactUrl("not a url")).toBe("not a url");
  });

  it("redacts secrets in the FRAGMENT, where the implicit flow puts them", () => {
    // `searchParams` stops at the `#`, so the query pass above never saw this.
    // An OAuth implicit redirect lands exactly here, and because the fragment
    // is never sent to the server it is only ever visible client-side — which
    // is where this toolchain reads it.
    expect(
      redactUrl("https://app.example.com/cb#access_token=ya29.secret"),
    ).toBe("https://app.example.com/cb#access_token=%5BREDACTED%5D");
    // Mixed pairs: only the secret-looking key goes.
    expect(redactUrl("https://h/cb#state=xyz&id_token=eyJ0")).toBe(
      "https://h/cb#state=xyz&id_token=%5BREDACTED%5D",
    );
  });

  it("leaves ordinary fragments untouched, byte for byte", () => {
    // Blanking every fragment would make printed URLs worse for the sake of a
    // case that announces itself with `k=v`. And an untouched fragment must not
    // pick up percent-encoding on the way through.
    for (const url of [
      "https://real-a11y.dev/guide#installation",
      "https://app.example.com/#/dashboard/users",
      "https://h/p?q=1#a-b_c.d~e",
    ]) {
      expect(redactUrl(url)).toBe(url);
    }
  });

  it("handles a hash router carrying its own query", () => {
    expect(redactUrl("https://app.example.com/#/cb?code=abc&next=/home")).toBe(
      "https://app.example.com/#/cb?code=%5BREDACTED%5D&next=/home",
    );
  });

  it("does not treat a fragment without pairs as parameters", () => {
    // `&` alone is not a key/value pair; nothing matches, so nothing is rewritten.
    expect(redactUrl("https://h/p#a&b")).toBe("https://h/p#a&b");
  });

  it("still redacts when a LATER value contains a '?'", () => {
    // `?` is legal and unencoded inside a fragment, so splitting on the first
    // one is not safe: an OAuth `state=/dash?tab=1` puts a `?` after the token,
    // and treating everything before it as an un-scanned "route" would print
    // the token in full — defeating the whole fix.
    const out = redactUrl(
      "https://app.example.com/cb#access_token=ya29.SECRET&state=/dash?tab=1",
    );
    expect(out).not.toContain("ya29.SECRET");
    expect(out).toContain("access_token=%5BREDACTED%5D");
    // The non-secret value survives, `?` and all.
    expect(out).toContain("state=/dash?tab=1");

    expect(
      redactUrl("https://h/cb#access_token=ya29.SECRET?foo"),
    ).not.toContain("ya29.SECRET");
  });

  it("keeps a bare trailing '#'", () => {
    // The hash getter reports an empty fragment as "" and the setter reads ""
    // as "remove it", so an unconditional round-trip would drop it.
    expect(redactUrl("https://example.com/p#")).toBe("https://example.com/p#");
  });

  it("does not invent a value for a valueless secret key", () => {
    // `#a=1&token` has no token to redact; handing it a fabricated
    // `[REDACTED]` would report a secret that was never there.
    expect(redactUrl("https://h/p#a=1&token")).toBe("https://h/p#a=1&token");
    expect(redactUrl("https://h/p#token=")).toBe("https://h/p#token=");
  });

  it("redacts every occurrence of a repeated secret key", () => {
    // Rebuilding with append rather than set(): set() collapses repeats into
    // one, which would silently drop the second value from the output.
    expect(redactUrl("https://h/p#token=a&token=b")).toBe(
      "https://h/p#token=%5BREDACTED%5D&token=%5BREDACTED%5D",
    );
  });

  it("redactUrlsIn scrubs URLs embedded in free text (Playwright messages)", () => {
    expect(
      redactUrlsIn("page.goto: net::ERR at https://u:p@h/x?token=abc failed"),
    ).toBe("page.goto: net::ERR at https://h/x?token=%5BREDACTED%5D failed");
  });
});

describe("projectFinding", () => {
  const valid = {
    rule: "image-alt",
    severity: "warning",
    message: "Image has no accessible name",
    locator: "img:nth-of-type(2)",
  };

  it("keeps known fields, drops unknown ones", () => {
    const projected = projectFinding({
      ...valid,
      __proto__x: "boom",
      extra: 1,
    });
    expect(projected).toEqual({
      rule: "image-alt",
      severity: "warning",
      message: "Image has no accessible name",
      locator: "img:nth-of-type(2)",
    });
  });

  it("rejects unknown rules and severities", () => {
    expect(projectFinding({ ...valid, rule: "made-up" })).toBeNull();
    expect(projectFinding({ ...valid, severity: "fatal" })).toBeNull();
    expect(projectFinding("nope")).toBeNull();
  });

  it("sanitizes and caps every string field", () => {
    const projected = projectFinding({
      ...valid,
      message: `hi\u001B[2K${"x".repeat(2000)}`,
    });
    expect(projected!.message.startsWith("hi\\u{1B}[2K")).toBe(true);
    expect(projected!.message.length).toBeLessThanOrEqual(1000);
  });
});

describe("projectFindings / projectSnapshot", () => {
  it("returns [] for non-arrays and skips invalid entries", () => {
    expect(projectFindings("x")).toEqual([]);
    expect(
      projectFindings([
        null,
        { rule: "image-alt", severity: "warning", message: "m" },
      ]),
    ).toHaveLength(1);
  });

  it("projects a snapshot shape with defaults for garbage", () => {
    const snapshot = projectSnapshot({ tree: "main\n", nonsense: 1 });
    expect(snapshot).toEqual({
      findings: [],
      tree: "main\n",
      outline: "",
      tabOrder: "",
    });
  });
});

describe("redactUrl — fragments the pair scan cannot tokenize", () => {
  // These all leaked through an earlier revision that returned the fragment
  // verbatim whenever no pair matched. The lesson is the shape of the fix, not
  // the individual inputs: "nothing matched" must never mean "print it raw",
  // because it really means "we and the app disagree about where this splits".
  const SECRET = "ya29.SECRET";

  it("redacts after a SECOND '#' — the hash-routed implicit-flow landing", () => {
    // A hash-routed SPA's callback is itself a fragment, so the IdP's response
    // is appended after another `#`. The URL parser calls all of it one
    // fragment, so the token sits inside what looks like a key.
    const out = redactUrl(
      `https://app.example.com/#/callback#access_token=${SECRET}&token_type=Bearer`,
    );
    expect(out).not.toContain(SECRET);
  });

  it("redacts when a '?' precedes the secret", () => {
    expect(
      redactUrl(`https://h/cb#state=1?access_token=${SECRET}`),
    ).not.toContain(SECRET);
  });

  it("drops the fragment when the '=' itself is percent-encoded", () => {
    // Nothing tokenizes as a pair here, so there is no value to replace —
    // the only safe answer is to print none of it.
    const out = redactUrl(`https://h/cb#access_token%3D${SECRET}&state=1`);
    expect(out).not.toContain(SECRET);
    expect(out).toContain("%5BREDACTED%5D");
  });

  it("redacts a percent-encoded key name", () => {
    expect(redactUrl(`https://h/cb#access%5Ftoken=${SECRET}`)).not.toContain(
      SECRET,
    );
  });

  it("still leaves genuinely ordinary fragments alone", () => {
    // The backstop must not be so eager that it eats normal pages.
    for (const url of [
      "https://real-a11y.dev/guide#installation",
      "https://app.example.com/#/dashboard/users",
      "https://h/p#a=1&token",
      "https://h/p#token=",
      "https://h/p#a&b",
    ]) {
      expect(redactUrl(url)).toBe(url);
    }
  });
});

describe("redactUrl — regressions in the fragment scanner itself", () => {
  it("redacts a base64-padded token without losing the fragment", () => {
    // The value class excludes `=` so one pair cannot swallow the next, which
    // left padding outside the rewrite: the stray `=` then re-armed the
    // backstop against the scan's OWN output and cost the whole fragment —
    // taking the route, and the page identity derived from it, with it.
    expect(
      redactUrl(
        "https://app.example.com/cb#access_token=eyJhbGciOiJIUzI1NiJ9.abc=",
      ),
    ).toBe("https://app.example.com/cb#access_token=%5BREDACTED%5D");
  });

  it("does not cut a fragment at an index measured against different text", () => {
    // The decoded pass re-encodes `[REDACTED]`, which GROWS the string, so its
    // match index does not map onto the raw one. Cutting `rebuilt` at that
    // offset put the secret on the printed side of the cut.
    const out = redactUrl("https://h/p#a=b=[REDACTED][REDACTED].%6Bey=X/tail");
    expect(out).not.toContain("X/tail");
    expect(out).toContain("%5BREDACTED%5D");
  });
});

describe("redactUrlsIn — schemes beyond http(s)", () => {
  const S = "ya29.SECRET";
  it("redacts a ws:// CDP endpoint, whose GUID is a capability token", () => {
    // MCP attaches over CDP via REAL_A11Y_MCP_CDP, and a failed connect relays
    // Playwright's message verbatim. That browser GUID is full control of the
    // browser, not just an address.
    const out = redactUrlsIn(
      `connectOverCDP failed at ws://127.0.0.1:9222/devtools/browser/abc#access_token=${S}`,
    );
    expect(out).not.toContain(S);
  });

  it("redacts file:// and does not cut an IPv6 authority at the bracket", () => {
    expect(
      redactUrlsIn(`at file:///tmp/cb.html#access_token=${S}`),
    ).not.toContain(S);
    // `]` had to stay inside the character class: excluding it truncated the
    // match before the fragment and left the tail unscanned.
    expect(
      redactUrlsIn(`at https://[::1]:3000/cb#access_token=${S}`),
    ).not.toContain(S);
  });
});

describe("redactUrl — appending to a fragment must never un-redact it", () => {
  const T = "ya29.a0AfB_LIVE_TOKEN";

  it("consults the decoded view before trusting the raw cut", () => {
    // The raw backstop cuts back to the last separator before ITS match and
    // prints what is in front. That is only safe once the decoded view is
    // clean: with a percent-hidden secret AND a later raw-visible trigger, the
    // raw pass fired on the later one, the cut landed after the hidden secret,
    // and returning meant the decoded pass never ran.
    for (const url of [
      `https://app.test/cb#redirect=https%3A%2F%2Fidp.test%2F%23access_token%3D${T}&sig=YWJj=ZGVm`,
      `https://app.test/cb#access_token%253D${T}&id_token=eyJhbGc=iOiJ`,
      `https://app.test/cb#a=b|access%5Ftoken=${T}&c=d|token=x`,
    ]) {
      expect(redactUrl(url)).not.toContain(T);
    }
  });

  it("is monotonic: a suffix cannot reveal a byte redacted without it", () => {
    // The property, stated directly — the failure above was anti-monotonic,
    // which is the shape that makes this class hard to spot by sampling.
    const base = `https://app.test/cb#access_token%253D${T}`;
    for (const suffix of [
      "",
      "&sig=a=b",
      "&c=d|token=x",
      "&access_token=AAA==BBB",
    ]) {
      expect(redactUrl(base + suffix)).not.toContain(T);
    }
  });
});

describe("redactUrlsIn — punctuation must not truncate before the fragment", () => {
  const T = "ya29.a0AfB_LIVE_TOKEN";

  it("scans past ' and ) inside a URL", () => {
    // Both are outside the WHATWG fragment percent-encode set, so a URL keeps
    // them verbatim — excluding them cut the match before the fragment and
    // left the token unscanned, exactly as `]` did.
    expect(
      redactUrlsIn(
        `at https://app.test/cb#state=/wiki/Page_(draft)&access_token=${T}`,
      ),
    ).not.toContain(T);
    expect(
      redactUrlsIn(`at https://app.test/cb#state=o'brien&access_token=${T}`),
    ).not.toContain(T);
  });

  it("still gives prose back its closing parenthesis", () => {
    expect(redactUrlsIn("see (https://x/#a) ok")).toBe("see (https://x/#a) ok");
  });
});

describe("redactUrl — a malformed escape must not cancel the decoded view", () => {
  const T = "ya29.a0AfB_byT0kEnS3cr3t";

  it("keeps redacting when the fragment holds an undecodable byte", () => {
    // Decoding the whole fragment at once failed open: one stray `%` made
    // `decodeURIComponent` throw, and returning the input unchanged degraded
    // the decoded view into a copy of the raw one. That view is the ONLY thing
    // that sees `#/callback%3Faccess_token%3D…`, so a `&ref=100%` appended to
    // such a URL printed the token in full.
    for (const url of [
      `https://app.test/cb#/callback%3Faccess_token%3D${T}&ref=100%`, // bare %
      `https://app.test/cb#access%5Ftoken%3D${T}==&u=%FF`, // invalid UTF-8
      `https://app.test/cb#%ED%A0%80&access%5Ftoken%3D${T}==`, // lone surrogate, prepended
      `https://app.test/cb#access%5Ftoken%3D${T}&x=%zz`, // invalid hex
    ]) {
      expect(redactUrl(url)).not.toContain(T);
    }
    expect(
      redactUrlsIn(
        `net::ERR at https://app.test/cb#/callback%3Faccess_token%3D${T}&ref=100%`,
      ),
    ).not.toContain(T);
  });

  it("still leaves an ordinary fragment with a percent sign alone", () => {
    // Dropping the fragment whenever decoding throws would blank every
    // `#zoom=50%` and destroy the hash-route identity the cut exists to keep.
    expect(redactUrl("https://h/p#zoom=50%")).toBe("https://h/p#zoom=50%");
    expect(redactUrl("https://h/p#a=100%&b=2")).toBe("https://h/p#a=100%&b=2");
  });
});
