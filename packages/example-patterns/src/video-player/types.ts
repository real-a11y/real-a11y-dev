export interface VideoPlayerExampleProps {
  /** Publicly-reachable video URL (e.g. a small mp4). */
  src: string;
  /** Descriptive accessible label of the video content. */
  label: string;
  /** URL of a WebVTT captions track. */
  captionsSrc?: string;
  /** Poster image shown before playback. */
  poster?: string;
  /** BCP-47 language tag of the captions track (e.g. "en"). */
  captionsLang?: string;
}
