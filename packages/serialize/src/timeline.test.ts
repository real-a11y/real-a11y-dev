import type { TimelineEvent } from "@real-a11y-dev/core";
import { describe, expect, it } from "vitest";

import { serializeTimeline } from "./index.js";

/** A focus event on a stop with `name` and `states`. */
function focusOn(
  role: string,
  name: string,
  states: Record<string, string | boolean> = {},
  hidden = false,
): TimelineEvent {
  return {
    kind: "focus",
    hidden,
    stop: {
      role,
      name,
      description: "",
      states,
      properties: {},
      isExposedToAT: !hidden,
    },
  };
}

describe("serializeTimeline", () => {
  it("writes a focus line as the tab order prints its stop", () => {
    expect(
      serializeTimeline([focusOn("button", "Menu", { expanded: false })]),
    ).toBe(`focus     button "Menu" {expanded=false}`);
  });

  it("marks a stop assistive tech can't reach, and prints a stop of null as (none)", () => {
    expect(
      serializeTimeline([
        focusOn("button", "A", {}, true),
        focusOn("button", "", {}, true),
        { kind: "focus", stop: null, hidden: false },
      ]),
    ).toBe(
      [
        `focus     button "A" [hidden]`,
        `focus     button [hidden]`,
        `focus     (none)`,
      ].join("\n"),
    );
  });

  it("writes an announce line, with {live=…} only when the role doesn't imply it", () => {
    const announce = (
      role: string,
      live: "polite" | "assertive",
    ): TimelineEvent => ({ kind: "announce", role, text: "Saved.", live });
    expect(
      serializeTimeline([
        announce("status", "polite"),
        announce("alert", "assertive"),
        announce("log", "polite"),
        announce("generic", "polite"),
        announce("status", "assertive"),
      ]),
    ).toBe(
      [
        `announce  status "Saved."`,
        `announce  alert "Saved."`,
        `announce  log "Saved."`,
        `announce  generic "Saved." {live=polite}`,
        `announce  status "Saved." {live=assertive}`,
      ].join("\n"),
    );
  });

  it("redacts focused names and announced text", () => {
    expect(
      serializeTimeline(
        [
          focusOn("button", "Order 4471"),
          {
            kind: "announce",
            role: "status",
            text: "Order 4471 placed, 4471 confirmed.",
            live: "polite",
          },
        ],
        { redact: [/\d{4}/] },
      ),
    ).toBe(
      [
        `focus     button "Order [REDACTED]"`,
        `announce  status "Order [REDACTED] placed, [REDACTED] confirmed."`,
      ].join("\n"),
    );
  });

  it("says (nothing recorded) for no events", () => {
    expect(serializeTimeline([])).toBe("(nothing recorded)");
  });
});
