<script setup lang="ts">
/**
 * An image in the docs that can be enlarged into a modal dialog.
 *
 *     <ZoomImage label="Tab order view" style="max-width: 540px">
 *       <img src="../public/tab-order-view.svg" alt="…" />
 *     </ZoomImage>
 *
 * The diagrams on the `reading-the-*-view` pages carry small labels, and the
 * text column holds them to well under their drawn size. They stay legible
 * only if a reader can see them bigger.
 *
 * ## Why not `medium-zoom`, the usual VitePress recipe
 *
 * It puts a click listener on the `<img>` and stops there: an image is not
 * focusable, so there is no keyboard path in, and the zoomed view is not a
 * dialog, so nothing moves focus into it or back out. On the docs site of an
 * accessibility toolchain, a mouse-only control is the wrong thing to ship.
 *
 * ## Why the trigger is its own button, beside the image
 *
 * Wrapping the `<img>` in the button is the obvious markup, and it costs the
 * image its alt text. A button's children are presentational, so the alt
 * either becomes the button's whole name (some of these alts run to 300
 * characters, announced on every focus) or disappears behind an
 * `aria-label`. Kept outside, the image is read in place as an image, and the
 * button gets a short name of its own: visible "Enlarge", plus `label` so
 * that two of them on one page can be told apart.
 *
 * Clicking the image opens the dialog too, as a pointer shortcut for the
 * same button, which is the one every input can reach.
 *
 * ## Why a native `<dialog>`
 *
 * `showModal()` puts it in the top layer and makes the rest of the page inert,
 * and Escape closes it, with no focus-trap code of ours to get wrong. Focus
 * goes back to the trigger when it closes, however it was closed.
 */
import { nextTick, ref } from "vue";

defineProps<{
  /**
   * A short name for the image, such as "Tab order view". It names the
   * Enlarge button ("Enlarge image: Tab order view") and the dialog.
   */
  label: string;
}>();

const root = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
const dialog = ref<HTMLDialogElement>();

// Read from the slotted `<img>` when the dialog opens, rather than passed in
// as props: the slot keeps the `src` relative in the markdown, which is what
// lets Vite fingerprint the asset, and the URL it resolves to exists only in
// the rendered element.
const image = ref<{ src: string; alt: string; ratio: number; max?: number }>();

async function open() {
  const img = root.value?.querySelector<HTMLImageElement>(".sn-zoom-image img");
  if (!img || !dialog.value || dialog.value.open) return;

  // The rendered box gives the aspect ratio even for an SVG with only a
  // `viewBox`, which has no natural size to read it from.
  const { width, height } = img.getBoundingClientRect();
  image.value = {
    src: img.currentSrc || img.src,
    alt: img.alt,
    ratio: width / height,
    // A raster image stops at its natural width, so it is never shown blurred.
    // A vector one scales freely.
    max: /\.svg(?:$|[?#])/i.test(img.currentSrc || img.src)
      ? undefined
      : img.naturalWidth,
  };

  await nextTick();
  dialog.value.showModal();
}

function close() {
  dialog.value?.close();
}

// A click on the backdrop lands on the `<dialog>` itself. Everything inside
// sits in `.sn-zoom-panel`, so its clicks never match.
function onDialogClick(event: MouseEvent) {
  if (event.target === dialog.value) close();
}

function onClose() {
  image.value = undefined;
  trigger.value?.focus();
}
</script>

<template>
  <div ref="root" class="sn-zoom">
    <div class="sn-zoom-image" @click="open">
      <slot />
    </div>
    <button
      ref="trigger"
      type="button"
      class="sn-zoom-trigger"
      aria-haspopup="dialog"
      @click="open"
    >
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 16 16"
        width="14"
        height="14"
      >
        <path
          d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      Enlarge<span class="visually-hidden"> image: {{ label }}</span>
    </button>
    <dialog
      ref="dialog"
      class="sn-zoom-dialog"
      :aria-label="label"
      @click="onDialogClick"
      @close="onClose"
    >
      <div v-if="image" class="sn-zoom-panel">
        <div class="sn-zoom-toolbar">
          <a :href="image.src" target="_blank" rel="noopener">
            Open in new tab
          </a>
          <button type="button" class="sn-zoom-close" autofocus @click="close">
            Close
          </button>
        </div>
        <img
          :src="image.src"
          :alt="image.alt"
          :style="{
            '--sn-zoom-ratio': image.ratio,
            maxWidth: image.max ? `${image.max}px` : undefined,
          }"
          @click="close"
        />
      </div>
    </dialog>
  </div>
</template>

<style scoped>
/* Centred in the column. The page sets the width and the vertical margin
 * with a `style` on the component, which lands on this element. */
.sn-zoom {
  display: flex;
  flex-direction: column;
  margin-inline: auto;
}

.sn-zoom-image {
  cursor: zoom-in;
}
.sn-zoom-image :slotted(img) {
  display: block;
  width: 100%;
  height: auto;
}

.sn-zoom-trigger,
.sn-zoom-close {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.2rem 0.7rem;
  font-size: 0.8rem;
  font-weight: 500;
  line-height: 1.5;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  cursor: pointer;
}
.sn-zoom-trigger:hover,
.sn-zoom-close:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}
.sn-zoom-trigger:focus-visible,
.sn-zoom-close:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}

/* Under the image, not over it: laid on top, it hid part of a diagram at
 * phone width. */
.sn-zoom-trigger {
  align-self: flex-end;
  margin-top: 0.5rem;
}

.sn-zoom-dialog {
  max-width: 96vw;
  max-height: 96dvh;
  padding: 0;
  overflow: auto;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  box-shadow: 0 12px 48px rgb(0 0 0 / 0.3);
}
.sn-zoom-dialog::backdrop {
  background: rgb(0 0 0 / 0.7);
}

.sn-zoom-panel {
  padding: 0.75rem;
}

.sn-zoom-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 1rem;
  margin-bottom: 0.75rem;
  font-size: 0.85rem;
}

/* Fit the viewport on whichever side runs out first. */
.sn-zoom-panel img {
  display: block;
  width: min(92vw, calc(82dvh * var(--sn-zoom-ratio)));
  height: auto;
  margin: 0 auto;
  cursor: zoom-out;
}
</style>
