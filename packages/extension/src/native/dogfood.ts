/**
 * Dogfood instrumentation for the `chrome.debugger` native mode (RFC PR H).
 *
 * PR H "produces a decision, not a feature": whether extension-native is worth
 * shipping hinges on three questions the Spike-5 test could not answer, all of
 * which need a real, headed, human session. This module records exactly those
 * signals to `chrome.storage.local` so a dogfooder can export a report:
 *
 *   1. Banner tolerance    — every attach/detach + how long we stayed attached
 *                            (the "…is debugging this browser" bar shows while
 *                            attached; frequency + dwell time proxy the annoyance).
 *   2. MV3 SW lifecycle    — service-worker suspends drop the debugger; we log
 *                            each unsolicited detach + whether reattach recovered
 *                            (the main engineering risk).
 *   3. DevTools conflict   — "Another debugger is already attached" on attach
 *                            (how often real users, who live in DevTools, collide).
 *
 * The log is capped and content-free — it records event kinds, reasons, and
 * timings, never page content (R1 invariant holds even in telemetry).
 */

export type DogfoodEventKind =
  | "attach" // we attached the debugger to a tab (banner appears)
  | "detach" // we detached deliberately (banner clears)
  | "detach-unsolicited" // chrome.debugger.onDetach fired without our asking
  | "reattach-ok" // recovered after an unsolicited detach
  | "reattach-failed" // could not recover
  | "conflict" // attach refused — another debugger already attached
  | "read" // read the native tree (with node counts)
  | "act"; // dispatched an action (kind + success only)

export interface DogfoodEvent {
  kind: DogfoodEventKind;
  /** ms since epoch — injected by the caller (SW has Date.now). */
  at: number;
  /** For detach: a static CDP reason ("target_closed", "canceled_by_user", …). */
  reason?: string;
  /** For read: raw AX node count / kept node count. */
  rawCount?: number;
  keptCount?: number;
  /** For act: the action kind and outcome — never the typed value. */
  action?: string;
  success?: boolean;
  /** For attach/detach pairs: how long we stayed attached, ms. */
  attachedMs?: number;
}

const KEY = "dogfood.nativeLog";
const CAP = 500; // rolling — a long session can't blow storage

interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/** The dogfood log over any storage area (chrome.storage.local in production,
 *  a fake in tests). Append-only with a rolling cap; export flattens to text. */
export class DogfoodLog {
  constructor(private storage: StorageArea) {}

  async record(event: DogfoodEvent): Promise<void> {
    const events = await this.all();
    events.push(event);
    // Keep the most recent CAP events.
    const trimmed = events.slice(-CAP);
    await this.storage.set({ [KEY]: trimmed });
  }

  async all(): Promise<DogfoodEvent[]> {
    const got = await this.storage.get(KEY);
    const raw = got[KEY];
    return Array.isArray(raw) ? (raw as DogfoodEvent[]) : [];
  }

  async clear(): Promise<void> {
    await this.storage.set({ [KEY]: [] });
  }

  /** A shareable summary + raw log — the artifact a dogfooder reports back. */
  async report(now: number): Promise<string> {
    const events = await this.all();
    const count = (k: DogfoodEventKind) =>
      events.filter((e) => e.kind === k).length;
    const attachedMs = events
      .filter((e) => e.kind === "detach" || e.kind === "detach-unsolicited")
      .reduce((sum, e) => sum + (e.attachedMs ?? 0), 0);

    const lines = [
      "Real A11y — extension native (chrome.debugger) dogfood report",
      `generated: ${new Date(now).toISOString()}`,
      `events: ${events.length}`,
      "",
      "— Banner tolerance —",
      `  attach sessions: ${count("attach")}`,
      `  total time attached: ${(attachedMs / 1000).toFixed(1)}s`,
      "",
      "— MV3 service-worker lifecycle —",
      `  unsolicited detaches (SW suspended / target gone): ${count("detach-unsolicited")}`,
      `  reattach recovered: ${count("reattach-ok")}   failed: ${count("reattach-failed")}`,
      "",
      "— DevTools conflict —",
      `  attach refused (another debugger attached): ${count("conflict")}`,
      "",
      "— Usage —",
      `  tree reads: ${count("read")}   actions dispatched: ${count("act")}`,
      "",
      "— Raw log (most recent last) —",
      ...events.map(
        (e) =>
          `  ${new Date(e.at).toISOString()}  ${e.kind}` +
          [
            e.reason ? `reason=${e.reason}` : "",
            e.attachedMs !== undefined
              ? `attached=${(e.attachedMs / 1000).toFixed(1)}s`
              : "",
            e.rawCount !== undefined ? `raw=${e.rawCount}` : "",
            e.keptCount !== undefined ? `kept=${e.keptCount}` : "",
            e.action ? `action=${e.action}` : "",
            e.success !== undefined ? `success=${e.success}` : "",
          ]
            .filter(Boolean)
            .map((s) => `  ${s}`)
            .join(""),
      ),
    ];
    return lines.join("\n");
  }
}
