---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/testing": patch
---

Internal, no behaviour change yet: the timeline view's recorder (ADR-0002) is packaged to be injected into a page only while a timeline records, as a second bundle beside the page bundle, so the default page bundle is unchanged. Each run of events leaves the page as it settles, so a navigation keeps what came before. Nothing calls it yet; the CLI's `timeline` command and the MCP tools will. The CLI and the MCP server carry the new bundle (23.5 kB gzipped) in their own builds. `recordTimeline` in `testing` runs the same recorder, which gains a strict-mode option (`redactInput`) that nothing in `testing` passes yet, so what it records and prints is unchanged.
