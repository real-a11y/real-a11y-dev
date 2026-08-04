import { describe, expect, it } from "vitest";

import { DEFAULT_ROOT, pageIdOf, scopeId } from "./page-id.js";

describe("pageIdOf", () => {
  it("ignores the origin — the same route across environments is one page", () => {
    // The reason `name` was chosen over the URL in the first place: a page
    // moves between localhost, staging and prod without becoming a new page.
    const ids = [
      "http://localhost:3000/pricing",
      "http://localhost:3001/pricing",
      "https://staging.example.com/pricing",
      "https://example.com/pricing",
    ].map(pageIdOf);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBe("/pricing");
  });

  it("distinguishes routes", () => {
    expect(pageIdOf("https://example.com/pricing")).not.toBe(
      pageIdOf("https://example.com/careers"),
    );
  });

  it("treats one trailing slash as the same page, and keeps root as /", () => {
    expect(pageIdOf("https://example.com/pricing/")).toBe("/pricing");
    expect(pageIdOf("https://example.com/")).toBe("/");
    expect(pageIdOf("https://example.com")).toBe("/");
  });

  it("includes search — a query can select entirely different content", () => {
    expect(pageIdOf("https://example.com/search?q=cats")).toBe(
      "/search?q=cats",
    );
    expect(pageIdOf("https://example.com/search?q=cats")).not.toBe(
      pageIdOf("https://example.com/search?q=dogs"),
    );
  });

  it("includes the hash — it is the route in a hash-router SPA", () => {
    expect(pageIdOf("https://example.com/#/pricing")).not.toBe(
      pageIdOf("https://example.com/#/careers"),
    );
  });

  it("returns undefined for a scheme whose path is content, not a route", () => {
    // A `data:` URL's "path" IS the document. Deriving an id from it is wrong
    // twice over: two captures of one page get different ids the moment a byte
    // of content differs (so they never join — this broke the CLI's own e2e
    // fixtures), and the whole document body rides into the artifact, every
    // fingerprint tuple and the committed baseline on the way.
    const html = (extra: string) =>
      `data:text/html,${encodeURIComponent(`<main><button></button>${extra}</main>`)}`;
    expect(pageIdOf(html(""))).toBeUndefined();
    expect(pageIdOf(html("<button></button>"))).toBeUndefined();
    expect(pageIdOf("about:blank")).toBeUndefined();
    expect(pageIdOf("blob:https://example.com/uuid")).toBeUndefined();
    // file: DOES have a route — a built site audited off disk is a real target.
    expect(pageIdOf("file:///tmp/site/index.html")).toBe(
      "/tmp/site/index.html",
    );
  });

  it("never carries a secret past the redaction boundary", () => {
    // The id lands in the artifact, in every fingerprint tuple and in the
    // committed baseline — all of which get posted into PR comments. Callers
    // pass the REDACTED url, so what reaches the id is already `[REDACTED]`.
    // Pinned here because the derivation is what makes that safe: it keeps the
    // path and the parameter NAMES, so redacting values costs no join accuracy.
    const id = pageIdOf("https://app.example.com/callback?token=[REDACTED]");
    expect(id).toBe("/callback?token=[REDACTED]");
    expect(id).not.toContain("hunter2");
    // Same route, two different secrets, redacted -> one page. If the id were
    // derived from the raw url these would be two pages AND leak both values.
    expect(pageIdOf("https://a.example.com/cb?token=[REDACTED]")).toBe(
      pageIdOf("https://b.example.com/cb?token=[REDACTED]"),
    );
  });

  it("returns undefined for anything unparseable, rather than inventing an id", () => {
    // A caller has to handle this. Inventing an id would silently join two
    // unrelated pages, which is the one outcome worth avoiding outright.
    expect(pageIdOf("not a url")).toBeUndefined();
    expect(pageIdOf("")).toBeUndefined();
    expect(pageIdOf("/already-a-path")).toBeUndefined();
  });

  it("scopes an id by the audited subtree, leaving the default root bare", () => {
    // Only the artifact READ path uses this. Fresh captures are whole-document
    // and record `root: "body"` as a literal, so nothing varies — but an
    // artifact written while `rootSelector` still narrowed a run can hold two
    // pages at one URL with different roots and genuinely different findings.
    // Those carry no id, so without this the back-fill collapses them into one
    // and a coherent old file fails to read at all.
    expect(scopeId("/", "header")).not.toBe(scopeId("/", "body"));
    expect(scopeId("/", "header")).not.toBe(scopeId("/", "footer"));
    // The default root contributes nothing, so an ordinary page's id is the
    // bare path and a baseline recorded against it doesn't churn on upgrade.
    expect(scopeId("/", "body")).toBe("/");
    expect(scopeId("/", undefined)).toBe("/");
    expect(scopeId("/pricing", DEFAULT_ROOT)).toBe("/pricing");
  });

  it("agrees with the rule differentUrl applies to checkpoint diffs", () => {
    // Same rule, two consumers. If these ever disagree, one of them is
    // deciding "same page" differently from the other, which is the drift this
    // module exists to prevent.
    const prod = pageIdOf("https://example.com/pricing");
    const preview = pageIdOf("https://preview.example.com/pricing");
    const other = pageIdOf("https://example.com/careers");
    expect(prod).toBe(preview); // differentUrl: not a mismatch
    expect(prod).not.toBe(other); // differentUrl: a mismatch
  });
});
