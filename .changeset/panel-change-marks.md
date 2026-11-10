---
"@real-a11y-dev/inspector": minor
"@real-a11y-dev/react": minor
"@real-a11y-dev/storybook-addon": patch
---

The panel marks what changed in the tree, as the Chrome extension does, so opening a menu shows the button that went expanded and the menu that came without hunting for them.

- Each update of the tree marks what it changed: a new row flashes green and a changed one amber, then keeps a coloured edge. The top row of something new says _new_, a changed row says _changed_ (with what changed in its tooltip) and has the changed part underlined or outlined, and a collapsed row says what changed under it (_2 new inside_). A new row with rows under it opens, so what the page added shows. A bar under the tree counts the changes, lists the rows removed, and goes from change to change, as Alt+N and Alt+Shift+N do in the tree. None of it is colour alone: a screen reader hears each mark at the end of the row's label.
- What a click or a key of the user's on the page (a screen reader's activation included), or an action sent through the tree, brought in the five seconds after it stays marked together, so the items a menu fetches stay marked with the button that opened it, and is said in a polite live region ("3 new, 1 changed in the tree"). Typing in a field ends that, so a list that filters as the user types isn't read out at every key, and a pick of the element picker, which the page never sees, starts none. What the page changes on its own is marked without being said, and an update that changes nothing the tree shows leaves the marks as they were.
- Only the page the panel was given is marked: when a toast or a menu mounted outside it makes the tree show the whole page, the overlay is marked new, and the rest of the page it brings isn't.
- A row is changed when what it shows changes: in the A11Y view its role, name, heading level, state and interaction badges, the rows it controls, or a leaf's text; in the DOM view its attributes, text and badges, or whether it is hidden. A class that toggles on hover marks nothing in the A11Y view.
- A modal that hides the rest of the page from the tree marks the dialog new and nothing removed, and once it closes the marks show what it changed on the page. A menu or a listbox opened the same way, as Radix's dropdown menu and select hide the rest of the page, is taken the same way.
- The checkpoint button (⎌) marks everything since it was pressed the same way, through every later update, until it is pressed again, and what a click after it brings is said with all it counts ("4 new, 2 changed since the checkpoint"), down as well as up, to "No changes since the checkpoint". Its `+`/`~` column and the list of removed rows under the tree are gone: the marks and the changes bar replace them.
- The changes bar shows in the TAB view and with a role filter on too, where the counts and the removed rows still hold; its arrows, which go to rows in the tree, only in the tree.
- `@real-a11y-dev/inspector`: `SemanticNavigatorConfig` gains `markChanges?: boolean` (default `true`). `false` marks nothing until the checkpoint is pressed.
- `@real-a11y-dev/inspector`: `refresh()` reads the tree again where the panel stands instead of remounting it, so the selection, the open rows and the checkpoint stay, and what the read finds changed is marked. `setRoot()` still starts the panel over.
- In a light-DOM mount (`mount: "light"`), the panel's own live regions no longer make the tree read the whole page as if they were a toast outside the root.
- `@real-a11y-dev/react`: `<SemanticNavigator>` gains the matching `markChanges` prop. Changing it remounts the navigator.
- `@real-a11y-dev/storybook-addon`: the panel's stylesheet now carries the marks' rules too. The addon doesn't mark changes yet, so nothing it shows changes.
