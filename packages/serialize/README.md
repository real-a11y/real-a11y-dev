# @real-a11y-dev/serialize

Deterministic text serialization of the [Semantic Navigator](https://real-a11y.dev) accessibility tree. The same string format the Real A11y panel, the testing snapshots, the `real-a11y` CLI (`tree`/`outline`/`tabs`), the MCP server, and the Chrome extension all share.

```sh
npm install @real-a11y-dev/serialize
```

```ts
import {
  serializeTree,
  serializeOutline,
  serializeTabSequence,
} from "@real-a11y-dev/serialize";

serializeTree(document.body);
// main "Sign-in form"
//   heading "Sign in" (level 1)
//   textbox "Email"
//   button "Sign in"

serializeOutline(document.body);
// h1 Sign in

serializeTabSequence(document.body);
// 01. textbox "Email"
// 02. button "Sign in"
```

Each function accepts a DOM root **or** a pre-extracted tree from
[`@real-a11y-dev/core`](https://real-a11y.dev/packages/core), so it works in
jsdom, a real browser, and the extension panel without re-extracting.

`serializeTree` takes `{ mode, redact, includeGeneric }` options — see the
[testing docs](https://real-a11y.dev/packages/testing/snapshots) for the
`redact` pattern reference. The output is stable across runs (roles + names
only, no ids or timestamps), which is what makes it safe to commit and diff.
