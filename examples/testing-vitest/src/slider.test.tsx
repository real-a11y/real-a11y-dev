import * as React from "react";

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { SliderCorrect, SliderBroken } from "@real-a11y-dev/example-patterns";
import {
  auditSnapshot,
  dispatch,
  findByRole,
  waitForMutations,
} from "@real-a11y-dev/testing";
import { extractA11yTree } from "@real-a11y-dev/core";

// Radix slider observes its track size via ResizeObserver, which
// jsdom doesn't provide. Stub it with a no-op so the component
// mounts in the test environment.
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      constructor(_callback: ResizeObserverCallback) {}
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

// The same `dispatch(node, "increment" | "decrement")` flow that drives
// the panel's ▼/▲ stepper is the public testing API for sliders. These
// tests double as a usage example for consumers writing their own slider
// audits — find the slider node, dispatch the step, assert on the
// resulting value.
describe("APG Slider — increment / decrement via dispatch", () => {
  it("steps a native <input type='range'> via dispatch('increment')", async () => {
    // Native range goes through the dispatcher's `.stepUp()` path —
    // the input's own value-setter runs and `input`/`change` fire.
    const root = document.createElement("div");
    root.innerHTML = `<input type="range" min="0" max="100" step="5" value="40" aria-label="Volume" />`;
    document.body.appendChild(root);

    const tree = extractA11yTree(root);
    const slider = findByRole(tree, "slider", { name: "Volume" })!;
    expect(slider).toBeDefined();

    const result = await dispatch(slider, "increment");
    expect(result.success).toBe(true);

    const input = root.querySelector("input")!;
    expect(input.value).toBe("45");
  });

  it("steps a Radix slider via dispatch('increment') and updates aria-valuenow", async () => {
    // Radix renders a `<span role="slider">` that listens for
    // ArrowRight/ArrowLeft on itself. The dispatcher dispatches the key
    // directly on the element (no focus stealing) and Radix updates
    // state via React. We wait for the re-render to flush, then read
    // the new aria-valuenow off the thumb.
    const { container } = render(
      <SliderCorrect label="Volume" defaultValue={50} max={100} step={1} />,
    );

    const tree = extractA11yTree(container);
    // Radix's thumb is the role="slider" node. Its accessible name is
    // empty — the label lives on the Root group — so we look up by
    // role only.
    const slider = findByRole(tree, "slider")!;
    expect(slider).toBeDefined();

    const before = container.querySelector('[role="slider"]')!;
    expect(before.getAttribute("aria-valuenow")).toBe("50");

    const result = await dispatch(slider, "increment");
    expect(result.success).toBe(true);

    // Radix updates value on a React state-flush — wait for the DOM
    // mutation before reading the new attribute value.
    await waitForMutations(container);

    const after = container.querySelector('[role="slider"]')!;
    expect(after.getAttribute("aria-valuenow")).toBe("51");
  });

  it("steps a Radix slider down via dispatch('decrement')", async () => {
    const { container } = render(
      <SliderCorrect label="Volume" defaultValue={50} max={100} step={1} />,
    );
    const tree = extractA11yTree(container);
    const slider = findByRole(tree, "slider")!;

    await dispatch(slider, "decrement");
    await waitForMutations(container);

    const after = container.querySelector('[role="slider"]')!;
    expect(after.getAttribute("aria-valuenow")).toBe("49");
  });
});
