# @real-a11y-dev/testing

Headless accessibility audit helpers for [Real A11y](https://real-a11y.dev) — snapshots, structural assertions, and a fluent interaction flow. Works in Vitest / Jest (jsdom) out of the box; a Playwright adapter ships as a separate entry point.

```sh
npm install -D @real-a11y-dev/testing
```

## Quick start

```ts
import { render } from "@testing-library/react";
import {
  auditSnapshot,
  assertNoUnlabeledInteractive,
  assertHeadingOrder,
} from "@real-a11y-dev/testing";
import { LoginForm } from "./LoginForm";

test("login form is fully labeled", () => {
  const { container } = render(<LoginForm />);
  assertNoUnlabeledInteractive(container);
  assertHeadingOrder(container);
  expect(auditSnapshot(container)).toMatchSnapshot();
});
```

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

## Docs

Snapshot helpers, assertion reference, `flow()` chain API, and `redact` patterns at **[real-a11y.dev/packages/testing](https://real-a11y.dev/packages/testing)**.

Want a CI diff bot that comments on PRs when the tree changes? See the [CI Diff Bot recipe](https://real-a11y.dev/guide/ci-diff-bot).

## License

MIT
