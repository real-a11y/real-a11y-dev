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

1. `aria-labelledby` — the name of each element it references, computed as for that element alone except that its own `aria-labelledby` is ignored. Its content is read whatever its role, and its `title` comes last. A referenced form control gives its value, else its own name: `<button aria-labelledby="c">` over `<label for="c">Agree</label><input type="checkbox" id="c">` is `"Agree"` (see [A control inside a label or heading](#a-control-inside-a-label-or-heading))
2. `aria-label` — literal string on the element itself. One that is only spaces is skipped
3. Native host-language label:
   - `<label for="…">` or ancestor `<label>` for form controls. A control with several labels is named from all of them, joined with spaces in document order
   - `<fieldset><legend>` for grouped controls
   - `<caption>` for tables
   - `alt` for images and `<input type="image">`, the first `<title>` for an `<svg>`, `title` for iframes
   - `value` for `<input type="submit">`, `"reset"` and `"button"`. A submit or reset input with no `value` attribute gets the default name `Submit` or `Reset`, ahead of `title`; `value=""` is a stated empty name and gets none, and `type="button"` has no default
4. **Text content** — inner text, including text inside descendants. A descendant with a name of its own lends that name instead of its text: an image its `alt`, an `<svg>` its `<title>`, any element its `aria-label`. A `<select>`'s `<option>` is the exception, named by its text alone. A form control inside gives its value, not its text, or its own name when it holds no value (see [A control inside a label or heading](#a-control-inside-a-label-or-heading)). Only for roles named from their content (buttons, links, headings, cells, options…): a dialog, image, landmark, text field, `article`, `group`, `note`, `tabpanel`, `doc-toc` or `graphics-document` is named by its author alone, never by its text
5. `title` attribute — last-resort fallback
6. An `<input type="image">` that nothing else has named is called `Submit`, as it is a submit button. This default comes after `title`, unlike the submit and reset defaults
7. Empty string (element has no accessible name)

The defaults are fixed English strings: a browser localizes its own, so Chromium's tree (the `cli` `tree` and `audit` commands, `mcp`) may say the same word in another language.

If #1 resolves to a non-empty string, #2–#6 are ignored — even if #2 looks "more specific" from a CSS or developer perspective.

**One thing a tree shows beyond this list.** A paragraph, a list item, a code block, or a live region (`alert`, `status`) with text directly inside it shows that text as its name: `paragraph "Read the guide"`, `status "3 results"`. That keeps its content visible in a snapshot, where the tree prints names and nothing else. A screen reader reads that text as the element's content, not as a label. It never applies to a dialog, image, landmark, text field, `article`, `group`, `note` or `tabpanel`.

That text includes what sits in a plain inline wrapper, which Chromium gives no node of its own: a `<span>`, a `<b>`, a custom or unknown element. `<p>Drop in <b>the panel</b> now.</p>` is `paragraph "Drop in the panel now."`, and a highlighted code block is named with its code. Text in an element that has a node of its own stays out, because that node shows it: a link, a `<code>` or `<strong>`, a `<label>`, and a wrapper with an `id`, a `title`, an `aria-` attribute or a `tabindex`. A `<br>` reads as a space.

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

### Link with only an image

```html
<a href="/">
  <img src="/logo.svg" alt="Acme home" />
</a>
```

→ `"Acme home"` (from #4). The link is named from its content, and what the image contributes is its `alt`. Any child with a name of its own lends that name rather than its text, so `<button><span aria-label="Close">×</span></button>` is `"Close"`, not `"×"`.

### Dialog with text but no label

```html
<div role="dialog">
  Delete this project?
  <button>Cancel</button>
</div>
```

→ `""` — no name. A dialog's text is its content, not its label: a screen reader announces this dialog unnamed. The same holds for an image, a landmark (`<nav>`, `<aside>`, `<footer>`…) and a text field, whose text is the user's value. (An unnamed `<form>` is not a landmark at all — it is a generic, and a generic *does* take its loose text.) This fails `assertDialogsLabeled()`. Fix it by pointing `aria-labelledby` at a visible heading:

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

### A control inside a label or heading

```html
<label>
  <input type="checkbox" />
  Flash the screen <input value="3" aria-label="number of times" /> times
</label>
<h2>Sort by <select><option>Name</option><option selected>Date</option></select></h2>
```

→ the checkbox is `"Flash the screen 3 times"` and the heading `"Sort by Date"`. A control inside a label or a name built from content lends its value, as Chromium does (AccName step 2C): a text field what it holds, a `<select>` or listbox its chosen options, a slider, spinbutton, progress bar or meter its `aria-valuetext`, else its value. A value wins over the control's own `aria-label`, and an option nobody chose is never read. The text field keeps its own name, `"number of times"`, and a control is never named after its own value: `<label>Email <input value="a@b.c"></label>` names the field `"Email"`.

A control that holds no value lends its own name instead: its `aria-label`, its `<label>`, its `title`, then its placeholder. `<h2>Save <input placeholder="Draft"> now</h2>` is `"Save Draft now"`. So does a date, time or colour input, whose value Chromium never reads into a name. An empty single `<select>`, and an empty `textbox`, `searchbox` or `combobox` that isn't an `<input>` or `<textarea>`, lend nothing at all, as in Chromium.

The same holds for `aria-labelledby` and `aria-describedby` pointing at a control: `<button aria-labelledby="q">` over `<input id="q" value="cats">` is `"cats"`, and over the same field empty, with `<label for="q">Search</label>`, `"Search"`. A checkbox, radio, button input, `<output>` or `<progress>` gives its own name the same way, from its labels.

A value that is a secret never reaches a name. If a password, one-time code or payment card field holds anything, the whole name built from it reads `"[redacted]"`, and a description built from it is dropped, in both trees. The strict mode (`redactInput`) does the same for any value a user entered. A progress bar's or meter's value is the page's own state, so it stays.

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

A referenced element with an `aria-label` of its own lends that instead of its text, and so does an image with its `alt`. `aria-describedby` reads its targets the same way.

---

## What does *not* contribute

- **`placeholder`** — by the spec, placeholders are a fallback name *only if nothing else is available*, and many screen readers ignore them entirely. Don't rely on placeholders as labels.
- **`title`** — the last fallback. It surfaces as a tooltip in desktop browsers, but many AT users (mobile, voice control) never see it. Treat it as documentation, not a label. When something else names the element, the `title` becomes its accessible description instead: `<button aria-label="Save" title="Saves the draft">` is `button "Save"` described by "Saves the draft". `aria-describedby` and `aria-description` win over it.
- **Text inside `aria-hidden="true"` subtrees** — excluded from name computation. As in Chromium, any value but `false`, an empty value or `undefined` hides, in any case: `aria-hidden="TRUE"` and `aria-hidden="yes"` hide too.
- **Text under `visibility: hidden` or `visibility: collapse`** — excluded too, element by element: `<h2>visible <span style="visibility:hidden">hidden</span> more</h2>` is `heading "visible more"`, while a descendant that sets `visibility: visible` again still counts. When the element an `aria-labelledby` or `aria-describedby` points at is itself hidden this way, its whole subtree is read.
- **CSS-generated content** (`::before`, `::after` `content`) — spec says it *should* contribute, but engine support is inconsistent. Don't rely on it for critical labels.
- **What is inside an image** — an `<img>`, an `<svg>` or a `role="img"` element lends its name, never its content. `<button><span role="img">★</span></button>` has no name, nor does a button whose only content is SVG `<text>`. Give the image an `aria-label`, or the button one.
- **`<img alt="">` with empty alt** — the image is treated as decorative and contributes no name. Unless it also has a `title`: HTML-AAM keeps such an image in the tree and names it from the title, so `<img alt="" title="Company logo">` is an `img` named `"Company logo"`.

---

## Debugging an unexpected name

When `treeSnapshot()` shows a name you didn't expect:

1. **Check for `aria-label` / `aria-labelledby`** on the element or an ancestor — #1 and #2 override everything else.
2. **Follow the `aria-labelledby` chain.** The referenced IDs might be missing, hidden, or pointing at the wrong element.
3. **Look for visually-hidden text** inside the element — `.sr-only`, `.visually-hidden`. Often intentional, sometimes accidental.
4. **Check `aria-hidden`** on ancestors — a hidden wrapper removes the element's subtree from name computation.
5. **Compare against the Chrome extension.** If the extension shows the same name, it's what real AT will announce.

### Spacing between a name's parts

When a name is built from an element's content, each child that renders as a box
of its own is separated with a space, and a child that flows inline is not — the
same rule Chromium applies. So `<button><div>Save</div><div>now</div></button>`
is `"Save now"`, while `<button><span>Sa</span><span>ve</span></button>` is one
word, `"Save"`. A child that lends no text still separates the text around it if
it renders: `<h1>Save<input>now</h1>` is `"Save now"`.

Text a child lends from an attribute is spaced off even when the child flows
inline: an image's `alt`, a child's `aria-label`, a nested link's `aria-label`.
So `<a href="/kb"><img alt="Help">center</a>` is `"Help center"`, as in
Chromium. The rule is about the child itself, not what lies inside it: a link
whose only content is an image is still named by its content, so
`<h2>Go to<a href="/"><img alt="Home"></a>now</h2>` is `"Go toHomenow"`.

Because the rule reads **computed** `display`, the same markup can produce a
different name in jsdom than in a real browser wherever jsdom's CSS engine
differs from a browser's. jsdom does not blockify flex or grid items, floats or
absolutely positioned children, and it treats `<select>` and `<textarea>` as
inline where a browser makes them `inline-block`. Those cases read as one word
under a jsdom-based matcher and spaced in a browser. If a name looks glued only
in jsdom, check the child's computed `display` before treating it as a bug —
and prefer the Playwright path, which runs in a real browser, when the
distinction matters to your assertion.

---

## Why this matters

The accessible name is the only piece of text a screen reader user has to distinguish one element from another. Two buttons labeled `"Edit"` in a list of items are indistinguishable — not because the user is confused, but because from their perspective *there is no more information*.

Real A11y's assertions (`assertNoUnlabeledInteractive`, `assertDialogsLabeled`) and snapshots (`treeSnapshot`) all surface the accessible name as the primary identifier — because that's what the user hears, and that's what your tests should lock in.
