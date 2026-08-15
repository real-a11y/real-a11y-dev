import { render, h } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import type { ContentToPanel } from "../types.js";

import { App } from "./App.js";
import type { ChromeMock } from "./panel-harness.js";
import {
  TAB_ID,
  installChromeMock,
  stubMatchMedia,
  treeData,
} from "./panel-harness.js";

/**
 * A live region is announced when its *contents* change while the region is
 * already in the accessibility tree. A region that enters the DOM with its text
 * already inside it is, for most screen reader / browser pairs, not announced
 * at all — so the panel whose whole job is relaying the page's live regions was
 * silently dropping its own three.
 *
 * The three containers therefore stay mounted for the life of the panel and
 * only their contents swap. Both halves of that matter, so both are pinned
 * here: the container is present while it is still empty, and the element that
 * later holds the text is the *same node* that was already there.
 */

describe("panel live regions", () => {
  let container: HTMLDivElement;
  let chromeMock: ChromeMock;

  beforeEach(() => {
    stubMatchMedia();
    chromeMock = installChromeMock();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  function region(selector: string): HTMLElement {
    const el = container.querySelector(selector);
    if (!el) throw new Error(`live region ${selector} is not mounted`);
    return el as HTMLElement;
  }

  /** Panel with a tree loaded and no action taken yet. */
  function mountIdlePanel(): void {
    act(() => {
      render(h(App, {}), container);
    });
    act(() => {
      chromeMock.emit({
        type: "ACTIVE_TAB_CHANGED",
        tabId: TAB_ID,
      } as unknown as ContentToPanel);
    });
    act(() => {
      chromeMock.emit(treeData());
    });
  }

  it("mounts all three live regions empty, before there is anything to say", () => {
    mountIdlePanel();

    for (const selector of [
      ".sn-search-count",
      ".sn-action-feedback",
      ".sn-live-log",
    ]) {
      // Each of these used to be mounted only alongside its own content, which
      // is the one arrangement a live region cannot be announced from.
      expect(region(selector).textContent).toBe("");
    }
  });

  it("keeps the action bar assertive, so a failure is not queued behind chatter", () => {
    mountIdlePanel();

    const feedback = region(".sn-action-feedback");
    expect(feedback.getAttribute("role")).toBe("status");
    // An explicit aria-live overrides what the role implies, which is the
    // point: the failures this bar carries are pulled back out of the DOM
    // after 2.5s, too soon to wait behind a polite queue.
    expect(feedback.getAttribute("aria-live")).toBe("assertive");
  });

  it("announces an action through the region that was already mounted", () => {
    mountIdlePanel();
    const before = region(".sn-action-feedback");

    act(() => {
      const esc = [...container.querySelectorAll("button.sn-key-btn")].find(
        (b) => b.textContent?.trim() === "Esc",
      );
      if (!esc) throw new Error("no Esc key button rendered");
      (esc as HTMLButtonElement).click();
    });

    expect(region(".sn-action-feedback").textContent).toContain("Sent key");
    // The text has to land in the node that was already there. A fresh node
    // carrying the text is exactly the case AT does not announce.
    expect(region(".sn-action-feedback")).toBe(before);
  });

  it("announces a relayed page announcement through the mounted log", () => {
    mountIdlePanel();
    const before = region(".sn-live-log");

    act(() => {
      chromeMock.emit({
        type: "LIVE_REGION",
        tabId: TAB_ID,
        payload: { text: "3 results", level: "polite", role: "status" },
      } as unknown as ContentToPanel);
    });

    expect(region(".sn-live-log").textContent).toContain("3 results");
    expect(region(".sn-live-log")).toBe(before);
  });

  it("announces the search match count through the mounted region", () => {
    mountIdlePanel();
    const before = region(".sn-search-count");

    act(() => {
      const input = container.querySelector(
        "input.sn-search",
      ) as HTMLInputElement;
      input.value = "Save";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(region(".sn-search-count").textContent).toContain("match");
    expect(region(".sn-search-count")).toBe(before);
  });
});
