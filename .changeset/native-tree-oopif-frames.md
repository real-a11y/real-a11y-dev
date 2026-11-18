---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/testing": patch
---

The native tree now reads iframes Chromium runs in a process of their own. Under site isolation — the Chrome for Testing `real-a11y install` fetches, and any Chrome reached over `--cdp` — a cross-site or `sandbox`ed `<iframe>` runs in its own renderer process, so its row in `tree`, `audit`, `inspect`, `outline`, `snapshot`, the MCP tools and the testing package's native mode still came back empty after iframes were first read. Each such frame is now read over a session of its own and sits under its `Iframe` row like any other: its fields follow the same value policy (a card number in a cross-site payment frame reads `[redacted]`, and `--redact-input` / `redactInput` withholds every value), its nodes are located from the frame's own `<iframe>` (`… >>> body > form > button`), and a session pinned to origins still reads only frames from them. Node ids in such a frame carry the frame (`ax-dom-8@<frameId>.<documentId>`), since element ids restart in every process. Saved native snapshots and baselines of pages with cross-site or sandboxed iframes will churn: re-record them.
