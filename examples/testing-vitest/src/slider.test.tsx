import * as React from "react";

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { SliderCorrect, SliderBroken } from "@real-a11y-dev/example-patterns";
import { auditSnapshot } from "@real-a11y-dev/testing";

// Radix slider observes its track size via ResizeObserver, which
// jsdom doesn't provide. Stub it with a no-op so the component
// mounts in the test environment.
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

afterEach(cleanup);

describe("APG Slider — correct vs broken", () => {
  it("Radix slider thumb exposes a slider role", () => {
    const { container } = render(
      <SliderCorrect label="Volume" defaultValue={50} />,
    );
    const tree = auditSnapshot(container);
    // Radix places `role="slider"` on the thumb element. The
    // `aria-label` lives on the Root (role="group") rather than
    // flowing through to the thumb, so we assert on the role
    // presence here. The name is verifiable on the group.
    expect(tree).toContain("slider");
  });

  it("hand-rolled broken slider has no slider role at all", () => {
    const { container } = render(
      <SliderBroken label="Volume" defaultValue={50} />,
    );
    const tree = auditSnapshot(container);
    expect(tree).not.toContain("slider");
  });
});
