---
title: Reading Good Semantics
description: How to read your accessibility tree and recognize common semantic problems — repeated link text, menu-role navigation, misused dialog roles, heading skips, redundant names. The tree shows them faithfully; this page teaches you to see them.
---

# Reading Good Semantics

::: warning Preview page
This guide is a draft and isn't in the sidebar yet — it's reachable by direct
link while it settles. The content is stable, but the page may move or change
before it's linked from the main navigation.
:::

> Real A11y is a **faithful lens**, not an auditor. The tree shows you exactly what
> assistive technology perceives — every exposed node, the role the author
> declared, the computed name, and nothing that's hidden. What it deliberately
> does _not_ do is editorialize: it won't tell you a name is _bad_, only what the
> name _is_. This page teaches you to make that judgment yourself by reading the
> tree.

Most semantic problems aren't invisible — they're sitting right there in the
tree, in plain sight, once you know the shape of them. A few of these Real A11y
_does_ assert on (heading order is the one demonstrated below — see
[the testing package](/packages/testing/assertions)); most are judgments that
depend on context, which is exactly why they belong in your eyes and not in a
rule that would cry wolf.

Every example below is a pattern you'll meet on real production sites — shown
here on one small engineering-blog homepage so the tree excerpts stay consistent.

::: tip The mindset
For each pattern, read the tree the way a screen reader user hears it — top to
bottom, role then name, with no visual layout to lean on. If _you_ can't tell
what a node does or where it goes from its role and name alone, neither can they.
:::

---

## Repeated link text

You'll see the same accessible name on several links that go to different places:

```
article "Migrating our API to GraphQL"
  link "Continue reading"
article "What we shipped in Q3"
  link "Continue reading"
article "Welcome, new teammates"
  link "Continue reading"
```

