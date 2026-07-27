---
"@real-a11y-dev/browser": minor
---

`BrowserSession.currentUrl()` — where the page is **now**, which isn't necessarily where `open()` put it.

A dispatched action can navigate (a click on a link or a submit button), so a caller that reports a URL after acting has to re-read it or it reports the address the run started from. `open()`'s return value is a snapshot of that moment and goes stale the instant a step navigates.

```ts
const opened = await session.open(url);
await session.act({ nodeId, action: "click" }); // may navigate
session.currentUrl(); // where it actually ended up
```

Returns `undefined` when no page is open. Not queued — it reads Playwright's cached location rather than touching the page, so it can't race the session's single-flight chain.
