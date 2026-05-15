import * as React from "react";

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MenuCorrect, MenuBroken } from "@real-a11y-dev/example-patterns";

afterEach(cleanup);

const items = [
  { id: "profile", label: "Edit profile" },
  { id: "settings", label: "Settings" },
  { id: "signout", label: "Sign out" },
];

// Menu's "open" state in Radix involves a portal + focus management
// that's brittle in jsdom — assert on the closed-state trigger
// attributes instead. The trigger is where Real A11y consumers will
// notice the difference between the two variants first.
describe("APG Menu — correct vs broken", () => {
  it("Radix menu trigger announces itself as a popup-opening button", () => {
    const { getByRole } = render(
      <MenuCorrect trigger="Account" items={items} />,
    );
    const trigger = getByRole("button", { name: "Account" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("hand-rolled broken menu trigger has no popup metadata", () => {
    const { getByRole } = render(
      <MenuBroken trigger="Account" items={items} />,
    );
    const trigger = getByRole("button", { name: "Account" });
    expect(trigger.getAttribute("aria-haspopup")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBeNull();
  });
});
