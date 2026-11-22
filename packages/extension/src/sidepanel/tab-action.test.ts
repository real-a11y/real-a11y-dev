import type { ActionType } from "@real-a11y-dev/core";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { FeedbackTarget } from "./action-feedback.js";
import { dispatchTabAction, replyWithholdsChoice } from "./tab-action.js";

/** A panel whose content script answers the action with `reply`. Returns the
 *  lines announced, in order, and whether the page is read again. */
function panelAnswering(reply?: unknown) {
  const lines: string[] = [];
  let pending: ((response: unknown) => void) | undefined;
  const reExtract = vi.fn();
  return {
    lines,
    reExtract,
    /** The content script's answer arrives. */
    answer: () => pending?.(reply),
    panel: {
      send: (_message: unknown, respond: (response: unknown) => void) => {
        pending = respond;
      },
      announce: (text: string) => lines.push(text),
      reExtract,
    },
  };
}

function act(target: FeedbackTarget, action: ActionType, reply?: unknown) {
  const p = panelAnswering(reply);
  dispatchTabAction({ nodeId: "n1", action }, target, p.panel);
  const before = [...p.lines];
  p.answer();
  return { before, after: p.lines, reExtract: p.reExtract };
}

describe("dispatchTabAction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: { lastError: undefined },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it("says what an ordinary action did as it is sent", () => {
    const { before, after } = act(
      { role: "button", name: "Save", states: {} },
      "click",
      { success: true, choiceWithheld: false },
    );
    expect(before).toEqual(["Click: Save"]);
    expect(after).toEqual(["Click: Save"]);
  });

  it("names no item picked where the page withholds its choice", () => {
    for (const role of [
      "option",
      "treeitem",
      "radio",
      "menuitemradio",
      "menuitemcheckbox",
    ]) {
      const { before, after } = act(
        { role, name: "03/31", states: {} },
        "click",
        { success: true, choiceWithheld: true },
      );
      // Nothing until the page says: the row can't tell.
      expect(before, role).toEqual([]);
      expect(after, role).toEqual(["Selected an option in this field"]);
    }
  });

  it("names an ordinary choice item once the page says it may", () => {
    expect(
      act({ role: "treeitem", name: "Docs", states: {} }, "click", {
        success: true,
        choiceWithheld: false,
      }).after,
    ).toEqual(["Click: Docs"]);
    expect(
      act({ role: "radio", name: "Small", states: {} }, "click", {
        success: true,
        choiceWithheld: false,
      }).after,
    ).toEqual(["Selected: Small"]);
  });

  it("names no item when the reply doesn't say", () => {
    for (const reply of [undefined, { success: true }]) {
      expect(
        act({ role: "option", name: "03", states: {} }, "click", reply).after,
      ).toEqual(["Selected an option in this field"]);
    }
  });

  it("reports a refusal or an undelivered message instead", () => {
    expect(
      act({ role: "option", name: "03", states: {} }, "click", {
        success: false,
        error: "Element no longer in DOM",
        choiceWithheld: false,
      }).after,
    ).toEqual(["Failed: Element no longer in DOM"]);

    (globalThis as { chrome: { runtime: { lastError?: unknown } } }).chrome = {
      runtime: { lastError: { message: "Frame not available" } },
    };
    expect(
      act({ role: "button", name: "Save", states: {} }, "click").after,
    ).toEqual(["Click: Save", "Failed: Frame not available"]);
  });

  it("says nothing for a step but reads the page again", () => {
    const { after, reExtract } = act(
      { role: "slider", name: "Volume", states: {} },
      "increment",
      { success: true, choiceWithheld: false },
    );
    expect(after).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(reExtract).toHaveBeenCalledTimes(1);
  });
});

describe("replyWithholdsChoice", () => {
  it("is false only when the reply says so", () => {
    expect(replyWithholdsChoice({ success: true, choiceWithheld: false })).toBe(
      false,
    );
    expect(replyWithholdsChoice({ success: true, choiceWithheld: true })).toBe(
      true,
    );
    expect(replyWithholdsChoice({ success: true })).toBe(true);
    expect(replyWithholdsChoice(undefined)).toBe(true);
  });
});
