---
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/storybook-addon": patch
---

Stop rebuilding the whole tab sequence on every search keystroke in the tab-sequence view. The tree walk behind `getTabSequence` now sits in its own memo keyed on the nodes, so a keystroke re-runs only this view's filter over the already-computed sequence instead of re-walking the tree. No change to what the view renders.
