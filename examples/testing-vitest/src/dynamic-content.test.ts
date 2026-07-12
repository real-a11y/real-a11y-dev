import { afterEach, describe, expect, it, vi } from "vitest";

import { auditSnapshot, waitForMutations } from "@real-a11y-dev/testing";

import { fixture, cleanup } from "./fixtures.js";

/**
 * Testing content that updates *over time* — toasts arriving, a progress log
 * filling in, a chat/AI response streaming token by token.
 *
 * `waitForMutations(root, { timeout, debounceMs })` wraps the same
 * `DomObserver` the live extension uses: it resolves once the DOM has been
 * quiet for `debounceMs`, or at `timeout`, whichever comes first. Then you
 * assert on the settled tree.
 *
 * Fake timers keep these deterministic — jsdom's real-time mutation timing is
 * fragile, so we drive the clock explicitly rather than sleeping.
 */
describe("waitForMutations — content that updates over time", () => {
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  /** A live-region entry (renders as `paragraph "<text>"` in the tree). */
  function entry(text: string): HTMLParagraphElement {
    const p = document.createElement("p");
    p.textContent = text;
    return p;
  }

  it("waits for a burst of updates to settle, then sees the final tree", async () => {
    vi.useFakeTimers();
    const root = fixture(
      `<section role="log" aria-label="Activity"></section>`,
    );
    const feed = root.querySelector('[role="log"]')!;

    const settled = waitForMutations(root, { timeout: 1000, debounceMs: 50 });

    // Two updates arrive 20ms apart — faster than the 50ms debounce — then
    // the feed goes quiet.
    feed.appendChild(entry("Draft saved"));
    await vi.advanceTimersByTimeAsync(20);
    feed.appendChild(entry("Synced to cloud"));
    await vi.advanceTimersByTimeAsync(60); // 60ms of quiet (> 50ms) → settles

    await settled;

    // The settled tree reflects BOTH updates, not just the first.
    const tree = auditSnapshot(root);
    expect(tree).toContain("Draft saved");
    expect(tree).toContain("Synced to cloud");
  });

  it("resolves at the timeout with the current tree when a stream never settles", async () => {
    vi.useFakeTimers();
    const root = fixture(
      `<section role="log" aria-label="Streaming response"></section>`,
    );
    const feed = root.querySelector('[role="log"]')!;

    const settled = waitForMutations(root, { timeout: 200, debounceMs: 50 });

    // A response that streams tokens faster than the debounce and never pauses.
    // A trailing-only debounce would keep resetting and never fire — but
    // `waitForMutations` still resolves, at `timeout`, with the tree in its
    // CURRENT (not final) state. The lesson: for a never-settling stream you
    // assert at a bounded deadline instead of waiting for the tree to "finish".
    const stream = setInterval(() => feed.appendChild(entry("token")), 20);
    await vi.advanceTimersByTimeAsync(200);
    clearInterval(stream);

    await settled; // resolved at the deadline, not hung

    const tree = auditSnapshot(root);
    expect(tree).toContain("token");
    expect(feed.querySelectorAll("p").length).toBeGreaterThan(1);
  });
});
