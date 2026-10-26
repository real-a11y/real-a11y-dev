---
"@real-a11y-dev/storybook-addon": patch
---

The Semantic Navigator panel keeps its mode on the way back from a Docs page, instead of starting over on **A11Y**.

Storybook unmounts the panel on a Docs page, and clicking a component in the sidebar opens its Docs page first when it has one, so with the panel on **DOM**, moving to another component's story that way brought it back on **A11Y**. The panel now keeps both the view it shows and the mode the story is extracted in as Storybook addon state, for as long as the Storybook tab stays open, and a new panel asks for its first tree in the kept mode: **DOM** comes back as **DOM**, and **Tab** as **Tab** over the tree it was showing.
