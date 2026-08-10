---
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/storybook-addon": patch
---

fix(ui): cancel the virtualized tree's pending re-measure frame on teardown. The ResizeObserver defers its re-measure by one `requestAnimationFrame`; `disconnect()` does not cancel a frame already queued, so it could fire after the component went away, set state, and make Preact schedule post-paint work against a host that had already torn down — surfacing as an intermittent `cancelAnimationFrame is not defined` in the inspector suite on macOS. The frame is now cancelled with the observer.
