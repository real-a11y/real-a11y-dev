import type { Finding } from "@real-a11y-dev/testing";
import { describe, expect, it } from "vitest";

import { fingerprintFindings } from "../fingerprint.js";
import {
  buildArtifact,
  type SnapshotArtifact,
  type SnapshotPage,
} from "../snapshot-artifact.js";

import { diffArtifacts } from "./page-diff.js";

const button: Finding = {
  rule: "no-unlabeled-interactive",
  severity: "error",
  message: "Unlabeled interactive element: button <button>",
  role: "button",
  tagName: "button",
  locator: "#save",
};

function page(
  name: string,
  findings: Finding[],
  over: Partial<SnapshotPage> = {},
): SnapshotPage {
  return {
    name,
    url: `http://x/${name}`,
    root: "body",
    status: "ok",
    findings: fingerprintFindings(name, findings),
    tree: "main",
    outline: "",
    tabs: "",
    ...over,
  };
}

function artifact(pages: SnapshotPage[]): SnapshotArtifact {
  return buildArtifact(pages, { toolName: "cli", toolVersion: "0.0.1" });
}

describe("diffArtifacts", () => {
  it("joins pages by name and diffs each pair", () => {
    const base = artifact([page("Home", [button])]);
    const pr = artifact([page("Home", [button, button])]);
    const result = diffArtifacts(base, pr);
    expect(result.summary.new).toBe(1);
    expect(result.pages[0].status).toBe("ok");
  });

  it("treats a page only in the PR as added (all new)", () => {
    const base = artifact([page("Home", [])]);
    const pr = artifact([page("Home", []), page("Login", [button])]);
    const result = diffArtifacts(base, pr);
    const login = result.pages.find((p) => p.name === "Login");
    expect(login?.status).toBe("added");
    expect(result.summary.new).toBe(1);
  });

  it("treats a page only in base as removed (all fixed)", () => {
    const base = artifact([page("Home", []), page("Gone", [button])]);
    const pr = artifact([page("Home", [])]);
    const result = diffArtifacts(base, pr);
    const gone = result.pages.find((p) => p.name === "Gone");
    expect(gone?.status).toBe("removed");
    expect(result.summary.removed).toBe(1);
    expect(result.summary.new).toBe(0);
  });

  it("marks a page incomparable when either side errored", () => {
    const base = artifact([page("Home", [button])]);
    const pr = artifact([
      page("Home", [], { status: "error", error: "could not open" }),
    ]);
    const result = diffArtifacts(base, pr);
    expect(result.pages[0].status).toBe("incomparable");
    expect(result.pages[0].note).toContain("could not open");
    // Incomparable pages contribute no new/removed findings.
    expect(result.summary.new).toBe(0);
  });

  it("diffs the structural views for matching pages", () => {
    const base = artifact([page("Home", [], { tabs: "01. link Home" })]);
    const pr = artifact([page("Home", [], { tabs: "01. link Docs" })]);
    const result = diffArtifacts(base, pr);
    expect(result.pages[0].views.tabs.added).toEqual(["01. link Docs"]);
    expect(result.pages[0].views.tabs.removed).toEqual(["01. link Home"]);
  });
});
