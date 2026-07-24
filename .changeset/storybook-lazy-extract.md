---
"@real-a11y-dev/storybook-addon": minor
---

Make Storybook preview extraction lazy: the DomObserver / LiveTreeExtractor only run while the Semantic Navigator panel is open. The manager emits `REQUEST_TREE` on mount and `STOP_TREE` on unmount. After a canvas/iframe reload the preview emits `PREVIEW_READY` so an already-open panel can re-request without listening to every `storyRendered` (which would double-extract). `storyRendered` / `storyChanged` in the preview no longer start the pipeline unconditionally — registering the addon no longer means every Controls-driven or animated story pays full-tree extract + channel `postMessage` cost while you're on another tab. Custom channel listeners that assumed always-on `TREE_UPDATED` should open the panel (or emit `REQUEST_TREE`) to start receiving updates.
