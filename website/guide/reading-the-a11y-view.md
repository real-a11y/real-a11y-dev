---
title: Reading the A11y View
description: How to interpret the accessibility tree — what a screen reader actually perceives, with roles, names, and ARIA states. Applies across every Real A11y surface.
---

# Reading the A11y View

> The A11y view is the same tree across every Real A11y surface — the [Chrome extension](/guide/chrome-extension), the `<SemanticNavigator />` [React component](/packages/react), the [Storybook addon](/packages/storybook-addon), and the [`auditSnapshot()`](/packages/testing#auditsnapshot-root-options) string from the testing package. This page applies to all of them.

The A11y view shows you what assistive technology actually perceives — screen readers, voice control software, switch devices, and the browser's own accessibility APIs. Not what you wrote in HTML, but what users with disabilities actually experience when they interact with your page.

It answers the question: **"If someone couldn't see this, what would they hear?"**

This is the most important view.

---

## What you see

Each node represents one meaningful element in the accessibility tree. For each one, you'll see:

- **Role** — What kind of thing it is. `button`, `heading`, `textbox`, `listitem`, `dialog`, `navigation`, `region`… This comes from the HTML tag or an explicit `role` attribute.
- **Name** — What it's called. The label that gets announced. This is what makes the difference between hearing *"button"* and hearing *"Submit order"*.
- **State** — What condition it's in. Checked or unchecked. Expanded or collapsed. Disabled. Selected. Required.

---

## How the A11y view differs from the DOM view

The DOM view shows every HTML element. The A11y view filters and transforms:

- **Presentational elements disappear.** A `<div>` used only for layout with no role or text shows up in DOM but not in A11y. Same for `<span>`, empty containers, and elements with `role="presentation"` or `aria-hidden="true"`.
- **Semantics win over markup.** A `<div role="navigation">` and a `<nav>` element look different in DOM but both appear as `navigation` in A11y.
- **Names are computed, not just copied.** The name shown is the *result* of the full accessible name algorithm — not just the `aria-label` attribute, but the winner of a priority contest between label elements, `aria-labelledby`, `aria-label`, `title`, and text content.

---

## What to look for

### Interactive elements with no name

This is the single most common issue. An icon-only button, a link with no text, a form input with no visible label — these show up in the A11y view with a role but an empty name.

```
button  (no name)
```

A screen reader user hears: *"button"*. No context. They have to guess what it does, or give up.

**The fix:** Add visible text, an `aria-label`, or link the element to a visible label with `aria-labelledby`. If the button has an icon, the icon needs an `alt` or `aria-label`.

### Everything is `generic`

The `generic` role is what `<div>` and `<span>` get when they have no semantic role. If your A11y tree looks like:

```
generic
  generic
    generic
      button  "Add to cart"
```

…the screen reader has no structural context around that button. No landmarks to jump to, no headings to navigate by. Sighted users can scan visually; screen reader users navigate by structure.

**The fix:** Use landmark elements (`<main>`, `<nav>`, `<header>`, `<aside>`) and semantic elements (`<h1>`–`<h6>`, `<ul>`, `<button>`, `<a>`) to give the tree shape.

### Heading levels that jump

Headings are how screen reader users navigate long pages — they Tab through headings the same way sighted users scan titles. If you jump from an `h1` directly to an `h3`, users navigating by heading lose their place in the hierarchy.

```
heading  "Our Products"  (level 1)
heading  "Featured Items"  (level 3)   ← skipped level 2
```

**The fix:** Heading levels should only increase by one at a time. Use CSS to control visual size — don't pick a heading level based on how big it looks.

### Images with no name

An `<img>` without an `alt` attribute, or with `alt=""` when the image conveys meaning, shows up in the A11y tree with no name. Decorative images should genuinely be decorative — if it communicates content (a product photo, a chart, a badge), it needs a description.

### ARIA states that don't match reality

An accordion `<button>` with `aria-expanded` is good. An `aria-expanded` that never changes when the accordion opens is a bug — the A11y tree will say "collapsed" while the panel is visually open. The A11y view will catch this: look at the state and ask whether it matches what you see on screen.

### Elements that should be in the tree but aren't

If a custom widget isn't showing up with the right role — or isn't showing up at all — it may be `aria-hidden`, visually hidden but also hidden from AT, or built with markup that doesn't carry semantic meaning. The A11y view makes absences visible.

---

## Reading a well-structured tree

A healthy A11y tree looks something like this:

```
banner  "Site header"
  navigation  "Main"
    list
      listitem  →  link  "Home"
      listitem  →  link  "Products"
      listitem  →  link  "About"
main
  heading  "Featured Products"  (level 1)
  list
    listitem  →  article  "Blue Widget"
      heading  "Blue Widget"  (level 2)
      button  "Add to cart"
contentinfo  "Site footer"
```

Landmarks structure the page. Headings create hierarchy. Interactive elements have meaningful names. Nothing generic where something semantic belongs.

---

## Quick sanity checks

Run through these any time you open the A11y view on an unfamiliar component:

1. Do all interactive elements have a name?
2. Is the heading outline logical — one `h1`, no skipped levels?
3. Do landmark regions cover the whole page (no orphaned content outside `main`, `nav`, etc.)?
4. Do ARIA states on collapsibles, dialogs, and toggles match the current visual state?
5. Are there any `generic` containers where a landmark or semantic element belongs?
