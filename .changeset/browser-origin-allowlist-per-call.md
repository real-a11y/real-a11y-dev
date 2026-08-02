---
"@real-a11y-dev/browser": minor
---

`BrowserSession.open` gains `OpenOptions.allowedOrigins` for per-call origin pinning.

`assertAllowedOrigin` is now public so the session daemon (and other callers) can reuse the same origin-gating logic. A non-empty per-call allowlist is intersected with the session-level list, so a single call cannot widen a pinned session's origins; an empty or absent per-call value falls back to the session-level list.
