---
title: "Snapshots — @real-a11y-dev/testing"
description: Deterministic string snapshots of the accessibility tree — auditSnapshot, outlineSnapshot, tabSequenceSnapshot — plus redact patterns for stable CI.
---

# Snapshots

Deterministic string representations of the accessibility tree. Safe to commit — the same DOM always produces the same string.

Part of [`@real-a11y-dev/testing`](/packages/testing). For the ergonomic `expect(...).toMatchSnapshot()` form, see [Matchers](/packages/testing/matchers).

## `auditSnapshot(root, options?)`

Returns a formatted string of the full semantic tree.

> Using the [matchers](/packages/testing/matchers) entry? `a11ySnapshot()` renders the **same tree** with cleaner snapshot tooling. `auditSnapshot` returns a raw string you can assert on or write to a file; `a11ySnapshot` returns a serializer-boxed value for native `toMatchSnapshot()`. See [`a11ySnapshot` vs `auditSnapshot`](/packages/testing/matchers#a11ysnapshot-vs-auditsnapshot).

```ts
import { auditSnapshot } from "@real-a11y-dev/testing";

test("login form structure", () => {
  render(<LoginForm />);
  expect(auditSnapshot(document.body)).toMatchSnapshot();
});
```

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `mode` | `"a11y" \| "dom"` | `"a11y"` | Tree extraction mode. |
| `redact` | `RegExp[]` | `[]` | Patterns replaced with `[redacted]` in names and text. Use this to keep snapshots deterministic. |

Example output:

```
main
  heading "Sign in" (level 1)
  form
    group "Credentials"
      textbox "Email address"
      textbox "Password"
    button "Sign in"
    link "Forgot password?"
```

### Using `redact`

`redact` takes an array of regexes. Any substring of an **accessible name** that matches one is replaced with the literal placeholder `[REDACTED]`. The element, its role, and its position are untouched — only the volatile text inside its name is masked.

#### Without `redact` — the snapshot flakes

A relative timestamp in an `aria-label` changes between runs, so the committed snapshot fails even though nothing actually regressed:

```ts
// rendered: <button aria-label="Saved 2 minutes ago">
expect(auditSnapshot(container)).toMatchSnapshot();
```

```
button "Saved 2 minutes ago"     ← committed at 10:00
button "Saved 5 minutes ago"     ← CI at 10:03   →  snapshot mismatch ✗
```

#### With `redact` — stable structure, masked text

```ts
// rendered: <button aria-label="Saved 2 minutes ago">
expect(
  auditSnapshot(container, {
    redact: [/\d+ (seconds?|minutes?|hours?) ago/],
  }),
).toMatchSnapshot();
```

```
button "Saved [REDACTED]"        ← identical on every run ✓
```

You still catch real regressions — if the button lost its label the name would change to `""` — you just stop catching "the clock advanced."

#### Realistic patterns

Most flakes come from a handful of sources. Pass a regex for each noisy bit:

```ts
import { auditSnapshot } from "@real-a11y-dev/testing";

expect(
  auditSnapshot(container, {
    redact: [
      // ISO 8601 timestamps        →  2026-04-23T14:03:12Z
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}Z?)?/,

      // Relative times             →  "2 minutes ago", "3 days ago"
      /\b\d+\s(seconds?|minutes?|hours?|days?|weeks?)\sago\b/i,

      // Bearer / session tokens    →  long base64-ish strings in aria-labels
      /[A-Za-z0-9+/]{24,}={0,2}/,

      // React auto-generated IDs   →  ":r0:", ":r1:" from useId
      /:r[0-9a-z]+:/,

      // Currency with varying FX   →  "$1,234.56", "€987,65"
      /[$€£¥]\s?\d[\d,.\s]*/,
    ],
  }),
).toMatchSnapshot();
```

The redaction happens **after** name computation — so an `aria-label="Updated 2 minutes ago"` becomes `[REDACTED]` in the snapshot string without changing the underlying tree. The element still appears, its role and structure still matter.

Define one shared list and reuse it across the suite so every snapshot masks the same noise consistently:

```ts
// test/redact.ts
export const COMMON_REDACTS = [
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/g,
  /:r[0-9a-z]+:/g,
];

// anywhere a snapshot is taken
expect(auditSnapshot(container, { redact: COMMON_REDACTS })).toMatchSnapshot();
```

::: tip How `redact` works — and two gotchas
- It runs on the **accessible name only**, at serialization time. Roles, heading levels, and tree shape are never modified — `redact` changes the snapshot *string*, not the extraction.
- Patterns apply **in order**, cumulatively.
- **Add the `g` flag if a name can contain more than one match.** Internally each pattern runs `name.replace(pattern, "[REDACTED]")`, and `String.replace` without `/g` only replaces the *first* match — so `"Created 2026-01-01, edited 2026-02-02"` with `/\d{4}-\d{2}-\d{2}/` masks just the first date. `/\d{4}-\d{2}-\d{2}/g` masks both.
- **Redact the narrowest thing that's actually volatile.** Masking a whole name blinds the snapshot to real regressions in it — remove the clock, not the label.
:::

> Available everywhere snapshots are: `auditSnapshot` and the [`a11ySnapshot`](/packages/testing/matchers#a11ysnapshot-root-options-snapshot-serializer) matcher in jsdom, and the [Playwright adapter](/packages/testing/playwright#redacting-variable-content) — which marshals each `RegExp` across the browser boundary for you.

## `outlineSnapshot(root)`

Returns a string of the heading outline only — useful for structure audits.

```ts
expect(outlineSnapshot(document.body)).toMatchSnapshot();
```

Example output:

```
h1 Introduction
  h2 Getting started
  h2 Configuration
    h3 Advanced options
  h2 API reference
```

## `tabSequenceSnapshot(root)`

Returns the tab sequence as a numbered list.

```ts
expect(tabSequenceSnapshot(document.body)).toMatchSnapshot();
```

Example output:

```
1. link "Skip to content"
2. link "Home" (navigation)
3. link "About" (navigation)
4. textbox "Search"
5. button "Submit search"
```

## Determinism

All three helpers return the **same string** for the same DOM — on every run, on every machine. No timestamps, no generated IDs, no ordering surprises. That's the property that makes `toMatchSnapshot()` safe in CI without flakes. For genuinely variable content, use [`redact`](#using-redact).

## See also

- [Matchers](/packages/testing/matchers) — `a11ySnapshot()` serializer so `expect(el).toMatchSnapshot()` renders the tree directly
- [Playwright adapter](/packages/testing/playwright) — the same snapshots against a real browser
- [CI Diff Bot recipe](/guide/ci-diff-bot) — wiring a snapshot generator into a PR workflow
