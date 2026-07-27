---
"@real-a11y-dev/core": minor
"@real-a11y-dev/audit": minor
"@real-a11y-dev/browser": minor
---

Findings from the native producer now say **where**.

`audit` is rule · severity · locator, but `--producer native` (and MCP `producer: "native"`) reported every finding with no locator at all — a real defect with no address. The DOM producer derives the locator from a live `Element` it holds in an in-page map; the native producer runs in Node over a CDP snapshot and has no such element, so nothing was left to derive from.

The path is now computed during the `DOM.getDocument` walk the native producer already makes — the only place it ever sees parent and sibling links, and free, since that walk was happening anyway. Both producers share one builder (`buildCssPath`, exported from `@real-a11y-dev/core` with `CssPathAdapter` and `DOM_ELEMENT_ADAPTER`), each supplying accessors for its own node shape, so `#panel > div > img:nth-of-type(2)` means the same thing whichever producer found the problem. `SemanticNode["dom"]` gains an optional `locator` to carry it. `list_elements` / `listByRole` gain native locators for the same reason, and the docs that said native had none are corrected.

```
# before                          # after
image-alt   locator: (none)       image-alt   locator: body > main > img
image-alt   locator: (none)       image-alt   locator: #panel > div > img
```

One case has no honest answer and is treated as one: the native walk pierces shadow roots and the in-page walk doesn't, so native alone reaches elements with no whole-document selector. Those paths stop at the boundary — `button:nth-of-type(2)`, not a `#document-fragment > button` that would look queryable and match nothing.

**Native snapshots taken before this will not diff cleanly against ones taken after.** A finding's fingerprint includes its locator, so native findings that previously fingerprinted with an empty anchor now fingerprint with a real one: `real-a11y diff` will read a re-run of an unchanged page as every finding fixed and re-introduced. Re-baseline native artifacts once. DOM-producer artifacts are unaffected — their locators never changed.
