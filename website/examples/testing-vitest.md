# Example: Vitest Integration

Demonstrates `@real-a11y-dev/testing` in a Vitest + jsdom test suite — snapshots, structural assertions, and the `flow()` chain.

**Source:** [`examples/testing-vitest/`](https://github.com/real-a11y/real-a11y-dev/tree/main/examples/testing-vitest)

## What it shows

- `auditSnapshot()` as a Vitest snapshot
- `assertNoUnlabeledInteractive()` in a form component test
- `assertHeadingOrder()` checking page-level heading structure
- `assertLandmarkStructure()` verifying `main`/`header`/`footer`
- `flow()` chaining through a combobox interaction
- `outlineSnapshot()` + `tabSequenceSnapshot()` for structure tests

## Run it locally

```sh
git clone https://github.com/real-a11y/real-a11y-dev.git
cd real-a11y-dev
pnpm install
pnpm --filter @real-a11y-dev/example-testing test
```

## Key code

### Snapshot test

```ts
// examples/testing-vitest/src/snapshot.test.ts
import { render } from "@testing-library/react";
import { auditSnapshot, assertNoUnlabeledInteractive } from "@real-a11y-dev/testing";
import { LoginForm } from "./LoginForm";

describe("LoginForm accessibility", () => {
  it("matches the a11y tree snapshot", () => {
    const { container } = render(<LoginForm />);
    expect(auditSnapshot(container)).toMatchSnapshot();
  });

  it("has no unlabeled interactive elements", () => {
    const { container } = render(<LoginForm />);
    assertNoUnlabeledInteractive(container);
  });
});
```

### Structural assertions

```ts
// examples/testing-vitest/src/assertions.test.ts
import { render } from "@testing-library/react";
import {
  assertHeadingOrder,
  assertLandmarkStructure,
  outlineSnapshot,
} from "@real-a11y-dev/testing";
import { Page } from "./Page";

describe("Page structure", () => {
  it("has correct heading order", () => {
    const { container } = render(<Page />);
    assertHeadingOrder(container);
  });

  it("has correct landmark structure", () => {
    const { container } = render(<Page />);
    assertLandmarkStructure(container);
  });

  it("matches the heading outline snapshot", () => {
    const { container } = render(<Page />);
    expect(outlineSnapshot(container)).toMatchSnapshot();
  });
});
```

### Flow chain — combobox interaction

```ts
// examples/testing-vitest/src/flow.test.ts
import { render } from "@testing-library/react";
import { flow, findAllByRole } from "@real-a11y-dev/testing";
import { CountrySelector } from "./CountrySelector";

test("selecting a country closes the dropdown", async () => {
  const { container } = render(<CountrySelector />);

  await flow(container)
    .findByRole("combobox", { name: /country/i })
    .click()
    .findByRole("option", { name: "Spain" })
    .click()
    .expect((tree) => {
      // After selection, the combobox should be collapsed
      const combo = findAllByRole(tree, "combobox")[0];
      expect(combo?.a11y.states.expanded).toBe(false);
    });
});
```

### Tab sequence test

```ts
// examples/testing-vitest/src/tabs.test.tsx
import { render } from "@testing-library/react";
import { tabSequenceSnapshot } from "@real-a11y-dev/testing";
import { Navigation } from "./Navigation";

test("navigation tab sequence is correct", () => {
  const { container } = render(<Navigation />);
  expect(tabSequenceSnapshot(container)).toMatchSnapshot();
});
```

## See also

jsdom runs the same audit engine as the browser, but it can't audit a real running app or gate CI on a live page set. For that:

- **[Playwright E2E](./playwright.md)** — the `@real-a11y-dev/testing/playwright` `attach()` adapter runs these same assertions against a real browser page.
- **[`@real-a11y-dev/cli`](https://github.com/real-a11y/real-a11y-dev/tree/main/packages/cli)** — `real-a11y audit` / `snapshot` / `diff` run findings-aware audits over the page set in `a11y.config.json`, ideal for CI.
- **[`@real-a11y-dev/mcp`](https://github.com/real-a11y/real-a11y-dev/tree/main/packages/mcp)** — the same audit engine exposed to AI agents for agent-driven checks.
