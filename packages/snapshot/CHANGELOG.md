# @real-a11y-dev/snapshot

## 0.1.0-beta.11

### Minor Changes

- 31deea2: `--producer native` — audit Chromium's own accessibility tree from the CLI.

  The default (`--producer dom`, unchanged) injects the page-bundle and walks the light DOM in the page. `--producer native` instead reads Chromium's own accessibility tree over CDP (`@real-a11y-dev/browser`'s `nativeTree`) and serializes + audits it in Node — so it reaches structure no in-page walk can, most visibly a `<video controls>`'s play/scrubber/mute controls, which live in a closed user-agent shadow root:

  ```sh
  real-a11y tree https://example.com/player --producer native   # media controls appear
  real-a11y audit https://example.com/player --producer native  # and get audited
  real-a11y outline https://example.com --producer native
  ```

  Native is whole-document and read-only, so the flag is accepted only where that fits: `audit`, `tree`, and `outline`. Commands that carry a tab sequence (`tabs`, `inspect`, `snapshot`) or run the in-page `listByRole` (`list`) reject `--producer native` with guidance, and `--producer native` can't be combined with `--root` (it audits the whole document).

  `@real-a11y-dev/snapshot` gains `projectNativeTree(tree, options?)` — the shared projection that turns a native `ExtractionResult` into the same `CleanSnapshot` the DOM producer yields (serialize + audit in Node, empty tab order). It's what the CLI's native path builds on, and it's reusable by any consumer opting into the native producer.

- 84535a1: Add **a11y snapshot checkpoints** to the MCP server — six tools that give an AI agent the CLI's snapshot + diff power mid-session: capture a page, change something (deploy, feature toggle, DOM edit), then ask what accessibility findings are new / changed / fixed, with the _same_ `v1:` fingerprint identity the CI a11y-diff bot uses.

  - `checkpoint_findings` / `diff_findings` — snapshot the current page under a name, then re-snapshot and diff against it.
  - `diff_checkpoints` — diff two already-stored checkpoints.
  - `list_checkpoints` / `export_checkpoint` / `import_checkpoint` — inspect the store, and bridge to/from CLI-generated `a11y-snapshot.json` artifacts.

  Checkpoints are in-memory, LRU-capped (20), and **survive navigation by design** — so you can `checkpoint_findings("prod")`, open a preview URL, and `diff_findings("prod")` for a cross-deploy accessibility diff in one session. `close_browser` clears them.

  `@real-a11y-dev/snapshot` gains **`buildSnapshotPage()`** — the single capture→fingerprint assembler the CLI's `snapshot` command and the MCP server both call, so their fingerprints are identical (guarded by a cross-tool golden test). `@real-a11y-dev/cli`'s snapshot command re-points to it with byte-for-byte identical output.

- ba4ba95: New package `@real-a11y-dev/snapshot` — the snapshot engine, extracted from `@real-a11y-dev/cli`. It owns the deterministic finding fingerprints, the diffable `a11y-snapshot.json` artifact, the findings/views/unified diff, and baselines, depending on nothing but `@real-a11y-dev/audit` and `@real-a11y-dev/core`. It's Node-only (`node:crypto`) and never enters the page bundle, which makes it the single place a snapshot is captured and compared — so a snapshot taken by the CLI and diffed by the MCP server (or vice-versa) is byte-for-byte identical. The `CliError` the artifact and baseline readers used to throw is now a domain `SnapshotFormatError`.

  **Breaking for `@real-a11y-dev/cli`: it no longer exposes a programmatic `.` library entry — the CLI is a command, not a library.** Everything the old `api` surface re-exported (fingerprints, the artifact, the findings/views/unified diff, baselines, sanitization) now lives in `@real-a11y-dev/snapshot`; import it from there instead. The `real-a11y` binary — its commands, flags, output, and exit codes — is byte-for-byte unchanged (verified against the CLI e2e suite). The CLI also drops its direct `@real-a11y-dev/core` dependency (it followed the engine into `snapshot`) and gains `@real-a11y-dev/snapshot`.

### Patch Changes

- Updated dependencies [1d0eef0]
- Updated dependencies [7f93f92]
- Updated dependencies [6a658fe]
- Updated dependencies [beae032]
- Updated dependencies [cafe048]
- Updated dependencies [725fcc0]
- Updated dependencies [96cb0ee]
- Updated dependencies [f2532e5]
- Updated dependencies [ad8edc1]
- Updated dependencies [d657f66]
- Updated dependencies [1c8a523]
- Updated dependencies [d693a00]
- Updated dependencies [d693a00]
- Updated dependencies [907c68e]
- Updated dependencies [19e9fc2]
- Updated dependencies [a32632a]
- Updated dependencies [4fe0c7b]
- Updated dependencies [8c2a8fa]
- Updated dependencies [2915bc7]
- Updated dependencies [77b4bf2]
- Updated dependencies [22abf6b]
  - @real-a11y-dev/serialize@0.1.0-beta.11
  - @real-a11y-dev/core@0.1.0-beta.11
  - @real-a11y-dev/audit@0.1.0-beta.11
