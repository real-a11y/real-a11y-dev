/**
 * The line under the panel's views that relays what the page announces: the
 * last few live-region announcements, each for eight seconds. The top frame
 * reads them through the TIMELINE view's recorder (ADR-0002's one
 * live-region rule, `recordLiveRegions` in timeline-recording.ts), and sends
 * each as a `LIVE_REGION`.
 */

import { useCallback, useRef, useState } from "preact/hooks";

import type { ContentToPanel } from "../types.js";

type LiveRegionMessage = Extract<ContentToPanel, { type: "LIVE_REGION" }>;

export interface LiveEntry {
  id: number;
  text: string;
  level: string;
  role: string;
}

/** How many announcements the line shows at once. */
const SHOWN = 5;
/** How long each stays. */
const SHOWN_MS = 8000;

/** The line's announcements, and `take`, for the panel's listener to hand
 *  each `LIVE_REGION` to. */
export function useLiveLog(): {
  entries: LiveEntry[];
  take: (message: LiveRegionMessage) => void;
} {
  const [entries, setEntries] = useState<LiveEntry[]>([]);
  const lastId = useRef(0);
  const take = useCallback((message: LiveRegionMessage) => {
    const id = ++lastId.current;
    const entry = { id, ...message.payload };
    const drop = (prev: LiveEntry[]) => prev.filter((a) => a.id !== id);
    setEntries((prev) => [...prev.slice(-(SHOWN - 1)), entry]);
    setTimeout(() => setEntries(drop), SHOWN_MS);
  }, []);
  return { entries, take };
}

/** Mounted before the first announcement arrives — see the search count in
 *  NativeTreeView. Relaying the page's live regions through one that is not
 *  itself announced defeats the whole feature. */
export function LiveLog({ entries }: { entries: LiveEntry[] }) {
  return (
    <div class="sn-live-log" role="log" aria-label="Live announcements">
      {entries.map((a) => (
        <div
          key={a.id}
          class={`sn-live-entry ${a.level === "assertive" ? "sn-live-entry--assertive" : ""}`}
        >
          <span class="sn-live-role">{a.role}</span>
          <span class="sn-live-text">{a.text}</span>
        </div>
      ))}
    </div>
  );
}
