# @real-a11y-dev/semantic-navigator-ui

Preact tree rendering components for [Semantic Navigator](https://real-a11y.dev).

Provides the interactive tree view UI used by the inspector, the React wrapper, the Storybook addon, and the Chrome extension. Built with Preact for minimal bundle size — the `TreeView` entry point measures ~5 KB gzipped (excluding `preact` and `@real-a11y-dev/core`, which consumers usually share).

## Internal package — not published to npm

Every consumer already **bundles** it rather than resolving it: the inspector and
the Storybook addon's manager entry both list it in `noExternal`, and the Chrome
extension is private too. So there is nothing to install — you get these
components through
[`@real-a11y-dev/inspector`](../inspector),
[`@real-a11y-dev/react`](../react), or
[`@real-a11y-dev/storybook-addon`](../storybook-addon).

It was published up to `0.1.0-beta.11` before becoming internal. If you imported
it directly, one of the three packages above is the supported route.

The rest of this file documents the components for anyone working on them inside
the workspace.

## Components

### TreeView

Main tree container. Extracts the tree from a root DOM element and renders it with full keyboard navigation, search, and interaction support. Live updates go through core's `LiveTreeExtractor` — `DomObserver` flushes feed `refresh(change)` so steady-state mutations re-extract only the dirty subtree (with a full-extract fallback when scope or cross-tree ARIA deps move), matching the extension / `useSemanticTree` / Storybook preview path. Each flush also runs `preserveExpandedState` so the user's expand/collapse choices survive re-extraction (a11y mode otherwise rebuilds every node with a depth heuristic).

```tsx
import { TreeView } from "@real-a11y-dev/semantic-navigator-ui";

<TreeView
  root={document.body}
  initialViewMode="a11y"
  interactive={true}
  theme="auto"
  onNodeSelect={(node) => console.log(node)}
  onAction={(request, result) => console.log(request, result.success)}
/>
```

### TreePanel

Controlled counterpart to `TreeView`. Renders a pre-extracted `ExtractionResult` with full interactivity (search, filter, expand/collapse, tab sequence) but does **not** observe or extract from the DOM itself — all DOM side-effects are proxied back to the caller via callbacks. Used by the Storybook addon manager panel, where the tree data crosses the iframe boundary as serialized JSON and there is no live DOM root to observe. Hosts that replace `treeData` on every live update should call `preserveExpandedState(prev, next)` (same helper `TreeView` uses) so expand/collapse is not reset.

### TreeToolbar

Search bar, DOM/A11Y view toggle, expand/collapse controls, and the checkpoint button.

### TreeNode

Single tree node with expand/collapse toggle, label rendering (DOM or A11Y mode), state badges, and action button.

## Change marks

`TreeView` marks what each update of the tree changed, as the extension marks what each read of Chrome's tree changed, with the same code (`tree-changes*.ts`, `hooks/useTreeChanges.ts`). A new or changed row keeps a coloured edge and flashes as it comes, a tag says _new_ or _changed_ (with what changed in its title) and what changed on the row is underlined or outlined, a collapsed row says what changed under it (_2 new inside_), a bar under the tree counts it all and lists the rows removed, which have no row (and no element) left to mark, and Alt+N and Alt+Shift+N go from change to change. None of it is colour alone: a screen reader hears each mark at the end of the row's label.

What the user does starts a run: a click or a key on the page (a screen reader's activation arrives as a click alone), or an action sent through the tree, but not a pick of the element picker. The updates in the five seconds after it compare with the tree from before it, so the items a menu fetches stay marked with the button that opened it, and what they find is said in a polite live region. Typing in a field ends that, so a list that filters as the user types is marked without being read out at every key. Any other update is marked and not said, and one that changes nothing the tree shows leaves the marks as they are (`hooks/usePageChanges.ts`). A modal that hides the rest of the page from the tree marks the dialog new and nothing removed, and so does a menu or listbox opened the same way, as Radix's dropdown menu and select are (`tree-changes-dialogs.ts`).

Only the page `TreeView` was given counts: a toast or a menu mounted outside its `root` makes the extractor read the whole page, and only the overlay is marked, not the page around the root it brings. What counts as a change is what the row shows, in its view (`semantic-tree-diff.ts`): the A11Y view's role, name, level, badges, controlled rows and a leaf's text, or the DOM view's attributes, text and badges, and whether the element is hidden. A class toggling on hover marks a DOM row, and nothing in the A11Y view.

`markChanges={false}` turns it off. The toolbar's checkpoint button (`⎌`) still works then: it pins the tree as it is, and everything that changes since is marked the same way until the button is pressed again (`enableDiff={false}` hides it). Marks and checkpoint are both dropped when the view mode or the `root` changes, since a tree of another kind or another subtree shares no rows with them.

`TreePanel` is the controlled component: it marks whatever its `changes` prop holds (a `TreeChangesProp`: the marks, how to clear them, and what they are compared with) and nothing without it, and leaves `enableDiff` off by default, because the host owns what is compared.

> This is the in-page, interaction-scoped diff. It is keyed on live node identity, so it dies on navigation. For a diff that survives navigation and gates CI, use the snapshot fingerprint diff — the `real-a11y snapshot` / `real-a11y diff` CLI commands, or the MCP checkpoint tools, each carrying the internal [`@real-a11y-dev/snapshot`](../snapshot) engine.

## Hooks

### useVirtualTree

Virtualizes a fixed-height flattened tree list. Used internally by `TreePanel` and `TreeView` to render only the rows in the viewport plus overscan; exported for consumers building custom tree views.

`containerRef` is a **callback ref** — attach it to the scrollable element so the hook is measured the moment that element mounts, even when it renders conditionally (e.g. behind a loading screen):

```tsx
import { useVirtualTree } from "@real-a11y-dev/semantic-navigator-ui";

const { containerRef, startIndex, endIndex, totalHeight, offset, onScroll } =
  useVirtualTree(visibleNodeIds.length);

return (
  <div ref={containerRef} class="sn-tree-container" onScroll={onScroll}>
    {/* boxSizing: border-box keeps the spacer exactly `totalHeight` tall —
        paddingTop is absorbed inside it. Without it the element grows to
        offset + totalHeight as you scroll, leaving trailing blank space. */}
    <div
      style={{ minHeight: totalHeight, paddingTop: offset, boxSizing: "border-box" }}
    >
      {visibleNodeIds.slice(startIndex, endIndex).map((id) => (
        <Row key={id} id={id} />
      ))}
    </div>
  </div>
);
```

## Keyboard navigation

Follows the [WAI-ARIA TreeView pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/):

- Arrow keys for navigation
- Enter to activate (on a slider/spinbutton, steps the value up; `Shift+Enter`, `-`, or `_` steps down; `+` / `=` steps up)
- Space to toggle expand/collapse
- Home/End to jump
- `Alt+J` follows the selected row's `aria-controls` jump chips — the first row it controls, then the next on each press — and `Alt+Shift+J` goes back to the row the jump came from (or the first row that controls this one). The chips sit outside the Tab order, so this is their keyboard path. Matched on the physical `J` key or the character, so it works with macOS Option and on Dvorak or Colemak. The tree lists both in `aria-keyshortcuts`.
- Type-ahead — printable characters move selection to a visible row whose accessible name starts with the typed buffer (multi-character within 500ms keeps a still-matching selection; repeating the same letter cycles matches). `/` focuses the search input instead. The same type-ahead and slider/spinbutton stepper keys (`+`/`-`/`Shift+Enter`) apply to the filtered-role and tab-sequence listboxes.

## Styling

Self-contained CSS with CSS custom properties for theming. No Tailwind or framework dependencies.

Inside the workspace, the `./styles` subpath resolves the stylesheet directly:

```ts
import "@real-a11y-dev/semantic-navigator-ui/styles";
```

Published consumers never take that route. The inspector and the Storybook addon
read `src/styles/*.css` at build time and inline it through an esbuild `define`,
so the CSS ships inside their bundles and no import is needed — which is also why
making this package private costs those consumers nothing.

Supports light, dark, and auto (system preference) themes.

## License

MIT
