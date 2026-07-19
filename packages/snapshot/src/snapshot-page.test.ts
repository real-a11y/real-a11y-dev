import type { Finding } from "@real-a11y-dev/audit";
import { describe, expect, it } from "vitest";

import { redactUrl } from "./sanitize.js";
import { buildSnapshotPage } from "./snapshot-page.js";

const clean = {
  findings: [] as Finding[],
  tree: "button",
  outline: "(no headings)",
  tabOrder: "1. button",
};

const finding: Finding = {
  rule: "no-unlabeled-interactive",
  severity: "error",
  message: "Unlabeled interactive element: button <button>",
  role: "button",
  tagName: "BUTTON",
  locator: "#save",
};

describe("buildSnapshotPage", () => {
  it("renames tabOrder → tabs, defaults root to body, marks status ok", () => {
    const page = buildSnapshotPage("home", "https://example.com/", clean);
    expect(page.tabs).toBe("1. button");
    expect(page).not.toHaveProperty("tabOrder");
    expect(page.root).toBe("body");
    expect(page.status).toBe("ok");
  });

  it("applies redactUrl to the url", () => {
    const raw = "https://example.com/dashboard";
    expect(buildSnapshotPage("home", raw, clean).url).toBe(redactUrl(raw));
  });

  it("fingerprints findings deterministically under the page name", () => {
    const a = buildSnapshotPage("home", "u", { ...clean, findings: [finding] });
    const b = buildSnapshotPage("home", "u", { ...clean, findings: [finding] });
    expect(a.findings[0].fingerprint).toMatch(/^v1:/);
    expect(a.findings[0].fingerprint).toBe(b.findings[0].fingerprint);

    // `page` is part of the v1 tuple, so a different name ⇒ different id.
    const other = buildSnapshotPage("about", "u", {
      ...clean,
      findings: [finding],
    });
    expect(other.findings[0].fingerprint).not.toBe(a.findings[0].fingerprint);
  });

  it("passes sourcePath through only when provided", () => {
    expect(buildSnapshotPage("home", "u", clean)).not.toHaveProperty(
      "sourcePath",
    );
    expect(
      buildSnapshotPage("home", "u", clean, { sourcePath: "src/home.tsx" })
        .sourcePath,
    ).toBe("src/home.tsx");
  });
});
