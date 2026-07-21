import type { VideoPlayerExampleProps } from "./types.js";

// Hand-rolled "broken" video player. Deliberately wrong on the media
// accessibility axis:
//
//   1. NO `controls` attribute — the video is not keyboard-operable
//      at all. Screen reader / keyboard users have no way to play,
//      pause, seek, or adjust volume.
//
//   2. `autoplay` + `muted` (autoplay requires muted in most
//      browsers) — playback starts without user consent. Combined
//      with (1), the video plays silently and the user can't stop it.
//
//   3. NO aria-label — the <video> node has no accessible name.
//      Screen readers announce it as an unnamed embedded video.
//
//   4. NO <track kind="captions"> — WCAG 1.2.2 fails. Deaf / hard-of-
//      hearing users get no text alternative for the spoken content.
//
// Visually and audibly similar to the correct variant at a glance
// (the poster image renders the same) but the AT and captions story
// is entirely missing.
export function VideoPlayerBroken({
  src,
  label: _label,
  poster,
}: VideoPlayerExampleProps) {
  return (
    <video
      src={src}
      poster={poster}
      autoPlay
      muted
      loop
      playsInline
      style={{
        width: "100%",
        maxWidth: 480,
        borderRadius: 6,
        background: "#000",
      }}
    />
  );
}
