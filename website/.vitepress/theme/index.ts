import DefaultTheme from "vitepress/theme";

import NotFound from "./NotFound.vue";

import "./style.css";

// Extend the default theme, replacing only the built-in NotFound component.
// All other layouts, components, and styles are inherited unchanged.
// `style.css` bridges the @real-a11y-dev/design tokens to VitePress's
// `--vp-*` variables — see the comments inside.
export default {
  extends: DefaultTheme,
  NotFound,
};
