/**
 * Coverage for `pickStoryRoot`, the helper the preview-side extractor
 * uses to decide where to root the tree (and where to attach the
 * DomObserver) for the current story. Regression suite for the bug
 * surfaced by PR #80's React Aria patterns — `firstElementChild` of
 * `#storybook-root` landed on React Aria's `<template>` collection
 * source, the extractor walked an empty subtree and reported "Empty
 * tree", and the observer scoped to that template missed all
 * mutations in the actual `[role="listbox"]` / `[role="combobox"]`
 * sibling so selections never propagated.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { pickStoryRoot } from "./preview.js";

function makeStorybookRoot(): HTMLElement {
  const root = document.createElement("div");
  root.id = "storybook-root";
  document.body.appendChild(root);
  return root;
}

describe("pickStoryRoot", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("falls back to document.body when #storybook-root is absent", () => {
    expect(pickStoryRoot(document)).toBe(document.body);
  });

  it("returns #storybook-root itself when it has no children (story not rendered yet)", () => {
    const sb = makeStorybookRoot();
    expect(pickStoryRoot(document)).toBe(sb);
  });

  it("returns the single real child when the story has exactly one root element", () => {
    // Common case — a plain `<Button>` story. Skipping the wrapper keeps
    // the tree free of the `#storybook-root` div on simple stories.
    const sb = makeStorybookRoot();
    const button = document.createElement("button");
    button.textContent = "Click me";
    sb.appendChild(button);
    expect(pickStoryRoot(document)).toBe(button);
  });

  it("skips a leading <template> and picks the next real child (React Aria collection pattern)", () => {
    // React Aria's <Tree>/<ListBox>/<ComboBox> mount a <template> for the
    // collection builder ahead of the actual rendered widget. Without
    // skipping it, the addon used to land on the empty template and
    // report "Empty tree".
    const sb = makeStorybookRoot();
    const tmpl = document.createElement("template");
    const widget = document.createElement("div");
    widget.setAttribute("role", "treegrid");
    sb.appendChild(tmpl);
    sb.appendChild(widget);
    expect(pickStoryRoot(document)).toBe(widget);
  });

  it("also skips <script>, <style>, and <noscript> when picking the single real child", () => {
    const sb = makeStorybookRoot();
    sb.appendChild(document.createElement("script"));
    sb.appendChild(document.createElement("style"));
    sb.appendChild(document.createElement("noscript"));
    const widget = document.createElement("section");
    sb.appendChild(widget);
    expect(pickStoryRoot(document)).toBe(widget);
  });

  it("falls back to #storybook-root when two real children survive the filter", () => {
    // React Aria's Tree etc. typically render <template> + focus-guard
    // <span> + actual widget + trailing focus-guard <span>. After
    // skipping <template>, three real children remain — the addon must
    // root at the wrapper so the observer sees ALL of them and the tree
    // surfaces the actual widget alongside its siblings.
    const sb = makeStorybookRoot();
    const tmpl = document.createElement("template");
    const guard1 = document.createElement("span");
    const widget = document.createElement("div");
    widget.setAttribute("role", "treegrid");
    const guard2 = document.createElement("span");
    sb.append(tmpl, guard1, widget, guard2);
    expect(pickStoryRoot(document)).toBe(sb);
  });

  it("falls back to #storybook-root when zero real children remain (template only)", () => {
    // Edge case: only a <template> is mounted (mid-render). Better to
    // root at the wrapper so the observer is already in place when the
    // actual content arrives, rather than rooting at the doomed-to-be-
    // skipped template.
    const sb = makeStorybookRoot();
    sb.appendChild(document.createElement("template"));
    expect(pickStoryRoot(document)).toBe(sb);
  });

  it("ignores text nodes when counting real children", () => {
    // Whitespace and stray text nodes shouldn't shift the picker between
    // single-child and multi-child modes — `children` is element-only, so
    // this is asserting the intended `children` semantics, not testing
    // anything we add. Belt-and-suspenders.
    const sb = makeStorybookRoot();
    sb.appendChild(document.createTextNode("  \n  "));
    const widget = document.createElement("button");
    sb.appendChild(widget);
    sb.appendChild(document.createTextNode("\n"));
    expect(pickStoryRoot(document)).toBe(widget);
  });
});
