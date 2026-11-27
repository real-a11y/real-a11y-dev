---
"@real-a11y-dev/testing": patch
---

Internal refactor, no behaviour change: `recordTimeline`'s recorder moves into the internal `core` package and its line format into `serialize`, so every surface that gains the timeline view records it and prints it the same way (ADR-0002). The recorder now records events, a focus stop or an announcement, and `serialize` writes them as the same lines `recordTimeline` printed before. What it records and prints is unchanged.
