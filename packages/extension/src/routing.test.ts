import { describe, it, expect } from "vitest";

import {
  prefixNodeId,
  parseNodeId,
  normalizeUrl,
  urlsMatch,
  planFrameAnnouncementResponse,
  planFrameHello,
} from "./routing.js";

describe("prefixNodeId", () => {
  it("leaves top-frame ids unchanged (no prefix for frame 0)", () => {
    expect(prefixNodeId(0, "abc")).toBe("abc");
    expect(prefixNodeId(0, "sn-42")).toBe("sn-42");
  });

  it("prefixes child-frame ids with `f<frameId>-`", () => {
    expect(prefixNodeId(5, "abc")).toBe("f5-abc");
    expect(prefixNodeId(137, "sn-42")).toBe("f137-sn-42");
  });

  it("preserves hyphens inside the local id", () => {
    expect(prefixNodeId(5, "abc-def-ghi")).toBe("f5-abc-def-ghi");
  });
});

describe("parseNodeId", () => {
  it("returns frame 0 and the id unchanged when no prefix", () => {
    expect(parseNodeId("abc")).toEqual({ frameId: 0, localId: "abc" });
    expect(parseNodeId("sn-42")).toEqual({ frameId: 0, localId: "sn-42" });
  });

  it("parses `f<n>-<id>` into frame id and local id", () => {
    expect(parseNodeId("f5-abc")).toEqual({ frameId: 5, localId: "abc" });
    expect(parseNodeId("f137-sn-42")).toEqual({
      frameId: 137,
      localId: "sn-42",
    });
  });

  it("preserves hyphens in the local id when parsing", () => {
    expect(parseNodeId("f5-abc-def-ghi")).toEqual({
      frameId: 5,
      localId: "abc-def-ghi",
    });
  });

  it("is a round-trip inverse of prefixNodeId", () => {
    for (const [fid, lid] of [
      [0, "abc"],
      [0, "sn-42"],
      [5, "abc"],
      [137, "sn-42"],
      [9, "abc-def"],
    ] as const) {
      const prefixed = prefixNodeId(fid, lid);
      expect(parseNodeId(prefixed)).toEqual({ frameId: fid, localId: lid });
    }
  });
});

describe("normalizeUrl", () => {
  it("strips the hash", () => {
    expect(normalizeUrl("https://example.com/path#section")).toBe(
      "https://example.com/path",
    );
  });

  it("strips the search/query", () => {
    expect(normalizeUrl("https://example.com/path?q=hello")).toBe(
      "https://example.com/path",
    );
  });

  it("strips a trailing slash", () => {
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com");
    expect(normalizeUrl("https://example.com/docs/")).toBe(
      "https://example.com/docs",
    );
  });

  it("preserves the path when there is no trailing slash", () => {
    expect(normalizeUrl("https://example.com/docs/guide")).toBe(
      "https://example.com/docs/guide",
    );
  });

  it("returns the input unchanged when it cannot be parsed", () => {
    expect(normalizeUrl("about:blank")).toBe("about:blank");
    expect(normalizeUrl("not-a-url")).toBe("not-a-url");
  });
});

describe("urlsMatch", () => {
  it("returns true for identical urls", () => {
    expect(urlsMatch("https://example.com/a", "https://example.com/a")).toBe(
      true,
    );
  });

  it("returns true ignoring trailing slash", () => {
    expect(urlsMatch("https://example.com/a/", "https://example.com/a")).toBe(
      true,
    );
  });

  it("returns true ignoring search and hash", () => {
    expect(
      urlsMatch("https://example.com/a?q=1#top", "https://example.com/a"),
    ).toBe(true);
  });

  it("resolves a relative iframe src against the parent url", () => {
    expect(
      urlsMatch(
        "/embed/widget",
        "https://example.com/embed/widget",
        "https://example.com/host",
      ),
    ).toBe(true);
  });

  it("returns false for empty src", () => {
    expect(urlsMatch("", "https://example.com/a")).toBe(false);
  });

  it("returns false for about:blank iframes", () => {
    expect(urlsMatch("about:blank", "https://example.com/a")).toBe(false);
  });

  it("returns false for different origins", () => {
    expect(urlsMatch("https://other.com/a", "https://example.com/a")).toBe(
      false,
    );
  });

  it("returns false for different paths on same origin", () => {
    expect(urlsMatch("https://example.com/a", "https://example.com/b")).toBe(
      false,
    );
  });
});

