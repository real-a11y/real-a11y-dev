import * as React from "react";

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  VideoPlayerBroken,
  VideoPlayerCorrect,
} from "@real-a11y-dev/example-patterns";

afterEach(cleanup);

describe("Content pattern: Video player — correct vs broken", () => {
  it("correct video ships controls, aria-label, and a captions track", () => {
    const { container } = render(
      <VideoPlayerCorrect
        src="/tour.mp4"
        label="Product tour"
        captionsSrc="/tour.vtt"
      />,
    );

    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.hasAttribute("controls")).toBe(true);
    expect(video?.getAttribute("aria-label")).toBe("Product tour");
    expect(video?.hasAttribute("autoplay")).toBe(false);

    const track = container.querySelector('track[kind="captions"]');
    expect(track).not.toBeNull();
  });

  it("broken video autoplays without controls, aria-label, or a captions track", () => {
    const { container } = render(
      <VideoPlayerBroken src="/tour.mp4" label="Product tour" />,
    );

    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.hasAttribute("controls")).toBe(false);
    expect(video?.getAttribute("aria-label")).toBeNull();
    expect(video?.hasAttribute("autoplay")).toBe(true);
    expect(container.querySelector('track[kind="captions"]')).toBeNull();
  });
});
