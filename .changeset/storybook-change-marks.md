---
"@real-a11y-dev/storybook-addon": minor
---

The Storybook panel marks what changed in the story's tree, as the inspector's and `<SemanticNavigator />`'s do, so opening a menu in a story shows the button that went expanded and the menu that came.

- Each update of the tree is compared with the one before: new and changed rows flash and keep a coloured edge, tags and underlines say what changed, a bar under the tree counts it and lists the rows removed, and Alt+N goes from change to change.
- What a click or a key of yours on the story, or an action run from the tree, brought in the five seconds after it is said to a screen reader ("4 new, 1 changed in the tree"). Typing in a field isn't read out at every key, and what the story changes on its own is marked without being said.
- A menu or toast the story mounts outside its root is marked new on its own; the rest of the preview page the panel then reads isn't.
- A new story, the other mode, a reloaded canvas, and the panel shown again after another addon tab start over. So does the story's first render: a story switch no longer reads as everything new.
- `parameters: { realA11y: { markChanges: false } }` turns the marks off, for every story in `.storybook/preview.ts` or for one.
- The channel carries what the marks need: `EVENTS.USER_INPUT` (what the user did on the story, while the panel is open), and `storyRows` and `storyRendered` on the `TREE_UPDATED` payload.