describe("planFrameAnnouncementResponse", () => {
  const baseOpts = {
    tabId: 42,
    frameId: 0,
    isNewTopFrame: false,
    sidepanelConnected: false,
    curtainOn: false,
  };

  it("sends nothing when panel is closed and curtain is off", () => {
    expect(planFrameAnnouncementResponse(baseOpts)).toEqual([]);
  });

  it("re-asserts observing + focus tracker to the announcing frame when panel is connected", () => {
    // Cold-start / SW-revival race fix: every frame that announces itself
    // while the panel is open immediately gets SET_OBSERVING + SET_FOCUS_TRACKER,
    // so there is no window where the panel is open but the frame is idle.
    const plan = planFrameAnnouncementResponse({
      ...baseOpts,
      sidepanelConnected: true,
    });

    expect(plan).toEqual([
      {
        tabId: 42,
        frameId: 0,
        body: { type: "SET_OBSERVING", payload: { enabled: true } },
      },
      {
        tabId: 42,
        frameId: 0,
        body: { type: "SET_FOCUS_TRACKER", payload: { enabled: true } },
      },
    ]);
  });

  it("targets the specific announcing frame, not the whole tab", () => {
    // Important for iframes: the tracker needs to be enabled in every
    // frame that shows tracked elements, not only the top frame.
    const plan = planFrameAnnouncementResponse({
      ...baseOpts,
      frameId: 7,
      sidepanelConnected: true,
    });

    expect(plan[0]).toMatchObject({ tabId: 42, frameId: 7 });
  });

  it("re-applies the curtain when a new top frame appears and curtain was on", () => {
    // When the user navigates to a new URL, the tab's new top frame
    // doesn't inherit the curtain state — we push it back explicitly.
    const plan = planFrameAnnouncementResponse({
      ...baseOpts,
      isNewTopFrame: true,
      curtainOn: true,
    });

    expect(plan).toEqual([
      {
        tabId: 42,
        body: { type: "TOGGLE_CURTAIN", payload: { visible: true } },
      },
    ]);
  });

  it("does not re-apply the curtain to subframes", () => {
    const plan = planFrameAnnouncementResponse({
      ...baseOpts,
      frameId: 3,
      isNewTopFrame: false,
      curtainOn: true,
    });

    expect(plan.find((m) => m.body.type === "TOGGLE_CURTAIN")).toBeUndefined();
  });

  it("does not re-apply the curtain if it was off", () => {
    const plan = planFrameAnnouncementResponse({
      ...baseOpts,
      isNewTopFrame: true,
      curtainOn: false,
    });

    expect(plan.find((m) => m.body.type === "TOGGLE_CURTAIN")).toBeUndefined();
  });

  it("combines curtain + tracker messages when both conditions apply", () => {
    const plan = planFrameAnnouncementResponse({
      ...baseOpts,
      isNewTopFrame: true,
      sidepanelConnected: true,
      curtainOn: true,
    });

    expect(plan).toHaveLength(3);
    expect(plan.map((m) => m.body.type)).toEqual([
      "TOGGLE_CURTAIN",
      "SET_OBSERVING",
      "SET_FOCUS_TRACKER",
    ]);
  });
});

describe("planFrameHello", () => {
  it("sends nothing when the panel is closed (no observing on a page with no panel)", () => {
    expect(
      planFrameHello({ tabId: 42, frameId: 0, sidepanelConnected: false }),
    ).toEqual([]);
  });

  it("arms observing + focus tracker on the announcing frame when connected", () => {
    expect(
      planFrameHello({ tabId: 42, frameId: 0, sidepanelConnected: true }),
    ).toEqual([
      {
        tabId: 42,
        frameId: 0,
        body: { type: "SET_OBSERVING", payload: { enabled: true } },
      },
      {
        tabId: 42,
        frameId: 0,
        body: { type: "SET_FOCUS_TRACKER", payload: { enabled: true } },
      },
    ]);
  });

  it("targets the announcing subframe, not the whole tab", () => {
    const plan = planFrameHello({
      tabId: 42,
      frameId: 9,
      sidepanelConnected: true,
    });
    for (const item of plan) expect(item).toMatchObject({ frameId: 9 });
  });
});

// ─── planPanelDisconnectCleanup ─────────────────────────────────────────────

import { planPanelDisconnectCleanup } from "./routing.js";

describe("planPanelDisconnectCleanup", () => {
  it("disables the focus tracker and clears the highlight when curtain is off", () => {
    const plan = planPanelDisconnectCleanup({ tabId: 17, curtainOn: false });

    expect(plan.map((m) => m.body)).toEqual([
      { type: "SET_OBSERVING", payload: { enabled: false } },
      { type: "SET_FOCUS_TRACKER", payload: { enabled: false } },
      { type: "CLEAR_HIGHLIGHT" },
    ]);
    expect(plan.every((m) => m.tabId === 17)).toBe(true);
  });

  it("ALSO lifts the curtain when it was on", () => {
    // Regression: the curtain used to stay up after the panel closed,
    // leaving the user staring at a black overlay with no UI to dismiss it.
    const plan = planPanelDisconnectCleanup({ tabId: 17, curtainOn: true });

    const types = plan.map((m) => m.body.type);
    expect(types).toContain("TOGGLE_CURTAIN");

    const curtainMsg = plan.find((m) => m.body.type === "TOGGLE_CURTAIN");
    expect(curtainMsg?.body).toEqual({
      type: "TOGGLE_CURTAIN",
      payload: { visible: false },
    });
  });

  it("emits messages as tab-wide broadcasts (no frameId set)", () => {
    // The cleanup needs to reach every frame — main and sub. A frameId
    // would route only to one frame.
    const plan = planPanelDisconnectCleanup({ tabId: 17, curtainOn: true });

    for (const item of plan) {
      expect(item.frameId).toBeUndefined();
    }
  });
});
