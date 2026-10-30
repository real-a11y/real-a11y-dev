---
---

Type-safety only: `storybook-addon` now compiles with `noUncheckedIndexedAccess`, so `pickStoryRoot` reads its one story child through destructuring and the panel's `ResizeObserver` callback checks its entry exists. Both behave exactly as before, so this releases nowhere.
