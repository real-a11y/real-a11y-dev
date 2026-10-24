---
"@real-a11y-dev/react": patch
---

`<SemanticNavigator />`, `useSemanticTree` and `useActiveModal` now attach to a root that mounts after them, and the floating panel no longer lists itself in the tree.

- **A root that mounts later.** The navigator read `root.current` while rendering, before React attaches the ref, so a root behind a loading state or a lazy route was never observed: the panel stayed empty and nothing was logged. It now reads the ref after every commit, so the root attaches as soon as the navigator re-renders. When the root can mount without the navigator re-rendering, for example inside a child component with its own state, pass the element instead: `root` now takes an element as well as a ref, as `useSemanticTree` does, so a callback ref kept in state (`const [root, setRoot] = useState<HTMLElement | null>(null)` and `<main ref={setRoot}>`) attaches whenever it mounts.
- **`useSemanticTree` and `useActiveModal` with a ref.** They had the same gap: the ref was read only when the hook first ran or its options changed, so a root that mounted later was never observed and the hooks went on returning `null`. They now read it after every commit of the component that calls them. An element passed to either, or to the navigator, is also no longer mistaken for a ref when it has a `current` property of its own, as a custom element can.
- **The floating panel's own chrome.** Once the tree widened to `<body>`, which a toast's `role="status"` or a menu portaled outside the root does, the floating panel showed up in it: a `complementary "Semantic Navigator panel"` landmark, its title and a **Collapse panel** button, which search found and TAB view listed as a tab stop on the page. The whole panel is now marked as the inspector's own, so the tree skips it.

If you followed the Next.js recipe, copy it again: its snippets never attached the observed root, so the panel they built stayed empty. The component in it now wraps your pages, and the root layout renders them inside it.
