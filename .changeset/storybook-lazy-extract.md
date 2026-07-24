---
"@real-a11y-dev/storybook-addon": minor
---

Make Storybook preview extraction lazy: the DomObserver / LiveTreeExtractor only run while the Semantic Navigator panel is open. The manager already emitted `REQUEST_TREE` on mount; it now also emits `STOP_TREE` on unmount so the preview tears down, and re-emits `REQUEST_TREE` on `storyRendered` so a canvas/iframe reload while the panel stays open resumes extraction instead of leaving "Waiting…". `storyRendered` / `storyChanged` in the preview no longer start the pipeline unconditionally — registering the addon no longer means every Controls-driven or animated story pays full-tree extract + channel `postMessage` cost while you're on another tab. Custom channel listeners that assumed always-on `TREE_UPDATED` should open the panel (or emit `REQUEST_TREE`) to start receiving updates.
