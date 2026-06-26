import * as React from "react";

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  ComboboxAsyncBroken,
  ComboboxAsyncCorrect,
} from "@real-a11y-dev/example-patterns";

afterEach(cleanup);

// Driving the open / loaded states in jsdom is brittle (timers,
// portal-mount races). Assert on the *static* metadata the correct
// variant exposes — the role chain and the live region — which are
// the key differences a Real A11y consumer sees in the inspector
// panel either way.
describe("APG async Combobox — correct vs broken", () => {
  it("React Aria async combobox exposes role=combobox + a status live region", () => {
    const { container } = render(
      <ComboboxAsyncCorrect label="Codename" latencyMs={0} />,
    );

    const combobox = container.querySelector('[role="combobox"]');
    expect(combobox).not.toBeNull();
    expect(combobox?.tagName.toLowerCase()).toBe("input");
    expect(combobox?.getAttribute("aria-autocomplete")).toBe("list");

    // role="status" live region is what makes this the "async" variant —
    // announces loading + result count to AT.
    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
  });

  it("hand-rolled broken async combobox has no combobox role and no live region", () => {
    const { container } = render(
      <ComboboxAsyncBroken label="Codename" latencyMs={0} />,
    );

    expect(container.querySelector('[role="combobox"]')).toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector("[aria-live]")).toBeNull();
    expect(container.querySelector("[aria-busy]")).toBeNull();

    // The input exists and is reachable — just announces as a plain textbox.
    const input = container.querySelector("input");
    expect(input).not.toBeNull();
    expect(input?.getAttribute("role")).toBeNull();
  });
});
