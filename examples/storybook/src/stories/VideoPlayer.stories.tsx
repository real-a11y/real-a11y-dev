import type { Meta, StoryObj } from "@storybook/react";
import {
  VideoPlayerCorrect,
  VideoPlayerBroken,
} from "@real-a11y-dev/example-patterns";

/**
 * Content pattern: Video player — paired stories.
 *
 * - **Correct:** native `<video controls>` with a descriptive
 *   `aria-label` + `<track kind="captions">`. No autoplay. Meets
 *   WCAG 1.2.2 (Captions) and 2.2.2 (Pause/Stop/Hide).
 * - **Broken:** `<video autoplay muted loop>` with no controls, no
 *   accessible name, no captions track. Silent-autoplay carousel-
 *   background pattern that AT users can't stop.
 */
const meta: Meta<typeof VideoPlayerCorrect> = {
  title: "Content Patterns/Video Player",
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof VideoPlayerCorrect>;

// Placeholder URLs — Storybook doesn't actually load them; the demo
// is about the DOM shape, not the media content.
const src = "https://example.com/tour.mp4";
const captionsSrc = "https://example.com/tour.en.vtt";

export const Correct: Story = {
  render: () => (
    <VideoPlayerCorrect
      src={src}
      label="Product tour"
      captionsSrc={captionsSrc}
    />
  ),
};

export const Broken: Story = {
  render: () => <VideoPlayerBroken src={src} label="Product tour" />,
};
