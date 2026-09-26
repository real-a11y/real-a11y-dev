---
title: Accessible Names — how screen readers label elements
description: The full priority order of the ANDC algorithm, with concrete examples of what wins (aria-label, aria-labelledby, native label, text content) and what doesn't.
---

# Accessible Names

The **accessible name** is the string a screen reader announces for an element. It's what your user actually hears — and it's almost never just the element's text content. This page explains how that name is computed, what contributes, and what wins when multiple sources compete.

Every `SemanticNode.a11y.name` in a Real A11y tree comes from this algorithm.

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
4. **Text content** — inner text, including text inside descendants. Only for roles named from their content (buttons, links, headings, cells, options…): a dialog, image, landmark or text field is named by its author alone, never by its text
5. `title` attribute — last-resort fallback
6. Empty string (element has no accessible name)

If #1 resolves to a non-empty string, #2–#5 are ignored — even if #2 looks "more specific" from a CSS or developer perspective.

**One thing a tree shows beyond this list.** A paragraph, a list item, or a live region (`alert`, `status`) with text directly inside it shows that text as its name: `paragraph "Read the guide"`, `status "3 results"`. That keeps its content visible in a snapshot, where the tree prints names and nothing else. A screen reader reads that text as the element's content, not as a label. It never applies to a dialog, image, landmark or text field.

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

### Dialog with text but no label

```html
<div role="dialog">
  Delete this project?
  <button>Cancel</button>
</div>
```

→ `""` — no name. A dialog's text is its content, not its label: a screen reader announces this dialog unnamed. The same holds for an image, a landmark (`<nav>`, `<form>`, `<footer>`…) and a text field, whose text is the user's value. This fails `assertDialogsLabeled()`. Fix it by pointing `aria-labelledby` at a visible heading:

```html
<div role="dialog" aria-labelledby="delete-title">
  <h2 id="delete-title">Delete this project?</h2>
  <button>Cancel</button>
</div>
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
- **`<img alt="">` with empty alt** — the image is treated as decorative and contributes no name. Unless it also has a `title`: HTML-AAM keeps such an image in the tree and names it from the title, so `<img alt="" title="Company logo">` is an `img` named `"Company logo"`.

---

## Debugging an unexpected name

When `treeSnapshot()` shows a name you didn't expect:

1. **Check for `aria-label` / `aria-labelledby`** on the element or an ancestor — #1 and #2 override everything else.
2. **Follow the `aria-labelledby` chain.** The referenced IDs might be missing, hidden, or pointing at the wrong element.
3. **Look for visually-hidden text** inside the element — `.sr-only`, `.visually-hidden`. Often intentional, sometimes accidental.
4. **Check `aria-hidden`** on ancestors — a hidden wrapper removes the element's subtree from name computation.
5. **Compare against the Chrome extension.** If the extension shows the same name, it's what real AT will announce.

---

## Why this matters

The accessible name is the only piece of text a screen reader user has to distinguish one element from another. Two buttons labeled `"Edit"` in a list of items are indistinguishable — not because the user is confused, but because from their perspective *there is no more information*.

Real A11y's assertions (`assertNoUnlabeledInteractive`, `assertDialogsLabeled`) and snapshots (`treeSnapshot`) all surface the accessible name as the primary identifier — because that's what the user hears, and that's what your tests should lock in.
