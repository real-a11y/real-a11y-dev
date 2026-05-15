import * as React from "react";

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ToolbarCorrect, ToolbarBroken } from "@real-a11y-dev/example-patterns";
import { auditSnapshot } from "@real-a11y-dev/testing";

afterEach(cleanup);

const items = [
  { id: "bold", label: "Bold" },
  { id: "italic", label: "Italic" },
  { id: "underline", label: "Underline" },
];

describe("APG Toolbar — correct vs broken", () => {
  it("Radix toolbar surfaces as `toolbar` with its accessible name", () => {
    const { container } = render(
      <ToolbarCorrect label="Text formatting" items={items} />,
    );
    const tree = auditSnapshot(container);
    expect(tree).toContain('toolbar "Text formatting"');
    expect(tree).toContain('button "Bold"');
  });

  it("hand-rolled broken toolbar shows no toolbar role", () => {
    const { container } = render(
      <ToolbarBroken label="Text formatting" items={items} />,
    );
    const tree = auditSnapshot(container);
    expect(tree).not.toContain("toolbar");
    expect(tree).toContain('button "Bold"');
  });
});
