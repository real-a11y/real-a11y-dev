---
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/testing": patch
---

The outline a selected or hovered row draws on the page shows over an open popover or a modal `<dialog>`. It had the highest z-index there is, which nothing paints over except what is in the browser's top layer, so an element inside a menu shown as a popover was outlined under the menu, out of sight. The outline is now in the top layer itself, where the browser has one, and goes back on top of whatever the page shows there on each draw; it closes none of the page's popovers, brings no backdrop with it, and a page's `[popover]` rules no longer reach it. Its 2px border now sits inside the element's own rect on every page, where a page without a `box-sizing: border-box` rule drew it 4px wider and taller. The DOM observer behind the live trees, and behind `testing`'s `waitForMutations`, doesn't count the outline's own showing as a change to the page; for `testing`, which draws no outline, nothing else changes.
