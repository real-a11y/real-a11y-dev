<script setup lang="ts">
/**
 * VitePress's `VPFeature`, with an accessible name on the linked cards.
 *
 * ## The defect
 *
 * A home-page feature with a `link:` renders as `<a class="VPFeature">`
 * wrapping `<article class="box">`. Chromium computes **no accessible name**
 * for that link: `article` does not support name-from-content, so the walk
 * stops at it and never reaches the `<h2>` inside. Verified against the
 * running site with our own CLI (`real-a11y list link`), which reads
 * Chromium's tree over CDP and printed three bare `link` rows with no name.
 *
 * A screen reader user tabbing the home page heard "link", three times, with
 * nothing to distinguish the Chrome extension from the CLI from the MCP
 * server — on the home page of an accessibility tooling project. Our own
 * `no-unlabeled-interactive` rule flagged it the moment the CI diff bot
 * started reading the native tree.
 *
 * ## Why an explicit name, rather than making the content nameable
 *
 * The other repair — swap `<article>` for a `<div>` so name-from-content
 * reaches the text — produces a *technically named* link whose name is the
 * whole card: icon, heading, the entire details paragraph, and the call to
 * action, concatenated. Roughly 300 characters announced on focus. That is
 * what the in-page DOM walk was already computing, and seeing it written out
 * is the argument against it:
 *
 *     link "🧩Chrome extensionOpen the side panel on any website and explore
 *     its DOM, A11y, and TAB views live. Highlights elements on the page as
 *     you navigate the tree. No code, no setup.Install the extension"
 *
 * Passing a lint rule is not the goal; a name someone can act on is. So the
 * name is authored: the card's heading, plus its call to action.
 *
 * Both halves are visible text, which is what [WCAG 2.5.3 Label in
 * Name](https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html)
 * asks for — a voice-control user who says "click Chrome extension" and one
 * who says "click Install the extension" both hit this card. Naming it after
 * only one of the two would break the other.
 *
 * The details paragraph stays out of the name and stays *in* the link:
 * `link` does not make its children presentational, so a screen reader
 * reading the page still encounters the full text. It is context, not a
 * label.
 *
 * ## Why a wrapper and not a fork
 *
 * `features:` frontmatter has no field for this, so the component has to be
 * overridden ([Overriding Internal
 * Components](https://vitepress.dev/guide/extending-default-theme#overriding-internal-components)).
 * This renders the real `VPFeature` and lets `aria-label` fall through to its
 * root — which is `VPLink`, whose own root is the `<a>`. Copying VitePress's
 * template and its ~90 lines of scoped CSS would work too, and would then
 * silently rot against every VitePress upgrade. Nothing here is duplicated,
 * so an upstream change to the card's markup or styling still lands.
 */
import type { DefaultTheme } from "vitepress/theme";
// Imported by package path, not `./VPFeature.vue`: the alias in `config.ts`
// rewrites that exact specifier, and matching it here would point this file
// at itself.
import VPFeature from "vitepress/dist/client/theme-default/components/VPFeature.vue";
import { computed } from "vue";

const props = defineProps<{
  icon?: DefaultTheme.FeatureIcon;
  title: string;
  details?: string;
  link?: string;
  linkText?: string;
  rel?: string;
  target?: string;
}>();

// Only the linked cards. A card without `link:` renders as a `<div>`, which
// has no role to name — labelling it would invent a named node in the tree
// where the markup has nothing to announce.
const label = computed(() =>
  props.link
    ? [props.title, props.linkText].filter(Boolean).join(": ")
    : undefined,
);
</script>

<template>
  <VPFeature v-bind="props" :aria-label="label" />
</template>
