---
title: Troubleshooting — fixing common a11y audit surprises
description: Empty audits, flapping snapshots, missing h1 warnings, hydration mismatches, and jsdom vs Playwright divergences — diagnostic recipes for each.
---

# Troubleshooting

The library is designed to fail loudly — `A11yAssertionError` exceptions include the offending element, its location in the tree, and a suggested fix. Most problems are caught there. This page covers the edge cases that look like bugs but usually aren't.

## My audit returned nothing

```ts
const { nodes } = extractA11yTree(document.getElementById("app"));
// nodes.size === 0
```

Three usual causes:

1. **Root element doesn't exist yet.** If you call the extractor from a component's body (rather than inside `useEffect` / `onMount`), the ref may not be attached to the DOM. Extract on mount, not during render.
2. **Selector didn't match.** `document.querySelector("main")` returns `null` if there's no `<main>` landmark yet. Check the return value.
3. **Whole subtree is hidden.** `display: none`, `visibility: hidden`, or `aria-hidden="true"` on an ancestor excludes the subtree from the a11y tree by design. That's what a screen reader sees — nothing.

If the tree genuinely is empty but you expect content, open the Chrome extension on the same page and check the A11y view — the same extraction runs there.

---

## Snapshot flaps between runs or between local and CI

`auditSnapshot()` is deterministic, but it surfaces text that isn't. Common culprits:

- **Timestamps / relative times** — "2 hours ago", "Updated: 2026-04-23T14:00".
- **User-generated content** — names, emails, IDs.
- **Locale-variable copy** — i18n strings that differ between en/es runs.
- **Random IDs / correlation tokens** — React's `useId`, auth tokens, request IDs.
- **Time-of-day greetings** — "Good morning, Alice".

Use the `redact` option to replace the noisy patterns with `[redacted]`:

```ts
import { auditSnapshot } from "@real-a11y-dev/testing";

expect(
  auditSnapshot(container, {
    redact: [
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/,       // ISO timestamps
      /\b\d+ (minutes?|hours?|days?) ago\b/, // relative times
      /[A-Za-z0-9+/=]{20,}/,                 // bearer tokens
    ],
  }),
).toMatchSnapshot();
```

The same option is on the Playwright adapter: `sn.auditSnapshot({ redact: [...] })`.

---

## Heading outline has no `h1`

`assertHeadingOrder()` throws if there is not exactly one `h1`. That's correct for top-level pages. For **embedded content** — a portaled dialog, a docs widget, an email preview iframe — scope the assertion to the subtree that should have its own hierarchy, or skip it.

```ts
// Scope to main content
const main = document.querySelector("main")!;
assertHeadingOrder(main);
```

If your page legitimately has multiple h1s (rare — usually an anti-pattern), the rule doesn't fit your design and `assertHeadingOrder` isn't the right check.

---

## Tab sequence is empty

`tabSequenceSnapshot()` lists only **keyboard-focusable** elements. Common reasons for an empty sequence:

- The root is wrapped in `[inert]`, which removes the whole subtree from the focus order (Chrome, Safari, Firefox all honor this).
- Every focusable element has `tabindex="-1"` — some design systems over-use this to disable default focus.
- The subtree is `display: none` or `aria-hidden="true"`.
- You're passing a root that doesn't contain the expected elements (e.g. a portaled modal that mounts elsewhere in the DOM).

If the tab order *should* be empty on a given route (a 404, a splash screen with no interactive content), suppress the assertion for that route rather than the whole suite.

---

## React hydration mismatch when rendering the panel

If you drop `<SemanticNavigator />` into an SSR-rendered component tree, the server renders the wrapper `<div>` but no inspector content — the inspector mounts on the client. That's fine. Hydration warnings typically come from **other** sources in the same tree; the panel itself is hydration-safe.

If you're specifically seeing a mismatch on a `<div>` that should be an `aside` or `nav`, check whether you have Chrome extensions injecting markup into the page — they're a common cause of hydration warnings that look library-related.

If you're adding your own wrapper around `<SemanticNavigator />` that uses `document.*` during render, wrap that in a mount effect or use `next/dynamic({ ssr: false })`.

---

## Tests pass in jsdom but fail in Playwright (or vice versa)

jsdom implements most of the accessibility tree, but a few areas diverge from real browsers:

- **Computed style** — jsdom's `display` computation is limited. If your test depends on `display: contents` or complex CSS-driven visibility, trust Playwright.
- **`inert` attribute** — support landed in jsdom later than in browsers. Upgrade to `jsdom ≥ 23`.
- **`element.focus()` inside `requestAnimationFrame`** — jsdom's rAF queue differs from browsers; focus traps can look flaky.
- **Shadow DOM event retargeting** — jsdom is mostly correct but has been known to drop `composed: true` listeners in edge cases.

The rule: jsdom covers ~95% of cases at jsdom speed. When it diverges, the truth is in Playwright. Use `@real-a11y-dev/testing/playwright` for the remaining 5%.

---

## `A11yAssertionError` with a message I don't understand

The error message includes the **element type**, the **location in the tree** (path from the root), and the **reason**. If the reason is still unclear, pair the assertion with a snapshot of the same root — the snapshot shows the element in context.

```ts
try {
  assertNoUnlabeledInteractive(container);
} catch (err) {
  console.log(auditSnapshot(container));
  throw err;
}
```

Every assertion is documented with an example in [`@real-a11y-dev/testing`](/packages/testing#assertions).

---

## Still stuck?

- Check the [Peer Dependencies](/recipes/peer-dependencies) recipe — most "it doesn't install" issues are peer version mismatches.
- Check the relevant recipe ([Next.js](/recipes/nextjs), [Storybook + React 19](/recipes/storybook-react-19)) if you're on one of those stacks.
- Reproduce in the Chrome extension against the same URL — if the extension also produces the unexpected output, it's a real tree extraction question (open an issue with the minimal HTML). If the extension matches your expectation but the library disagrees, it's likely a config or environment issue.
