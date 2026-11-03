---
---

`semantic-navigator-ui` drops the `useIndexById` export, which only the Chrome extension's in-page tree used, and three comments that named that tree. Its own panel still uses the hook internally, and no published package's output changes. The extension's entry is in its own `CHANGELOG.md`.
