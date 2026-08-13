# @real-a11y-dev/testing

Headless accessibility audit helpers for [Real A11y](https://real-a11y.dev) — snapshots, structural assertions, and a fluent interaction flow. Works in Vitest / Jest (jsdom) out of the box; a Playwright adapter ships as a separate entry point.

This package brings **no test runner and no DOM of its own** — it audits a DOM you already have. Install it next to a runner and a DOM implementation:

```sh
npm install -D @real-a11y-dev/testing vitest jsdom
# Jest: npm install -D @real-a11y-dev/testing jest jest-environment-jsdom
```

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
import { auditSnapshot, assertNoUnlabeledInteractive } from "@real-a11y-dev/testing";

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
  expect(auditSnapshot(root)).toMatchSnapshot();
});
```

`npx vitest run`. The committed snapshot is the accessibility tree, not a DOM dump:

```
main
  heading "Sign in" (level 1)
  textbox "Email"
  button "Continue"
```

`@testing-library/react` is **optional** — any `Element` works as an audit root — but it is the usual way to get a container:

```ts
import { render } from "@testing-library/react";
import { assertHeadingOrder } from "@real-a11y-dev/testing";
import { LoginForm } from "./LoginForm";

test("login form is fully labeled", () => {
  const { container } = render(<LoginForm />);
  assertNoUnlabeledInteractive(container);
  assertHeadingOrder(container);
  expect(auditSnapshot(container)).toMatchSnapshot();
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

See the [Flow docs](https://real-a11y.dev/packages/testing/flow#asserting-what-an-interaction-changed) for both styles.

## Playwright adapter

```ts
import { test, expect } from "@playwright/test";
import { attach } from "@real-a11y-dev/testing/playwright";

test("home page a11y", async ({ page }) => {
  await page.goto("/");
  const sn = await attach(page);
  await sn.assertHeadingOrder();
  await sn.assertNoUnlabeledInteractive();
  expect(await sn.auditSnapshot()).toMatchSnapshot();
});
```

Pass `{ tree: "native" }` to audit Chromium's own accessibility tree (read over CDP) instead of the in-page DOM walk — it reaches structure no in-page walk can, such as a `<video controls>`'s play/scrubber/mute controls in its closed user-agent shadow root. Native mode is read-only and whole-document (`tabSequenceSnapshot()` throws and `rootSelector` isn't supported); see the [Playwright adapter docs](https://real-a11y.dev/packages/testing/playwright#auditing-the-native-tree).

## Docs

Snapshot helpers, assertion reference, `flow()` chain API, and `redact` patterns at **[real-a11y.dev/packages/testing](https://real-a11y.dev/packages/testing)**.

Want a CI diff bot that comments on PRs when the tree changes? See the [CI Diff Bot recipe](https://real-a11y.dev/guide/ci-diff-bot).

## License

MIT
