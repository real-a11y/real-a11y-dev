# @real-a11y-dev/testing

Headless accessibility audit helpers for [Real A11y](https://real-a11y.dev) — snapshots, structural assertions, and a fluent interaction flow. Works in Vitest / Jest (jsdom) out of the box; a Playwright adapter ships as a separate entry point.

This package brings **no test runner and no DOM of its own** — it audits a DOM you already have. Install it next to a runner and a DOM implementation:

```sh
npm install -D @real-a11y-dev/testing vitest jsdom
# Jest: npm install -D @real-a11y-dev/testing jest jest-environment-jsdom
```

The Vitest types entry (`@real-a11y-dev/testing/matchers/vitest`) needs **Vitest 5 or newer**, which itself needs Node.js 22.12+; on Vitest 3 or 4 it reports TS2428. The runtime matchers work on any Vitest version.

Jest also needs `testEnvironment: "jsdom"`, and does not parse TypeScript on its own — a `.ts` test needs `ts-jest` or `babel-jest`, so the transform-free path is a `.js` test. Full walkthrough: [real-a11y.dev/packages/testing](https://real-a11y.dev/packages/testing#your-first-passing-test).

## Quick start

Two files, no framework — copy both and it runs.

```ts
// vitest.config.ts — `environment` is required, or the helpers get no
// `document` and every test fails with `document is not defined`.
import { defineConfig } from "vitest/config";

export default defineConfig({ test: { environment: "jsdom" } });
```

```ts
// a11y.test.ts
import { expect, test } from "vitest";
import { treeSnapshot, assertNoUnlabeledInteractive } from "@real-a11y-dev/testing";

test("the sign-in form is labeled", () => {
  document.body.innerHTML = `
    <main>
      <h1>Sign in</h1>
      <label>Email <input name="email" /></label>
      <button>Continue</button>
    </main>
  `;
  const root = document.querySelector("main")!;

  assertNoUnlabeledInteractive(root);
  expect(treeSnapshot(root)).toMatchSnapshot();
});
```

`npx vitest run`. The committed snapshot is the accessibility tree, not a DOM dump:

```
main
  heading "Sign in" (level 1)
  textbox "Email"
  button "Continue"
```

Pass `{ values: true }` to also print what each field holds, the way a screen reader announces it: `textbox "Email" = "jane@x.com"`, or `= "[redacted]"` for a password or card field. It's off by default, so existing snapshots don't change. The same option works on `boxedTreeSnapshot`, `a11yDiff` and the Playwright adapter's `sn.treeSnapshot`.

A line also carries the node's states, description and announced properties in a `{…}` block, on by default, so a checked and an unchecked checkbox read differently: `checkbox "Subscribe" {checked}` and `checkbox "Subscribe" {checked=false}`. Pass `{ states: false }` for the text without blocks, to keep comparing with a baseline committed before them; it works on `treeSnapshot`, `tabSequenceSnapshot`, `boxedTreeSnapshot` and the Playwright adapter's `sn.treeSnapshot` and `sn.tabSequenceSnapshot`. [What a line carries](https://real-a11y.dev/packages/testing/snapshots#what-a-line-carries) lists each key.

`@testing-library/react` is **optional** — any `Element` works as an audit root — but it is the usual way to get a container:

```ts
import { render } from "@testing-library/react";
import {
  treeSnapshot,
  assertNoUnlabeledInteractive,
  assertHeadingOrder,
} from "@real-a11y-dev/testing";
import { LoginForm } from "./LoginForm";

test("login form is fully labeled", () => {
  const { container } = render(<LoginForm />);
  assertNoUnlabeledInteractive(container);
  assertHeadingOrder(container);
  expect(treeSnapshot(container)).toMatchSnapshot();
});
```

## Assert what an interaction changed

Capture the tree before, interact, then diff — assert the **effect** of the interaction (options appearing, `aria-expanded` flipping, focus moving), not just one element's final state:

```ts
import { capture, a11yDiff } from "@real-a11y-dev/testing";

test("opening the country picker", () => {
  const { container } = render(<CountrySelector />);
  const before = capture(container);

  fireEvent.click(screen.getByRole("combobox", { name: /country/i }));

  expect(a11yDiff(before, container)).toMatchInlineSnapshot(`
    + option "Spain"
    ~ combobox "Country": a11y.states.expanded false → true
    focus: combobox "Country" → listbox "Countries"
  `);
});
```

`a11yDiff` (like `boxedTreeSnapshot`) returns a box that the snapshot serializer prints as plain text, as above. Register it once in a setup file:

```ts
// vitest.config.ts: test: { environment: "jsdom", setupFiles: ["./vitest.setup.ts"] }
// vitest.setup.ts
import { expect } from "vitest";
import { registerA11yMatchers } from "@real-a11y-dev/testing/matchers";
import "@real-a11y-dev/testing/matchers/vitest"; // types only: registers nothing

registerA11yMatchers(expect);
```

Under Jest, call `registerA11yMatchers(expect)` the same way, with `@real-a11y-dev/testing/matchers/jest` for the types. Without the setup, the snapshot still holds the change list, as a quoted string.

Or fluently, inside a `flow()`, with a structured matcher:

```ts
await flow(container)
  .findByRole("combobox", { name: /country/i })
  .click()
  .expectChanges({
    added: [{ role: "option", name: "Spain" }],
    changed: [{ role: "combobox", changes: ["a11y.states.expanded"] }],
  });
```

See the [Flow docs](https://real-a11y.dev/packages/testing/flow#asserting-what-an-interaction-changed) for both styles. `a11yDiff(before, after, { childIds: false })` leaves out a container's `childIds` count line when its `+`/`-` lines already explain it; a move or reorder still prints it.

To set `childIds`, `values` and `redact` once for the whole project, pass them to `registerA11yMatchers` in the setup file, or call `configureA11y` from `@real-a11y-dev/testing` where no matchers are registered. A call's own options still win, key by key, and `flow().expectChanges("…")` strings compare against the same text:

```ts
registerA11yMatchers(expect, { diff: { childIds: false, redact: [/\d{2}:\d{2}/] } });
```

## See snapshots as a tree

A snapshot's text leaves out states, descriptions and what each element takes. Add the snapshot reporter to Vitest or Jest, and after every run `a11y-snapshots/index.html` draws each `boxedTreeSnapshot()` and `a11yDiff()` snapshot the way the Semantic Navigator panel does, with a diff's changes marked on its tree:

```ts
// vitest.config.ts
export default defineConfig({
  test: {
    reporters: ["default", "@real-a11y-dev/testing/reporter"],
  },
});
```

```js
// jest.config.js
module.exports = {
  reporters: ["default", "@real-a11y-dev/testing/reporter/jest"],
};
```

One self-contained page: open it from disk, or upload it from CI. To follow a watch-mode run live, `npx real-a11y show-report` from `@real-a11y-dev/cli` serves the same view and redraws as the tests rerun. See [The snapshot report](https://real-a11y.dev/packages/testing/snapshots#the-snapshot-report).

## Playwright adapter

```ts
import { test, expect } from "@playwright/test";
import { attach } from "@real-a11y-dev/testing/playwright";

test("home page a11y", async ({ page }) => {
  await page.goto("/");
  const sn = await attach(page);
  await sn.assertHeadingOrder();
  await sn.assertNoUnlabeledInteractive();
  expect(await sn.treeSnapshot()).toMatchSnapshot();
});
```

Pass `{ tree: "native" }` to audit Chromium's own accessibility tree (read over CDP) instead of the in-page DOM walk — it reaches structure no in-page walk can, such as a `<video controls>`'s play/scrubber/mute controls in its closed user-agent shadow root. Native mode is read-only and whole-document (`tabSequenceSnapshot()` throws and `rootSelector` isn't supported), and it reads the page's iframes — each frame's document under its `Iframe` row, in whichever process Chromium runs it; see the [Playwright adapter docs](https://real-a11y.dev/packages/testing/playwright#auditing-the-native-tree). Add `redactInput: true`, with either tree, for the strict mode — no field value and no rich-text editor content in any snapshot or assertion message, the same as the CLI's `--redact-input`.

## Docs

Snapshot helpers, assertion reference, `flow()` chain API, and `redact` patterns at **[real-a11y.dev/packages/testing](https://real-a11y.dev/packages/testing)**.

Want a CI diff bot that comments on PRs when the tree changes? See the [CI Diff Bot recipe](https://real-a11y.dev/guide/ci-diff-bot).

## License

MIT
