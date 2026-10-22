---
"@real-a11y-dev/storybook-addon": patch
---

The Semantic Navigator panel no longer covers Storybook's addon tab bar, and the story stops being extracted again while another addon tab is selected or the addon panel is hidden.

From Storybook 10.1, a selected Semantic Navigator panel painted over the tab bar and the **Hide addon panel** button: a mouse click on Controls landed on the tree instead, so the only way back to another tab was the keyboard. That was the panel positioning itself against the whole addon area, which 10.1 stopped boxing in. It now fills its own tab, on every Storybook version.

Storybook 10.1 also started rendering every addon panel at once, so the story went on being extracted and sent to the panel behind every other tab. The panel now asks for a tree only while it is on screen, its tab selected and the addon panel open, and goes idle as soon as it is not. That also makes a hidden panel idle on Storybook 9, where it never was.

The tree is now always extracted in the mode the panel shows. A canvas reload used to leave the panel on **DOM** over an A11Y-mode tree, and on Storybook 9 a tab switch brought it back on **A11Y** over a DOM-mode one. On Storybook 9 the panel still comes back on **A11Y** after a tab switch, as it always has, but now over an A11Y tree.

If you listen on the addon's channel events: `REQUEST_TREE` now carries the mode to extract in, `"a11y"` or `"dom"`.
