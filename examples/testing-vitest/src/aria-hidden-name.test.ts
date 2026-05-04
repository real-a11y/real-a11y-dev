import { describe, it, expect, afterEach } from "vitest";

import { extractA11yTree } from "@real-a11y-dev/core";

import { fixture, cleanup } from "./fixtures.js";

afterEach(cleanup);

/**
 * Hidden-subtree assertions for the accessible-name computation. Per
 * WAI-ARIA accname-1.2 §4.3.2 step 2A, descendants that are aria-hidden,
 * `[hidden]`, `inert`, or CSS-hidden contribute the empty string when
 * computing a parent's accessible name. These tests double as a recipe:
 * paste them into your own audit suite to lock in the patterns where
 * decorative SVGs, icon-only buttons, and status badges sit alongside
 * the real label.
 */
describe("accessible name skips aria-hidden subtrees", () => {
  it("logo link with aria-label override + aria-hidden SVG wordmark", () => {
    // Common pattern: an <a> wraps a brand-mark SVG. The SVG is decorative
    // (aria-hidden), so AT should announce only the aria-label, not the
    // SVG's <text> fallback content.
    const root = fixture(`
      <a href="/" aria-label="Real A11y — go to home">
        <svg aria-hidden="true" viewBox="0 0 100 20">
          <text x="0" y="14">real a11y</text>
        </svg>
      </a>
    `);

    const { nodes } = extractA11yTree(root);
    const link = [...nodes.values()].find((n) => n.a11y.role === "link")!;

    expect(link.a11y.name).toBe("Real A11y — go to home");
  });

  it("icon button with sr-only label + aria-hidden SVG", () => {
    // Decorative SVG glyph + visually-hidden text label. AT should announce
    // only the sr-only text, never the SVG's path/text content.
    const root = fixture(`
      <button type="button">
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="M8 1l7 14H1z" />
          <text x="0" y="14">warn</text>
        </svg>
        <span class="sr-only">Show warnings</span>
      </button>
    `);

    const { nodes } = extractA11yTree(root);
    const btn = [...nodes.values()].find((n) => n.a11y.role === "button")!;

    expect(btn.a11y.name.replace(/\s+/g, " ").trim()).toBe("Show warnings");
  });

  it("status badge link — aria-hidden dot does not leak into name", () => {
    // The colored dot is purely visual. The link's name should be
    // "Status: degraded", not "● Status: degraded".
    const root = fixture(`
      <a href="/status">
        <span aria-hidden="true">●</span>
        <span>Status: degraded</span>
      </a>
    `);

    const { nodes } = extractA11yTree(root);
    const link = [...nodes.values()].find((n) => n.a11y.role === "link")!;

    expect(link.a11y.name.replace(/\s+/g, " ").trim()).toBe("Status: degraded");
  });

  it("[hidden] descendant in a heading is skipped", () => {
    // The "DRAFT" badge is hidden when published; AT shouldn't announce it
    // even if it sits in the DOM with display:none-equivalent semantics.
    const root = fixture(`
      <h1>
        <span hidden>DRAFT</span>
        Q3 launch retrospective
      </h1>
    `);

    const { nodes } = extractA11yTree(root);
    const h1 = [...nodes.values()].find((n) => n.a11y.role === "heading")!;

    expect(h1.a11y.name.replace(/\s+/g, " ").trim()).toBe(
      "Q3 launch retrospective",
    );
  });

  it("aria-label override still wins (regression sanity)", () => {
    // Even without aria-hidden, an explicit aria-label on the parent takes
    // priority over name-from-content per accname-1.2 step 2C.
    const root = fixture(`
      <button aria-label="Close dialog">
        <span>×</span>
      </button>
    `);

    const { nodes } = extractA11yTree(root);
    const btn = [...nodes.values()].find((n) => n.a11y.role === "button")!;

    expect(btn.a11y.name).toBe("Close dialog");
  });
});
