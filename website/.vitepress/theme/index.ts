import DefaultTheme from "vitepress/theme";
import NotFound from "./NotFound.vue";

// Extend the default theme, replacing only the built-in NotFound component.
// All other layouts, components, and styles are inherited unchanged.
export default {
  extends: DefaultTheme,
  NotFound,
};
