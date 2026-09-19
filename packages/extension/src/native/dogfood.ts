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
  | "detach-stale" // revoke cleanup over bookkeeping Chrome had already dropped
  | "reattach-ok" // recovered after an unsolicited detach
  | "reattach-failed" // could not recover
  | "reattach-abandoned" // a drop we never retried (native mode went off)
  | "conflict" // attach refused — another debugger already attached
  | "unavailable" // native can't run on this tab (see `reason`)
  | "read" // read the native tree (with node counts)
  | "act"; // dispatched an action (kind + success only)

export interface DogfoodEvent {
  kind: DogfoodEventKind;
  /** ms since epoch — injected by the caller (SW has Date.now). */
  at: number;
  /**
   * For detach: a static CDP reason ("target_closed", "canceled_by_user", …).
   * For `unavailable`: a `NativeUnavailableReason` code. Both are closed sets
   * of static strings — never Chrome's message text, which can quote the page.
   */
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
const COUNTERS_KEY = "dogfood.nativeCounters";
const CAP = 500; // rolling — a long session can't blow storage

interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/** Monotonic per-kind totals + accumulated attach time. Unlike the raw log,
 *  these are never trimmed, so a >CAP dogfood still reports true totals — the
 *  summary numbers are the whole point of the exercise. */
interface DogfoodCounters {
  attach: number;
  detach: number;
  detachUnsolicited: number;
  detachStale: number;
  reattachOk: number;
  reattachFailed: number;
  reattachAbandoned: number;
  conflict: number;
  unavailable: number;
  read: number;
  act: number;
  /** Total time attached across all detach events, ms. */
  attachedMs: number;
  /**
   * `unavailable` split by reason code — "how often was native unavailable, and
   * why" is a capability question the raw log can't answer once it rolls past
   * CAP, and it is the one the ship/no-ship decision needs: a fleet that is
   * mostly `devtools-conflict` argues for better conflict handling, one that is
   * mostly `browser-ui` argues that users simply live on pages native can never
   * reach. Keys are the closed reason set, so this stays content-free.
   */
  unavailableByReason: Record<string, number>;
}

const ZERO_COUNTERS: DogfoodCounters = {
  attach: 0,
  detach: 0,
  detachUnsolicited: 0,
  detachStale: 0,
  reattachOk: 0,
  reattachFailed: 0,
  reattachAbandoned: 0,
  conflict: 0,
  unavailable: 0,
  read: 0,
  act: 0,
  attachedMs: 0,
  unavailableByReason: {},
};

/** The counter fields that are plain tallies — i.e. everything a `+= 1` may
 *  target. Excludes `unavailableByReason`, which is a map and is updated
 *  separately; deriving this rather than writing it out keeps the two in step
 *  if another non-numeric counter is ever added. */
type TallyField = {
  [K in keyof DogfoodCounters]: DogfoodCounters[K] extends number ? K : never;
}[keyof DogfoodCounters];

// Map an event kind to its counter field (camelCased; the kebab kinds differ).
const COUNTER_FIELD: Record<DogfoodEventKind, TallyField> = {
  attach: "attach",
  detach: "detach",
  "detach-unsolicited": "detachUnsolicited",
  "detach-stale": "detachStale",
  "reattach-ok": "reattachOk",
  "reattach-failed": "reattachFailed",
  "reattach-abandoned": "reattachAbandoned",
  conflict: "conflict",
  unavailable: "unavailable",
  read: "read",
  act: "act",
};

/** The dogfood log over any storage area (chrome.storage.local in production,
 *  a fake in tests). Append-only with a rolling cap on the raw log, plus
 *  uncapped monotonic counters that back the summary; export flattens to text. */
export class DogfoodLog {
  constructor(private storage: StorageArea) {}

