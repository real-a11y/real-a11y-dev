import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  TYPE_AHEAD_TIMEOUT_MS,
  createTypeAheadBuffer,
  findTypeAheadIndex,
  isTypeAheadKey,
} from "./typeAhead.js";

describe("findTypeAheadIndex", () => {
  const labels = ["Apple", "Apricot", "Banana", "Blueberry", "Cherry"];

  it("moves to the next label starting with the typed character", () => {
    // From Apple (0), "b" → Banana (2)
    expect(findTypeAheadIndex(labels, "b", 0)).toBe(2);
  });

  it("wraps around when searching past the end", () => {
    // From Cherry (4), "a" → Apple (0)
    expect(findTypeAheadIndex(labels, "a", 4)).toBe(0);
  });

  it("keeps the current item when a multi-character prefix still matches", () => {
    // From Apple (0), "ap" stays on Apple (inclusive search) — not Apricot
    expect(findTypeAheadIndex(labels, "ap", 0)).toBe(0);
  });

  it("finds the next multi-character match when the current item no longer matches", () => {
    // From Banana (2), "ap" → Apple (0) via wrap
    expect(findTypeAheadIndex(labels, "ap", 2)).toBe(0);
  });

  it("cycles on repeated same character instead of looking for 'bb'", () => {
    // Buffer "bb" with all-same chars → treat as "b"; from Banana (2) → Blueberry (3)
    expect(findTypeAheadIndex(labels, "bb", 2)).toBe(3);
  });

  it("returns -1 when nothing matches", () => {
    expect(findTypeAheadIndex(labels, "z", 0)).toBe(-1);
  });

  it("starts from the beginning when currentIndex is -1", () => {
    expect(findTypeAheadIndex(labels, "b", -1)).toBe(2);
  });
});

describe("createTypeAheadBuffer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("appends characters and clears after the idle timeout", () => {
    const buf = createTypeAheadBuffer(TYPE_AHEAD_TIMEOUT_MS);
    expect(buf.push("A")).toBe("a");
    expect(buf.push("p")).toBe("ap");
    vi.advanceTimersByTime(TYPE_AHEAD_TIMEOUT_MS);
    expect(buf.get()).toBe("");
  });

  it("resets the idle timer on each keystroke", () => {
    const buf = createTypeAheadBuffer(TYPE_AHEAD_TIMEOUT_MS);
    buf.push("a");
    vi.advanceTimersByTime(TYPE_AHEAD_TIMEOUT_MS - 1);
    buf.push("p");
    vi.advanceTimersByTime(TYPE_AHEAD_TIMEOUT_MS - 1);
    expect(buf.get()).toBe("ap");
  });
});

describe("isTypeAheadKey", () => {
  function key(init: KeyboardEventInit): KeyboardEvent {
    return new KeyboardEvent("keydown", init);
  }

  it("accepts a plain letter", () => {
    expect(isTypeAheadKey(key({ key: "a" }))).toBe(true);
  });

  it("rejects Space, slash, modifiers, and multi-char keys", () => {
    expect(isTypeAheadKey(key({ key: " " }))).toBe(false);
    expect(isTypeAheadKey(key({ key: "/" }))).toBe(false);
    expect(isTypeAheadKey(key({ key: "a", ctrlKey: true }))).toBe(false);
    expect(isTypeAheadKey(key({ key: "ArrowDown" }))).toBe(false);
  });
});
