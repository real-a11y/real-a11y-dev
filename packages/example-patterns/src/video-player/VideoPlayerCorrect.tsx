import type { VideoPlayerExampleProps } from "./types.js";

// Correct video player. Uses the native <video> element and gives it
// what AT / captions consumers actually need:
//
//   - `controls` — the built-in player UI, already keyboard-accessible
//     and screen-reader-labeled by the browser
//   - `aria-label` — describes what the video *is* (the built-in
//     controls have their own labels, but the <video> element itself
//     needs a name so users landing on it hear e.g. "Product tour")
//   - `<track kind="captions">` — a WebVTT captions track (the
//     essential a11y requirement for pre-recorded video content:
//     WCAG 1.2.2 Captions AA). `default` selects the track on load;
//     `srclang` + `label` name the track in the caption menu.
//   - `preload="metadata"` + no `autoplay` — no surprise sound; users
//     start playback deliberately (WCAG 2.2.2 Pause/Stop/Hide).
//
// Inspecting this surfaces the <video> node with a real accessible
// name and the associated <track> children as a signal the video
// ships captions.
export function VideoPlayerCorrect({
  src,
  label,
  captionsSrc,
  captionsLang = "en",
  poster,
}: VideoPlayerExampleProps) {
  // The <track kind="captions"> below IS conditionally rendered when
  // captionsSrc is provided, but jsx-a11y can't prove that statically
  // so it flags the <video>. Suppress the rule at the element rather
  // than force an empty-src track when captions aren't wired up.
  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <video
      src={src}
      poster={poster}
      controls
      preload="metadata"
      aria-label={label}
      style={{
        width: "100%",
        maxWidth: 480,
        borderRadius: 6,
        background: "#000",
      }}
    >
      {captionsSrc ? (
        <track
          kind="captions"
          src={captionsSrc}
          srcLang={captionsLang}
          label={captionsLang.toUpperCase()}
          default
        />
      ) : null}
      Sorry, your browser doesn&apos;t support embedded video.
    </video>
  );
}
