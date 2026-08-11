import { describe, it, expect } from "vitest";

import {
  prefixNodeId,
  parseNodeId,
  normalizeUrl,
  urlsMatch,
  planFrameAnnouncementResponse,
  planHighlight,
  planFrameHello,
  isTrustedSender,
  resolvePanelTargetTab,
  shouldPanelAcceptMessage,
  describeBroadcastDelivery,
  isUnreachablePageResponse,
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

describe("isTrustedSender", () => {
  const OWN = "abcdefghijklmnopabcdefghijklmnop"; // our extension id

  it("accepts a message from our own extension (sender.id === ownId)", () => {
    expect(isTrustedSender({ id: OWN }, OWN)).toBe(true);
  });

  it("accepts even when the sender carries a tab (content-script message)", () => {
    // A content script's message still has sender.id === our extension id;
    // the extra sender.tab must not change the trust decision.
    const contentSender = { id: OWN, tab: { id: 5 } };
    expect(isTrustedSender(contentSender, OWN)).toBe(true);
  });

  it("rejects a foreign extension id", () => {
    expect(isTrustedSender({ id: "some-other-extension-id" }, OWN)).toBe(false);
  });

  it("rejects a sender with no id", () => {
    expect(isTrustedSender({}, OWN)).toBe(false);
  });

  it("rejects an undefined sender", () => {
    expect(isTrustedSender(undefined, OWN)).toBe(false);
  });

  it("rejects when our own id is unavailable, even if the sender also lacks one", () => {
    // Guards the undefined === undefined trap: no id on either side must
    // NOT read as trusted.
    expect(isTrustedSender({}, undefined)).toBe(false);
    expect(isTrustedSender(undefined, undefined)).toBe(false);
    expect(isTrustedSender({ id: "" }, "")).toBe(false);
  });
});

// ─── planPanelDisconnectCleanup ─────────────────────────────────────────────

import {
  planPanelDisconnectCleanup,
  planPanelDisconnectCleanupAllTabs,
} from "./routing.js";

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

describe("planPanelDisconnectCleanupAllTabs", () => {
  it("cleans up EVERY tab, not just the active one", () => {
    // Regression: disconnect used to tear down only the active tab, so a
    // background tab's curtain and focus overlays lingered after the panel
    // closed with no way to dismiss them.
    const plan = planPanelDisconnectCleanupAllTabs({
      tabIds: [1, 2, 3],
      curtainTabs: new Set(),
    });

    // three tabs × { SET_OBSERVING, SET_FOCUS_TRACKER, CLEAR_HIGHLIGHT }
    expect(plan).toHaveLength(9);
    for (const tabId of [1, 2, 3]) {
      const forTab = plan
        .filter((m) => m.tabId === tabId)
        .map((m) => m.body.type);
      expect(forTab).toEqual([
        "SET_OBSERVING",
        "SET_FOCUS_TRACKER",
        "CLEAR_HIGHLIGHT",
      ]);
    }
  });

  it("lifts the curtain only on tabs where it was on", () => {
    const plan = planPanelDisconnectCleanupAllTabs({
      tabIds: [1, 2],
      curtainTabs: new Set([2]),
    });

    const curtainTabs = plan
      .filter((m) => m.body.type === "TOGGLE_CURTAIN")
      .map((m) => m.tabId);
    expect(curtainTabs).toEqual([2]);
  });

  it("dedupes repeated tab ids", () => {
    const plan = planPanelDisconnectCleanupAllTabs({
      tabIds: [1, 1, 2, 1],
      curtainTabs: new Set(),
    });

    expect(plan).toHaveLength(6); // 2 unique tabs × 3 messages
    expect(new Set(plan.map((m) => m.tabId))).toEqual(new Set([1, 2]));
  });

  it("returns an empty plan when no tab has state", () => {
    expect(
      planPanelDisconnectCleanupAllTabs({ tabIds: [], curtainTabs: new Set() }),
    ).toEqual([]);
  });
});

describe("resolvePanelTargetTab", () => {
  it("prefers the panel-stamped tabId over activeTabId", () => {
    // After a tab switch, activeTabId flips before the panel clears —
    // stamping the bound tab keeps DISPATCH_ACTION on the right page.
    expect(resolvePanelTargetTab(10, 99)).toBe(10);
  });

  it("falls back to activeTabId when the message has no tabId", () => {
    expect(resolvePanelTargetTab(undefined, 42)).toBe(42);
  });

  it("returns null when neither source has a tab", () => {
    expect(resolvePanelTargetTab(undefined, null)).toBeNull();
  });
});

describe("planHighlight", () => {
  it("previews on hover: no page scroll and no real focus move", () => {
    // Hover and select used to share one behaviour, so sweeping the pointer
    // down the tree scroll-jumped the host page and fired its focus/blur
    // handlers once per row crossed.
    expect(planHighlight({ hover: true })).toEqual({
      scroll: false,
      moveFocus: false,
    });
  });

  it("scrolls and moves focus for a selection", () => {
    expect(planHighlight({ hover: false })).toEqual({
      scroll: true,
      moveFocus: true,
    });
  });

  it("treats an absent hover flag as a selection", () => {
    // Older panel builds omit the flag entirely; selection is the safe default
    // because it preserves the click/arrow-key behaviour.
    expect(planHighlight({})).toEqual({ scroll: true, moveFocus: true });
  });
});

describe("shouldPanelAcceptMessage", () => {
  const MY_TAB = 7;

  describe("the frame-scoped events reach the panel twice", () => {
    // One `focusin` inside an iframe produces TWO deliveries to the panel:
    // the content script's own sendMessage (frame-LOCAL id, no tabId stamp)
    // and the background's forward (frame-PREFIXED id, tabId stamped). The
    // panel must act on the prefixed one only — `sn-3` from frame 2 is a
    // different, unrelated node in the merged tree's top-frame portion, and
    // selecting it force-expands its ancestors. The prefixed forward then
    // fixes the selection but not those expansions, whichever order the two
    // arrive in.
    const deliveriesFor = (type: string) => [
      // direct from the iframe's content script
      { type, messageTabId: undefined, senderTabId: MY_TAB, myTabId: MY_TAB },
      // relayed by the background
      { type, messageTabId: MY_TAB, senderTabId: undefined, myTabId: MY_TAB },
    ];

    it.each(["FOCUS_CHANGED", "NODE_PICKED"])(
      "accepts exactly one of the two %s deliveries — the relayed one",
      (type) => {
        expect(deliveriesFor(type).map(shouldPanelAcceptMessage)).toEqual([
          false,
          true,
        ]);
      },
    );

    it.each(["FOCUS_CHANGED", "NODE_PICKED"])(
      "drops the direct %s copy from the top frame too",
      (type) => {
        // Frame 0 ids are unprefixed, so the direct copy looks harmless — but
        // accepting it still double-handles every focus change, and the rule
        // is not worth making frame-dependent when the panel cannot tell
        // which frame a direct copy came from.
        expect(
          shouldPanelAcceptMessage({
            type,
            senderTabId: MY_TAB,
            myTabId: MY_TAB,
          }),
        ).toBe(false);
      },
    );

    it.each(["FOCUS_CHANGED", "NODE_PICKED"])(
      "drops the direct %s copy before the panel knows its tab",
      (type) => {
        // The duplicate is wrong regardless of tab binding, so the relay
        // requirement is not conditional on myTabId being known.
        expect(
          shouldPanelAcceptMessage({
            type,
            senderTabId: MY_TAB,
            myTabId: null,
          }),
        ).toBe(false);
      },
    );
  });

  describe("content-direct messages that are not frame-scoped", () => {
    it("accepts LIVE_REGION straight from the content script", () => {
      // LIVE_REGION is the mirror case: the background no-ops its forward,
      // so the direct copy is the only one — and its payload is text, not an
      // id, so there is nothing to prefix.
      expect(
        shouldPanelAcceptMessage({
          type: "LIVE_REGION",
          senderTabId: MY_TAB,
          myTabId: MY_TAB,
        }),
      ).toBe(true);
    });

    it("drops LIVE_REGION from another tab", () => {
      expect(
        shouldPanelAcceptMessage({
          type: "LIVE_REGION",
          senderTabId: 99,
          myTabId: MY_TAB,
        }),
      ).toBe(false);
    });
  });

  describe("tab scoping", () => {
    it("drops a relayed message stamped with another tab", () => {
      expect(
        shouldPanelAcceptMessage({
          type: "TREE_DATA",
          messageTabId: 99,
          myTabId: MY_TAB,
        }),
      ).toBe(false);
    });

    it("accepts a relayed message stamped with our tab", () => {
      expect(
        shouldPanelAcceptMessage({
          type: "TREE_DATA",
          messageTabId: MY_TAB,
          myTabId: MY_TAB,
        }),
      ).toBe(true);
    });

    it("prefers the message stamp over the sender's tab", () => {
      expect(
        shouldPanelAcceptMessage({
          type: "TREE_DATA",
          messageTabId: MY_TAB,
          senderTabId: 99,
          myTabId: MY_TAB,
        }),
      ).toBe(true);
    });

    it("accepts a message with no tab on either side", () => {
      // Panel-internal and future message types have nothing to compare.
      expect(
        shouldPanelAcceptMessage({ type: "TREE_DATA", myTabId: MY_TAB }),
      ).toBe(true);
    });

    it("accepts anything before the panel has learned its tab", () => {
      expect(
        shouldPanelAcceptMessage({
          type: "TREE_DATA",
          messageTabId: 99,
          myTabId: null,
        }),
      ).toBe(true);
    });
  });

  it("never filters ACTIVE_TAB_CHANGED — it is how the panel learns its tab", () => {
    expect(
      shouldPanelAcceptMessage({
        type: "ACTIVE_TAB_CHANGED",
        messageTabId: 99,
        myTabId: MY_TAB,
      }),
    ).toBe(true);
  });
});

describe("describeBroadcastDelivery", () => {
  it("reports success when the send callback saw no error", () => {
    expect(describeBroadcastDelivery(undefined)).toEqual({ success: true });
  });

  it("reports a restricted page when nothing in the tab received it", () => {
    expect(
      describeBroadcastDelivery({
        message:
          "Could not establish connection. Receiving end does not exist.",
      }),
    ).toEqual({ success: false, error: "restricted-page" });
  });

  it("does not call a vanished tab a restricted page", () => {
    // A re-extract queued before the user closed the tab lands after it is
    // gone. That is a failure, but telling the user Chrome forbids
    // extensions on this page would be a lie.
    expect(
      describeBroadcastDelivery({ message: "No tab with id: 42." }),
    ).toEqual({ success: false, error: "No tab with id: 42." });
  });

  it("still fails, with a placeholder, when the error carries no message", () => {
    expect(describeBroadcastDelivery({})).toEqual({
      success: false,
      error: "send failed",
    });
  });
});

describe("isUnreachablePageResponse", () => {
  it("recognises the background's restricted-page reply", () => {
    expect(
      isUnreachablePageResponse({ success: false, error: "restricted-page" }),
    ).toBe(true);
  });

  it("rejects a success reply", () => {
    expect(isUnreachablePageResponse({ success: true })).toBe(false);
  });

  it("rejects a failure for some other reason", () => {
    // "No active tab" is a panel-side race, and "No tab with id" is a tab
    // that closed — neither is a page the extension can never reach, so
    // rendering the restricted-page message for them would be wrong.
    expect(
      isUnreachablePageResponse({ success: false, error: "No active tab" }),
    ).toBe(false);
    expect(
      isUnreachablePageResponse({
        success: false,
        error: "No tab with id: 42.",
      }),
    ).toBe(false);
  });

  it("rejects a missing reply", () => {
    // The reply is `undefined` when the MV3 worker died before answering.
    expect(isUnreachablePageResponse(undefined)).toBe(false);
    expect(isUnreachablePageResponse(null)).toBe(false);
  });
});
