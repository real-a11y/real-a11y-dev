---
title: "Accessibility-Driven Development"
description: Build with the accessibility tree in view — inspect what assistive tech perceives as you code, and fix semantics at author-time instead of in an audit before ship.
---

# Accessibility-Driven Development

You wouldn't build a UI with the DevTools console closed. **Accessibility-Driven Development** means building with the *accessibility tree* just as visible — the roles, names, states, and focus order your users actually depend on become something you watch and shape while you code, not something you discover in an audit weeks later.

## The gap it closes

On most teams, accessibility is checked **late** — a pre-launch audit, a ticket after a complaint, or never. By then the mistakes are structural and expensive: the `<div onclick>` that should have been a `<button>`, the icon with no name, the modal that doesn't trap focus. They were cheap to fix the moment they were written — and impossible to see at that moment, because **the accessibility tree is invisible in a normal dev loop.** You can read your JSX; you can't read what a screen reader will make of it until you stop and run axe or boot a screen reader.

Accessibility-Driven Development makes that tree visible *in the loop you're already in.*

## See the tree while you build

The practice is simple: keep the semantic tree on screen next to your app, and watch it update as you work. Build a component, glance at its tree — is that really a `button "Save"`, or a `generic`? Does the heading say `(level 2)` or did it jump from `h1` to `h4`? Is the new field reachable in the tab order? You catch the answer while the code is still under your cursor.

Real A11y renders that tree from **one engine**, in whichever context you already work:

- **[Chrome extension](/guide/chrome-extension)** — any page, any app, zero setup. Inspect the tree, interact through it, and pull the **screen curtain** to experience the page with the visual layer gone.
- **[`@real-a11y-dev/react`](/packages/react)** — drop `<SemanticNavigator />` (or the `useSemanticTree` hook) into your app; the tree updates live as your components re-render.
- **[`@real-a11y-dev/inspector`](/packages/inspector)** — the same panel, framework-agnostic, gated to your dev build.
- **[`@real-a11y-dev/storybook-addon`](/packages/storybook-addon)** — every story gets a tree panel, so component-level accessibility is something you develop alongside the design system, one component at a time.

Same extraction everywhere — what you see in the panel is exactly what you'll later commit as a snapshot.

## The test that fits in the loop

There's a single question that turns inspection into a workflow:

> **If you can complete the task through the accessibility tree, your users probably can too. If you can't — that's the bug.**

Try to check out, submit the form, close the dialog — using the tree, not the visual UI. Dispatch actions through it; send keys with the keyboard bar. When you can't find the control or can't tell if the action worked, stop: that's not a hypothetical, it's the exact wall your screen-reader users hit. The **curtain** makes it unavoidable — black out the page and the only way through is the semantics you built.

## It doesn't replace a screen reader

This is the fast, structural first pass — missing names, wrong roles, broken tab order, unlabeled landmarks — the large and mechanical class of problems, caught where every developer already works. It does **not** reproduce how NVDA, VoiceOver, or JAWS actually announce your app. Use this to ship far fewer bugs into the real-AT testing you still do before release; it makes those sessions shorter, not optional.

## From dev to CI

The tree you inspect while building is byte-identical to the one you can assert on and commit — so the natural next step is to lock it in: the same structure becomes a snapshot and a set of assertions that fail the build if anyone regresses it. That's [**Accessibility-Driven Testing**](/concepts/accessibility-driven-testing).

## Start here

- **Any app, right now** → the [Chrome extension](/guide/chrome-extension)
- **In your React app** → [`@real-a11y-dev/react`](/packages/react)
- **In your design system** → [`@real-a11y-dev/storybook-addon`](/packages/storybook-addon)
- **New to the tree itself?** → [Reading the A11y view](/guide/reading-the-a11y-view)
