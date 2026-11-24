---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Stop jsdom 30 and earlier logging `Not implemented: Window's getComputedStyle() method: with pseudo-elements` in tests that fake `navigator.userAgent`. Under jsdom, names read from content skip the `::before` / `::after` style read: jsdom 30 and earlier do not implement it, and jsdom 31, which does, is skipped too, so a name is the same under every jsdom version. jsdom was recognised by finding "jsdom" in `navigator.userAgent` on every call. A test that fakes a phone's user agent, common when the code under test detects iOS or Android, defeated that, and jsdom 30 reported the call twice per name computed:

```js
Object.defineProperty(navigator, "userAgent", {
  configurable: true,
  get: () => "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) …",
});
treeSnapshot(document.body); // logged "Not implemented" twice per name
```

The check now reads the user agent through `Navigator.prototype`'s own getter, which an own property on `navigator` does not reach. Where a test replaces `navigator` whole (`vi.stubGlobal("navigator", …)`), it recognises jsdom by the error jsdom's getter throws for the stand-in. Once a window is found to be jsdom's, that answer is kept, and every bundled copy of the engine in the page shares it. Names and snapshots are unchanged: jsdom 30 returned the element's own style for those calls, which has no generated content.

- **In a browser** nothing changes: the getter returns the browser's own user agent, as before.
- **`cli` and `mcp`** re-release the bundled engine; their output is unchanged by this release, since they never run it under jsdom.
