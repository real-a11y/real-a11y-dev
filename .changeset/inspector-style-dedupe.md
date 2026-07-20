---
"@real-a11y-dev/inspector": patch
---

Stop shipping the stylesheet twice. `__SN_STYLES__` is an esbuild `define`, so **every** occurrence of the identifier was replaced with the entire stylesheet literal at build time — and the inspector read it at two injection sites (shadow root and light DOM). The bundle therefore carried two complete copies of the CSS, which gzip could not fold together because they sit further apart than its window.

The define is now bound to a module-level constant that both paths read. Behavior is unchanged; the bundle drops by roughly 32 kB raw / 5 kB gzipped.
