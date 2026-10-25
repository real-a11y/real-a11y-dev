/// <reference types="chrome" />

import { useCallback, useEffect, useState } from "preact/hooks";

/**
 * A switch of the panel's kept in `chrome.storage.local` under `key`, and
 * followed while the panel is open, so every open panel (one per window)
 * agrees with a change made in any of them. On only where storage holds
 * `true`. Setting it changes it here at once, and stores it.
 */
export function useStoredFlag(key: string): [boolean, (on: boolean) => void] {
  const [value, setValue] = useState(false);
  useEffect(() => {
    // Absent where the panel runs without extension storage (unit tests).
    if (!chrome.storage?.local || !chrome.storage.onChanged) return;
    const read = (stored: unknown) => setValue(stored === true);
    void chrome.storage.local
      .get(key)
      .then((r) => read(r[key]))
      .catch(() => {});
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "local" && key in changes) read(changes[key]!.newValue);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [key]);
  const set = useCallback(
    (on: boolean) => {
      setValue(on);
      void chrome.storage?.local?.set({ [key]: on }).catch(() => {});
    },
    [key],
  );
  return [value, set];
}