  /**
   * Serializes the read-modify-write in record()/clear(). Both read a base
   * snapshot then write it back, and they run concurrently: the onDetach
   * listener records `detach-unsolicited` independently of the attach→read→
   * detach records an operation drives. Without serialization two callers read
   * the same snapshot and the later set() clobbers the earlier — dropping
   * exactly the MV3-lifecycle events this dogfood measures. Chaining every
   * mutation through one tail promise makes each atomic w.r.t. the others.
   */
  private tail: Promise<unknown> = Promise.resolve();

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task, task);
    // Keep the chain alive after a rejection, and don't leak an unhandled one.
    this.tail = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  async record(event: DogfoodEvent): Promise<void> {
    await this.enqueue(async () => {
      const events = await this.all();
      events.push(event);
      // Keep the most recent CAP raw events; the summary rides on the counters.
      const trimmed = events.slice(-CAP);

      const counters = await this.counters();
      counters[COUNTER_FIELD[event.kind]] += 1;
      if (
        (event.kind === "detach" || event.kind === "detach-unsolicited") &&
        event.attachedMs !== undefined
      ) {
        counters.attachedMs += event.attachedMs;
      }
      if (event.kind === "unavailable" && event.reason) {
        counters.unavailableByReason[event.reason] =
          (counters.unavailableByReason[event.reason] ?? 0) + 1;
      }

      await this.storage.set({ [KEY]: trimmed, [COUNTERS_KEY]: counters });
    });
  }

  async all(): Promise<DogfoodEvent[]> {
    const got = await this.storage.get(KEY);
    const raw = got[KEY];
    return Array.isArray(raw) ? (raw as DogfoodEvent[]) : [];
  }

  async counters(): Promise<DogfoodCounters> {
    const got = await this.storage.get(COUNTERS_KEY);
    const raw = got[COUNTERS_KEY];
    const stored = raw as Partial<DogfoodCounters> | undefined;
    return {
      ...ZERO_COUNTERS,
      ...stored,
      // Spreading a stored snapshot written before this field existed leaves it
      // `undefined`, not the ZERO default — a plain spread only fills in keys
      // the later object omits entirely. Rebuild it explicitly, and copy rather
      // than alias so a mutation can't write through into the stored object.
      unavailableByReason: { ...(stored?.unavailableByReason ?? {}) },
    };
  }

  async clear(): Promise<void> {
    await this.enqueue(async () => {
      await this.storage.set({
        [KEY]: [],
        [COUNTERS_KEY]: { ...ZERO_COUNTERS },
      });
    });
  }

  /** A shareable summary + raw log — the artifact a dogfooder reports back. */
  async report(now: number): Promise<string> {
    const events = await this.all();
    const c = await this.counters();

    const lines = [
      "Real A11y — extension native (chrome.debugger) dogfood report",
      `generated: ${new Date(now).toISOString()}`,
      // Folded over COUNTER_FIELD rather than hand-summed. That map is
      // `Record<DogfoodEventKind, …>`, so the compiler forces a new kind to be
      // registered there — a hand-written sum is the one place it would not,
      // and it would under-report in silence.
      `events: ${Object.values(COUNTER_FIELD).reduce((n, field) => n + c[field], 0)}` +
        ` (raw log shows most recent ${Math.min(events.length, CAP)})`,
      "",
      "— Banner tolerance —",
      `  attach sessions: ${c.attach}`,
      `  total time attached: ${(c.attachedMs / 1000).toFixed(1)}s`,
      "",
      "— MV3 service-worker lifecycle —",
      `  unsolicited detaches (SW suspended / target gone): ${c.detachUnsolicited}`,
      `  reattach recovered: ${c.reattachOk}   failed: ${c.reattachFailed}`,
      "",
      `  recovery abandoned (native mode switched off mid-drop): ${c.reattachAbandoned}`,
      "",
      "— DevTools conflict —",
      `  attach refused (another debugger attached): ${c.conflict}`,
      "",
      "— Capability —",
      `  native unavailable: ${c.unavailable}`,
      ...Object.entries(c.unavailableByReason)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([reason, n]) => `    ${reason}: ${n}`),
      "",
      "— Usage —",
      `  tree reads: ${c.read}   actions dispatched: ${c.act}`,
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
