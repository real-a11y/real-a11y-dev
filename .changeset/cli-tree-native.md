---
"@real-a11y-dev/snapshot": minor
"@real-a11y-dev/cli": minor
---

`--tree native` — audit Chromium's own accessibility tree from the CLI.

The default (`--tree dom`, unchanged) injects the page-bundle and walks the light DOM in the page. `--tree native` instead reads Chromium's own accessibility tree over CDP (`@real-a11y-dev/browser`'s `nativeTree`) and serializes + audits it in Node — so it reaches structure no in-page walk can, most visibly a `<video controls>`'s play/scrubber/mute controls, which live in a closed user-agent shadow root:

```sh
real-a11y tree https://example.com/player --tree native   # media controls appear
real-a11y audit https://example.com/player --tree native  # and get audited
real-a11y outline https://example.com --tree native
```

Native is whole-document and read-only, so the flag is accepted only where that fits: `audit`, `tree`, and `outline`. Commands that carry a tab sequence (`tabs`, `inspect`, `snapshot`) or run the in-page `listByRole` (`list`) reject `--tree native` with guidance, and `--tree native` can't be combined with `--root` (it audits the whole document).

`@real-a11y-dev/snapshot` gains `projectNativeTree(tree, options?)` — the shared projection that turns a native `ExtractionResult` into the same `CleanSnapshot` the DOM producer yields (serialize + audit in Node, empty tab order). It's what the CLI's native path builds on, and it's reusable by any consumer opting into the native producer.
