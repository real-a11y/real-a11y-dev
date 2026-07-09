---
title: Accessible Names — how screen readers label elements
description: The full priority order of the ANDC algorithm, with concrete examples of what wins (aria-label, aria-labelledby, native label, text content) and what doesn't.
---

# Accessible Names

The **accessible name** is the string a screen reader announces for an element. It's what your user actually hears — and it's almost never just the element's text content. This page explains how that name is computed, what contributes, and what wins when multiple sources compete.

Every `SemanticNode.a11y.name` in a Real A11y tree comes from this algorithm — the W3C [Accessible Name and Description Computation (accname-1.2)](https://www.w3.org/TR/accname-1.2/), the same spec browsers and screen readers follow.

---

## The priority order

For any element, the accessible name is picked from the **first non-empty source** in this list:

1. `aria-labelledby` — references another element's text content
2. `aria-label` — literal string on the element itself
3. Native host-language label:
   - `<label for="…">` or ancestor `<label>` for form controls
   - `<fieldset><legend>` for grouped controls
   - `<caption>` for tables
   - `alt` for images, `title` for iframes
4. **Text content** — inner text, including text inside descendants
5. `title` attribute — last-resort fallback
6. Empty string (element has no accessible name)

If #1 resolves to a non-empty string, #2–#5 are ignored — even if #2 looks "more specific" from a CSS or developer perspective.

---

## Concrete examples

### Button with only text

```html
<button>Save changes</button>
```

→ `"Save changes"` (from #4, text content).

### Button with an icon and hidden text

```html
<button>
  <svg aria-hidden="true">…</svg>
  <span class="sr-only">Close dialog</span>
</button>
```

→ `"Close dialog"` (from #4). The `aria-hidden` SVG contributes nothing; the visually-hidden `<span>` does because screen readers read it.

### Button with only an icon

```html
<button>
  <svg aria-hidden="true">…</svg>
</button>
```

→ `""` — no name. This fails `assertNoUnlabeledInteractive()`. Fix with `aria-label`:

```html
<button aria-label="Close dialog">
  <svg aria-hidden="true">…</svg>
</button>
```

### Form control with a wrapping label

```html
<label>
  Email
  <input type="email" />
</label>
```

→ input's name is `"Email"` (from #3 — native label association). Real A11y's label handling prunes the label text from the tree so it doesn't surface as a redundant `generic "Email"` sibling.

### Form control with `for` / `id`

```html
<label for="q">Search</label>
<input id="q" type="search" />
```

→ input's name is `"Search"` (same path).

### `aria-label` beats text content

```html
<a href="/home" aria-label="Go to homepage">Home</a>
```

→ `"Go to homepage"` (from #2). The visible text `"Home"` is ignored by screen readers here — a classic footgun if the two drift apart.

### `aria-labelledby` beats everything

```html
<h2 id="section-title">Pricing plans</h2>
<section aria-labelledby="section-title" aria-label="ignored">
  …
</section>
```

→ region's name is `"Pricing plans"` (from #1). The `aria-label` is ignored.

`aria-labelledby` can reference multiple IDs — their text content is concatenated with spaces:

```html
<label id="first">First name</label>
<span id="req">(required)</span>
<input aria-labelledby="first req" />
```

→ input's name is `"First name (required)"`.

---

## What does *not* contribute

- **`placeholder`** — by the spec, placeholders are a fallback name *only if nothing else is available*, and many screen readers ignore them entirely. Don't rely on placeholders as labels.
- **`title`** — the last fallback. It surfaces as a tooltip in desktop browsers, but many AT users (mobile, voice control) never see it. Treat it as documentation, not a label.
- **Text inside `aria-hidden="true"` subtrees** — excluded from name computation.
- **CSS-generated content** (`::before`, `::after` `content`) — spec says it *should* contribute, but engine support is inconsistent. Don't rely on it for critical labels.
- **`<img alt="">` with empty alt** — the image is treated as decorative and contributes no name.

---

## Debugging an unexpected name

When `auditSnapshot()` shows a name you didn't expect:

1. **Check for `aria-label` / `aria-labelledby`** on the element or an ancestor — #1 and #2 override everything else.
2. **Follow the `aria-labelledby` chain.** The referenced IDs might be missing, hidden, or pointing at the wrong element.
3. **Look for visually-hidden text** inside the element — `.sr-only`, `.visually-hidden`. Often intentional, sometimes accidental.
4. **Check `aria-hidden`** on ancestors — a hidden wrapper removes the element's subtree from name computation.
5. **Compare against the Chrome extension.** If the extension shows the same name, it's what real AT will announce.

---

## Why we don't just ask the browser

Browsers already do this — every engine builds an accessibility tree internally and runs accname to name each node. So why does Real A11y reimplement the algorithm in JavaScript instead of reading the browser's answer?

Because there's no stable, cross-browser *web API* to read it. The [Accessibility Object Model](https://wicg.github.io/aom/explainer.html)'s `getComputedAccessibleNode()` — the proposal that would expose the computed name to script — stalled years ago, partly over legitimate fingerprinting concerns: exposing the computed tree can leak that someone is running assistive tech. Today that tree is reachable only through privileged channels like DevTools or Playwright over the Chrome DevTools Protocol — never a portable call you can make from a unit test.

So Real A11y computes the name itself. That isn't a workaround for a missing convenience — it's what lets the *same* computation run everywhere: a live browser, a Playwright page, jsdom under Vitest, a Storybook story. One engine, one answer, every context — including the ones where no browser accessibility tree exists at all.

The cost is that we own the spec's hard edges — name-from-content recursion, reference cycles, whitespace normalization — and have to match what real AT actually exposes. That's why this page, and the test suite behind it, is so exact about what wins.

---

## Why this matters

The accessible name is the only piece of text a screen reader user has to distinguish one element from another. Two buttons labeled `"Edit"` in a list of items are indistinguishable — not because the user is confused, but because from their perspective *there is no more information*.

Real A11y's assertions (`assertNoUnlabeledInteractive`, `assertDialogsLabeled`) and snapshots (`auditSnapshot`) all surface the accessible name as the primary identifier — because that's what the user hears, and that's what your tests should lock in.
