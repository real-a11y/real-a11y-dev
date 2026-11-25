import { describe, expect, it } from "vitest";

import { dropBuiltInFileInputNames } from "./file-input-name.js";
import { winningNameSource, type RawAXNameNode } from "./value-regions.js";

/** A node named `name` whose trace has one winning step. */
function named(
  nodeId: string,
  role: string,
  name: string,
  step: Record<string, unknown>,
  before: Record<string, unknown>[] = [],
): RawAXNameNode {
  return {
    nodeId,
    backendDOMNodeId: Number(nodeId),
    role: { value: role },
    name: {
      value: name,
      sources: [
        ...before,
        { value: { type: "computedString", value: name }, ...step },
      ] as NonNullable<RawAXNameNode["name"]>["sources"],
    },
  };
}

const builtIn = { type: "contents", attribute: "value" };

describe("dropBuiltInFileInputNames", () => {
  it("reads the browser's own file-button text as no name", () => {
    const nodes = [
      named("1", "button", "Choose File", builtIn),
      named("2", "button", "Choose Files", builtIn),
      // aria-label="" and an empty aria-labelledby lose to the same step.
      named("3", "button", "Choose File", builtIn, [
        { type: "attribute", attribute: "aria-label", value: { value: "" } },
      ]),
      // title is superseded: Chromium makes it the description instead.
      named("4", "button", "Choose File", builtIn, [
        {
          type: "attribute",
          attribute: "title",
          superseded: true,
          value: { value: "Upload CV" },
        },
      ]),
      named("5", "link", "Choose File", builtIn),
    ];
    for (const node of dropBuiltInFileInputNames(nodes)) {
      expect(node.name?.value).toBe("");
      expect(winningNameSource(node)).toBeUndefined();
    }
  });

  it("keeps every other name", () => {
    const kept = [
      named("1", "button", "Upload CV", {
        type: "attribute",
        attribute: "aria-label",
      }),
      named("2", "button", "Upload CV", {
        type: "relatedElement",
        nativeSource: "labelfor",
      }),
      named("3", "button", "Upload CV", {
        type: "relatedElement",
        nativeSource: "labelwrapped",
      }),
      named("4", "button", "Upload CV", {
        type: "relatedElement",
        attribute: "aria-labelledby",
      }),
      named("5", "button", "Submit", { type: "contents" }),
      named("6", "button", "Reset", { type: "contents" }),
      named("7", "button", "Submit", { type: "attribute", attribute: "type" }),
      named("8", "button", "Send", { type: "attribute", attribute: "value" }),
      named("9", "button", "B", { type: "contents" }),
      // Nothing says where this name came from.
      {
        nodeId: "10",
        role: { value: "button" },
        name: { value: "Choose File" },
      },
    ] satisfies RawAXNameNode[];
    const out = dropBuiltInFileInputNames(kept);
    expect(out.map((n) => n.name?.value)).toEqual(
      kept.map((n) => n.name?.value),
    );
  });

  it("keeps the rest of the trace and never mutates its input", () => {
    const label = {
      type: "relatedElement",
      attribute: "aria-labelledby",
      value: { value: "" },
    };
    const node = named("1", "button", "Choose File", builtIn, [label]);
    const before = JSON.stringify(node);
    const [out] = dropBuiltInFileInputNames([node]);
    expect(JSON.stringify(node)).toBe(before);
    expect(out).not.toBe(node);
    expect(out?.name?.sources).toHaveLength(2);
    expect(out?.name?.sources?.[0]).toEqual(label);
  });
});
