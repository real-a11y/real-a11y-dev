---
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/storybook-addon": patch
---

fix(ui): cancel the virtualized tree's pending re-measure frame on teardown. The ResizeObserver defers its re-measure by one `requestAnimationFrame`, and `disconnect()` does not cancel a frame already queued — so in a real browser the callback could still run after the component went away. The frame is now cancelled with the observer. (Test-only companion: every jsdom suite that renders Preact now shares one raf/cancelAnimationFrame setup file, so Preact's own scheduler can't throw after environment teardown.)
