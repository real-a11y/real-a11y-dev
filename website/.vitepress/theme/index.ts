import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";

import NotFound from "./NotFound.vue";
import ZoomImage from "./components/ZoomImage.vue";

import "./style.css";

// Extend the default theme, replacing only the built-in NotFound component.
// All other layouts, components, and styles are inherited unchanged.
// `style.css` bridges the @real-a11y-dev/design tokens to VitePress's
// `--vp-*` variables — see the comments inside.
//
// `ZoomImage` is registered globally so any page can use it in markdown
// without a `<script setup>` import.
export default {
  extends: DefaultTheme,
  NotFound,
  enhanceApp({ app }) {
    app.component("ZoomImage", ZoomImage);
  },
} satisfies Theme;
