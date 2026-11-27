---
---

Internal refactor, no behaviour change: the extension's live-region text reader (`pageText`) moves into the internal `core` package, split into a text builder and a walk, so `testing`'s timeline reads announcements through the same reader. Core's live-region rule becomes `liveRegionLevel`, which its overlay pivot, the extension and the timeline share. The extension's text reads and core's overlay pivot are unchanged, so this releases nowhere.
