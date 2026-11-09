import { safeGetAttribute } from "./clobber-safe.js";

const TRACK_KINDS = new Set([
  "subtitles",
  "captions",
  "descriptions",
  "chapters",
  "metadata",
]);

/**
 * Normalize a <track>'s kind the way browsers do (verified against
 * Chromium's HTMLTrackElement.kind): the attribute is an enumerated,
 * ASCII case-insensitive value whose MISSING value default is
 * "subtitles" but whose INVALID value default is "metadata" — the two
 * defaults differ, so `<track src=…>` counts as a subtitle track while
 * `<track kind="bogus">` does not. Hand-rolled on getAttribute because
 * jsdom's `.kind` IDL property skips this normalization (returns "" /
 * the raw value), which would make tests diverge from real browsers.
 */
function trackKindOf(track: Element): string {
  const raw = safeGetAttribute(track, "kind");
  if (raw === null) return "subtitles";
  const lowered = raw.toLowerCase();
  return TRACK_KINDS.has(lowered) ? lowered : "metadata";
}

/**
 * True if a media element ships a text alternative for its audio —
 * a captions or subtitles track (the WCAG 1.2.2 signal). Chapters,
 * descriptions, and metadata tracks don't count.
 */
export function hasCaptionsTrack(element: Element): boolean {
  for (const track of element.querySelectorAll("track")) {
    const kind = trackKindOf(track);
    if (kind === "captions" || kind === "subtitles") return true;
  }
  return false;
}
