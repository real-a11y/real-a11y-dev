// Vitest uses esbuild's default classic JSX transform here (no
// tsconfig in this example), so React has to be in scope for `<…/>`.
import * as React from "react";

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  TabsCorrect,
  TabsBroken,
  type TabsExampleProps,
} from "@real-a11y-dev/example-patterns";
import { auditSnapshot, tabSequenceSnapshot } from "@real-a11y-dev/testing";

afterEach(cleanup);

const panels: TabsExampleProps["panels"] = [
  { id: "overview", label: "Overview", content: <p>Overview body</p> },
  { id: "install", label: "Install", content: <p>Install body</p> },
  { id: "usage", label: "Usage", content: <p>Usage body</p> },
];

// Recipe-style tests demonstrating that the same audit utilities work
// against any React-rendered DOM — Radix-based or hand-rolled. The
// "correct" test asserts on the APG tab structure that Radix produces;
// the "broken" test asserts on the structural gap a hand-rolled tabs
// component leaves behind.
describe("APG Tabs — correct vs broken", () => {
  it("Radix-backed tabs produce a tablist + tabs + tabpanel tree", () => {
    const { container } = render(
      <TabsCorrect
        defaultValue="overview"
        label="Documentation sections"
        panels={panels}
      />,
    );

    const tree = auditSnapshot(container);
    expect(tree).toContain('tablist "Documentation sections"');
    expect(tree).toContain('tab "Overview"');
    expect(tree).toContain('tab "Install"');
    expect(tree).toContain('tab "Usage"');
    // The active panel — Radix only renders the selected tabpanel by
    // default, so we expect exactly one.
    expect(tree.match(/tabpanel/g)?.length).toBe(1);
  });

  // Note: roving-tabindex assertions for the *correct* tabs would
  // belong in a Playwright e2e test. jsdom doesn't compute the layout
  // signals Radix uses to manage focus, so the tab-sequence snapshot
  // here is unreliable for the Radix variant. The broken variant's
  // sequence is reliable because it's just plain buttons.

  it("hand-rolled broken tabs have no tablist + every button stays in tab order", () => {
    const { container } = render(
      <TabsBroken defaultValue="overview" panels={panels} />,
    );

    const tree = auditSnapshot(container);
    // The broken variant emits plain buttons with no role/aria-controls.
    // No `tablist` / `tab` / `tabpanel` anywhere in the audit output.
    expect(tree).not.toContain("tablist");
    expect(tree).not.toContain('role="tab"');
    expect(tree).toContain('button "Overview"');
    expect(tree).toContain('button "Install"');
    expect(tree).toContain('button "Usage"');

    // And every tab-button is in the keyboard sequence (no roving
    // tabindex), which is exactly what makes the broken variant feel
    // wrong with a screen reader: 3 stops to walk through, not 1.
    const tabs = tabSequenceSnapshot(container);
    const buttonLines = tabs
      .split("\n")
      .filter((line) => line.includes("button "));
    expect(buttonLines.length).toBeGreaterThanOrEqual(3);
  });
});