**What a user experiences.** A screen reader can pull up a list of every link on
the page (VoiceOver's rotor, NVDA's Elements List, JAWS's links list). Out of that
flat list, three entries all read *"Continue reading"* — with no way to tell which
story is which. The visual context (the card next to it) is gone.

**The fix.** Give each link a distinct accessible name, or fold the context in:

```html
<a
  href="/blog/graphql-migration"
  aria-label="Continue reading: Migrating our API to GraphQL"
>
  Continue reading
</a>
```

Keep the visible words _inside_ the accessible name — the `aria-label` above
still starts with *"Continue reading"*, so it satisfies
[WCAG 2.5.3 Label in Name](https://www.w3.org/WAI/WCAG21/Understanding/label-in-name.html)
and voice-control users can still say "Continue reading" to click it. Append
context; don't replace the visible text.

**The nuance (why it's not a rule).** Repeated link text is _sometimes_ fine —
if each link is programmatically associated with its context (`aria-labelledby`
pointing at the card heading, for instance), assistive tech can distinguish
them. That "it depends" is exactly why this is guidance, not an automated
failure. *(WCAG 2.4.4 Link Purpose)*

---

## Navigation built as an application menu

The site's primary navigation shows up with `menubar` / `menuitem` roles:

```
menubar
  menuitem "Home"
  menuitem "Blog"
  menuitem "Docs"
  menuitem "Pricing"
  menuitem "Contact"
```

**What a user experiences.** `menu` and `menubar` are for _application menus_ —
the File/Edit/View bar of a desktop app — and they carry a keyboard contract:
arrow keys move between items, `Tab` exits the whole menu, one item at a time is
focusable. A screen reader announces *"menu bar, Home, menu item."* But
these are just page links. Users expect `Tab` to move through them and `Enter`
to navigate — the menu contract is almost never actually implemented, so the
announced behavior and the real behavior disagree.

**The fix.** Site navigation is a list of links inside a navigation landmark:

```html
<nav aria-label="Primary">
  <ul>
    <li><a href="/">Home</a></li>
    <li><a href="/blog">Blog</a></li>
  </ul>
</nav>
```

In the tree that becomes a `navigation` landmark with plain `link` children —
discoverable by "jump to landmarks," and behaving the way users expect.
*(WCAG 4.1.2 Name, Role, Value; [APG](https://www.w3.org/WAI/ARIA/apg/patterns/menubar/)
cautions against `menubar` for site nav.)*

---

## A dialog role on something that isn't a modal

A cookie-consent banner carries `alertdialog`:

```
alertdialog "Privacy Preferences"
  button "I accept"
  button "I decline"
  button "Personalize my choices"
```

**What a user experiences.** `alertdialog` means *"an urgent message that
demands an immediate response"* — and it implies a **modal**: focus is trapped,
the rest of the page is inert until you deal with it. A persistent consent bar at
the bottom of the page is usually neither urgent nor modal. So the role
advertises a focus trap that was never built, and labels a routine, always-there
bar as an urgent dialog. (Note: an `alertdialog` is announced when focus lands on
it — unlike `role="alert"`, it does _not_ barge into the screen reader's speech
on its own.)

**The fix.** If the banner is non-modal, a labeled region is honest about what it
is — a named `<section>` already exposes as a `region` landmark, so no explicit
`role` is needed:

```html
<section aria-label="Cookie consent"> … </section>
```

If it genuinely _should_ block the page, make it a real modal by opening a native
`<dialog>` with `dialogEl.showModal()`. That handles modality, the top layer, and
inertness of the rest of the page — and exposes `aria-modal="true"` for you, so
don't set that attribute by hand (a static `aria-modal` claims a modal that isn't
one — the exact lie this section warns against). Then own the focus contract:
move focus into the dialog on open (`autofocus` the primary control), return it to
the trigger on close, dismiss on `Esc`, and keep `Tab` inside. Only then is
`dialog`/`alertdialog` honest. Match the role to the actual behavior.
*(WCAG 4.1.2)*

---

## Skipped heading levels

In the tree, the heading levels jump — straight from `(level 1)` to `(level 3)`,
with no `(level 2)` between them:

```
heading "Engineering Blog" (level 1)
heading "Migrating our API to GraphQL" (level 3)
heading "What we shipped in Q3" (level 3)
heading "Legal" (level 3)
```

**What a user experiences.** Screen reader users navigate by heading and rely on
the _level_ to understand nesting — a `(level 3)` heading straight after the
`(level 1)` implies a missing `h2` section, as if content were skipped. Levels
should describe the document's structure, not be chosen for their visual size.

**The fix.** Use sequential levels (`h1` → `h2` → `h3`) and style them with CSS
if you want an `h2` to _look_ small.

::: tip Where guidance hardens into a rule
Real A11y asserts on a few **narrow, exception-free slices** of these topics, and
[`assertHeadingOrder()`](/packages/testing/assertions) is one. A skipped level is
a strong signal, not a guaranteed failure — WCAG 1.3.1 fails only when the level
contradicts the structure the design conveys — so the check is a heuristic that
flags _likely_ problems worth a look. The same split runs through the other
assertions: `dialog-labeled` asserts the objective sub-case (a dialog with _no_
name is always wrong) while "is `alertdialog` even the right role?" stays a
judgment; `landmark-structure` asserts the countable sub-case (exactly one
`main`) while "should this nav be a `menubar`?" stays a judgment. The objective
slice becomes a rule; the judgment stays on this page. *(WCAG 1.3.1)*
:::

---

## Redundant names

An image repeats the name of the heading right next to it:

```
article "Migrating our API to GraphQL"
  heading "Migrating our API to GraphQL" (level 3)
  paragraph "…"
  img "Migrating our API to GraphQL"
```

**What a user experiences.** Reading through the card, a screen reader announces
*"Migrating our API to GraphQL, heading… Migrating our API to GraphQL, image"* —
the same name twice, with no new information the second time. It's noise.

**The fix.** If the image doesn't add information the heading already gave, mark
it decorative so it's skipped:

```html
<img src="graphql.png" alt="" />
```

If it _does_ convey something new (who's pictured, what they're doing), let the
`alt` say _that_ instead of echoing the heading. *(WCAG 1.1.1 — a quality
judgment, not a pass/fail: an empty name fails, a redundant one is just noisy.)*

---

## What the tree can't tell you

The tree is a faithful map of **semantics** — roles, names, states, structure.
Some accessibility problems don't live there at all, and no reading of the tree
will surface them:

- **Color contrast** — a `button "Create account"` looks perfect in the tree even
  if its text is unreadable against the background.
- **Focus visibility** — whether the focus ring is actually visible is a rendered,
  interactive property.
- **Content obscured by overlays**, target sizes, motion — all geometry and
  pixels.

For these, reach for a rendering-based checker like
[axe-core](https://github.com/dequelabs/axe-core) and real manual testing with a
screen reader. Real A11y is the semantic layer; it composes _with_ those tools,
it doesn't replace them.

---

## See also

- [Reading the A11y View](/guide/reading-the-a11y-view) — how to interpret roles,
  names, and states in the first place.
- [Reading the Headings View](/guide/reading-the-headings-view) — the outline in
  isolation.
- [Assertions](/packages/testing/assertions) — the subset of these that Real A11y
  asserts on automatically.
