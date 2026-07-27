/// <reference types="chrome" />

/**
 * Per-tab screen-curtain state, mirrored into `chrome.storage.session`.
 *
 * Everything else the background tracks (frame trees, the connected-panel
 * flag) is re-derived for free after an MV3 service-worker death: content
 * scripts re-announce, the panel reconnects its port. The curtain is the
 * exception — it is painted in the *page*, so it outlives the worker with
 * nothing left in the worker that remembers it. A revived worker with an
 * empty map skips `TOGGLE_CURTAIN(false)` on panel close and strands the
 * user behind a black overlay with no UI to dismiss it.
 *
 * `chrome.storage.session` is the right store: memory-backed (never touches
 * disk), cleared when the browser restarts, and — unlike the worker's module
 * scope — it survives the ~30s idle teardown. State is kept in a synchronous
 * in-memory mirror so the hot read path (a frame announcing itself) stays
 * sync; the mirror is rehydrated from storage when a fresh worker boots.
 */

const STORAGE_KEY = "tabCurtainOn";

/** Synchronous mirror of the persisted state. Only `true` entries are kept. */
const curtainTabs = new Map<number, boolean>();

let hydration: Promise<void> | null = null;

/**
 * Tabs whose curtain state THIS worker instance decided, via `setCurtain` or
 * `takeCurtainTabs`. A local decision always beats whatever hydration reads
 * back: the `storage.session.get` is in flight across the boot window, so a
 * user who toggles the curtain off during it would otherwise have the stale
 * persisted `true` resurrected by the late-landing read. Tracked separately
 * from the mirror because "turned off" is recorded as *absence* there.
 */
const locallyDecided = new Set<number>();

/**
 * Populate the in-memory mirror from session storage. Idempotent and cached —
 * every caller awaits the same promise, so a fresh worker hydrates once.
 */
export function hydrateCurtainState(): Promise<void> {
  hydration ??= Promise.resolve(chrome.storage?.session?.get(STORAGE_KEY))
    .then((stored) => {
      const raw = (stored as Record<string, unknown> | undefined)?.[
        STORAGE_KEY
      ];
      if (!raw || typeof raw !== "object") return;
      for (const [key, on] of Object.entries(raw as Record<string, unknown>)) {
        const tabId = Number(key);
        if (!Number.isInteger(tabId)) continue;
        if (on === true && !locallyDecided.has(tabId))
          curtainTabs.set(tabId, true);
      }
    })
    .catch(() => {
      // Session storage unavailable — degrade to memory-only (previous behaviour).
    });
  return hydration;
}

/** Write the mirror back to session storage. Fire-and-forget by design. */
function persist(): void {
  const snapshot: Record<string, true> = {};
  for (const [tabId, on] of curtainTabs) if (on) snapshot[String(tabId)] = true;
  void Promise.resolve(
    chrome.storage?.session?.set({ [STORAGE_KEY]: snapshot }),
  ).catch(() => {
    // Best-effort: a failed write only costs us the post-SW-death cleanup.
  });
}

/** Record whether the curtain is currently painted on `tabId`. */
export function setCurtain(tabId: number, on: boolean): void {
  if (on) curtainTabs.set(tabId, true);
  else curtainTabs.delete(tabId);
  locallyDecided.add(tabId);
  persist();
}

/** True if the curtain is known to be on for `tabId` (sync mirror read). */
export function isCurtainOn(tabId: number): boolean {
  return curtainTabs.get(tabId) === true;
}

/** Drop a closed tab's entry so the store doesn't grow across a session. */
export function forgetTab(tabId: number): void {
  if (curtainTabs.delete(tabId)) persist();
}

/**
 * The set of tabs whose curtain is on, clearing the store in the same step.
 * Used by the panel-disconnect teardown, which lifts every curtain it finds —
 * after which no tab is curtained, so keeping the entries would only re-apply
 * a stale curtain on the next navigation.
 *
 * Callers must `await hydrateCurtainState()` first, or a worker that booted
 * after a service-worker death will report an empty set.
 */
export function takeCurtainTabs(): Set<number> {
  const on = new Set<number>();
  for (const [tabId, isOn] of curtainTabs) if (isOn) on.add(tabId);
  curtainTabs.clear();
  // Every lifted tab is now a local decision, so a hydration still in flight
  // can't put the curtains we just lifted back.
  for (const tabId of on) locallyDecided.add(tabId);
  persist();
  return on;
}
