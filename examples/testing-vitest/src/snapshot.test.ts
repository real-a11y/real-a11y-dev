import { describe, it, expect, afterEach } from "vitest";
import {
  auditSnapshot,
  outlineSnapshot,
  tabSequenceSnapshot,
} from "@real-a11y-dev/testing";
import { fixture, cleanup } from "./fixtures.js";

afterEach(cleanup);

describe("auditSnapshot", () => {
  it("captures the full a11y tree of a form", () => {
    const root = fixture(`
      <main>
        <h1>Sign in</h1>
        <form aria-label="Sign-in form">
          <label>
            Email
            <input type="email" />
          </label>
          <label>
            Password
            <input type="password" />
          </label>
          <button type="submit">Sign in</button>
          <a href="/forgot">Forgot password?</a>
        </form>
      </main>
    `);

    // Use toMatchSnapshot() so Vitest writes the canonical value on first run.
    // The output includes all roles, names, and heading levels.
    const snapshot = auditSnapshot(root);
    expect(snapshot).toContain('heading "Sign in"');
    expect(snapshot).toContain('form "Sign-in form"');
    expect(snapshot).toContain('button "Sign in"');
    expect(snapshot).toContain('link "Forgot password?"');
    expect(snapshot).toMatchSnapshot();
  });

  it("supports dom mode", () => {
    const root = fixture(`
      <nav>
        <a href="/">Home</a>
        <a href="/about">About</a>
      </nav>
    `);
    const snapshot = auditSnapshot(root, { mode: "dom" });
    expect(snapshot).toContain("nav");
    expect(snapshot).toContain("a");
  });

  it("redacts dynamic values", () => {
    const root = fixture(`
      <p>Order ID: 8f3a-2b91-cc40</p>
    `);
    const snapshot = auditSnapshot(root, {
      redact: [/[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}/gi],
    });
    // The implementation uppercases the placeholder: [REDACTED]
    expect(snapshot.toLowerCase()).toContain("[redacted]");
    expect(snapshot).not.toContain("8f3a");
  });
});

describe("outlineSnapshot", () => {
  it("formats a nested heading outline", () => {
    const root = fixture(`
      <article>
        <h1>Introduction</h1>
        <h2>Getting started</h2>
        <h2>Configuration</h2>
        <h3>Advanced options</h3>
        <h2>API reference</h2>
      </article>
    `);

    const outline = outlineSnapshot(root);
    expect(outline).toContain("Introduction");
    expect(outline).toContain("Getting started");
    expect(outline).toContain("Advanced options");
    expect(outline).toMatchSnapshot();
  });
});

describe("tabSequenceSnapshot", () => {
  it("lists focusable elements in order", () => {
    const root = fixture(`
      <div>
        <a href="/skip">Skip to content</a>
        <nav>
          <a href="/">Home</a>
          <a href="/about">About</a>
        </nav>
        <main>
          <input type="search" aria-label="Search" />
          <button type="submit">Go</button>
        </main>
      </div>
    `);

    const snapshot = tabSequenceSnapshot(root);
    expect(snapshot).toContain("Skip to content");
    expect(snapshot).toContain("Home");
    expect(snapshot).toContain("Search");
    expect(snapshot).toContain("Go");
  });
});
