/// <reference types="chrome" />

/**
 * `chrome.debugger` plumbing for native mode — the ENTIRE surface the extension
 * adds over the shared native-core. Wraps `chrome.debugger.sendCommand` as a
 * {@link CdpTransport}, scopes attach→detach around each operation (so the
 * "…is debugging this browser" banner shows only while working), and records
 * the dogfood signals: attach dwell time, unsolicited detaches (MV3 SW suspend),
 * reattach recovery, and DevTools-conflict refusals.
 *
 * Errors are surfaced as static strings — a raw `chrome.runtime.lastError`
 * message can quote page/DevTools state (R6 invariant).
 */

import { DogfoodLog } from "./dogfood.js";
import type { CdpTransport } from "./native-core.js";

const PROTOCOL = "1.3";

/** "Another debugger is already attached…" — the DevTools-conflict class. */
export function isDebuggerConflict(message: string | undefined): boolean {
  return /already attached/i.test(message ?? "");
}

/** chrome.debugger.sendCommand for one tab, as a transport. */
function transportFor(tabId: number): CdpTransport {
  return {
    send: <T>(method: string, params?: object) =>
      chrome.debugger.sendCommand(
        { tabId },
        method,
        params as Record<string, unknown> | undefined,
      ) as unknown as Promise<T>,
  };
}

/**
 * Messages Chrome produces when the debuggee itself went away mid-command — a
 * genuine connection drop (MV3 suspend, forced detach, tab closed), as opposed
 * to a CDP command that merely failed.
 *
 * The classification is deliberately **conservative**: anything unrecognized
 * counts as a command failure, not a drop. `reattach-*` is the dogfood's
 * headline lifecycle metric, so over-tagging would inflate the number the
 * ship/no-ship decision rests on — better to undercount than to invent drops.
 * The message is only inspected here and never surfaced (R6).
 */
export function isConnectionLost(message: string | undefined): boolean {
  return /detached|not attached|target closed|no target with given id|tab was closed/i.test(
    message ?? "",
  );
}

export interface AttachOutcome {
  ok: boolean;
  /**
   * Static reason when !ok. `connection-lost` means we were attached and lost
   * it (a lifecycle event worth measuring); `command-failed` means the CDP
   * call failed while the connection held (not a lifecycle event).
   */
  error?:
    | "conflict"
    | "attach-failed"
    | "connection-lost"
    | "command-failed"
    /** Native mode was switched off before this attach could happen. */
    | "disabled";
}

interface StorageArea {
  get(k: string): Promise<Record<string, unknown>>;
  set(i: Record<string, unknown>): Promise<void>;
}

/** Attach bookkeeping, keyed by tab id → attach timestamp. */
const ATTACHED_KEY = "dogfood.attachedTabs";

/**
 * Owns the debugger connection for native mode and the dogfood log. One
 * instance per service-worker wake; MV3 may suspend the worker between uses,
 * so it never assumes a durable attach — `withDebugger` attaches fresh and
 * detaches in `finally`, and `onDetach` records unsolicited drops.
 *
 * Attach bookkeeping lives in **storage, not memory**, precisely because the
 * suspend it measures destroys memory: the worker is torn down, `onDetach`
 * wakes a brand-new instance, and an in-memory map would be empty — so the
 * unsolicited detach (the main risk this dogfood exists to quantify) would go
 * unrecorded and the metric would read zero however much churn there was.
 */
export class NativeDebuggerSession {
  private log: DogfoodLog;
  private attachStore: StorageArea;
  /** Serializes the attach-map read-modify-write (same reason as DogfoodLog). */
  private tail: Promise<unknown> = Promise.resolve();
  /** One in-flight operation chain per tab — see `runExclusive`. */
  private opTails = new Map<number, Promise<void>>();

  /**
   * Is native mode still on? Consulted INSIDE the attach's storage transaction,
   * which is what makes "switch it off" and "attach" mutually exclusive rather
   * than merely usually-ordered — see {@link attach}.
   */
  private isEnabled: () => Promise<boolean>;

  /**
   * @param storage        durable area for the dogfood log (chrome.storage.local).
   * @param attachStorage  area for attach bookkeeping; defaults to `storage`.
   *                       Production passes `chrome.storage.session` — it
   *                       survives worker restarts but not a browser restart,
   *                       which is exactly the lifetime of a debugger attach.
   * @param isEnabled      the runtime native-mode flag, re-read per attach.
   */
  constructor(
    storage: StorageArea,
    attachStorage: StorageArea = storage,
    isEnabled: () => Promise<boolean> = async () => true,
  ) {
    this.log = new DogfoodLog(storage);
    this.attachStore = attachStorage;
    this.isEnabled = isEnabled;
    // MV3: the debugger detaches when the SW suspends, when DevTools opens on
    // the tab, or when the tab closes. Record it as the lifecycle signal.
    chrome.debugger.onDetach.addListener((source, reason) => {
      const tabId = source.tabId;
      if (typeof tabId !== "number") return;
      void this.enqueue(async () => {
        const attached = await this.readAttached();
        const startedAt = attached[tabId];
        if (startedAt === undefined) return; // not a tab we attached to
        delete attached[tabId];
        await this.writeAttached(attached);
        await this.log.record({
          kind: "detach-unsolicited",
          at: Date.now(),
          reason: String(reason),
          attachedMs: Date.now() - startedAt,
        });
      });
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task, task);
    this.tail = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  private async readAttached(): Promise<Record<number, number>> {
    const got = await this.attachStore.get(ATTACHED_KEY);
    const raw = got[ATTACHED_KEY];
    return raw && typeof raw === "object"
      ? ({ ...raw } as Record<number, number>)
      : {};
  }

  private async writeAttached(map: Record<number, number>): Promise<void> {
    await this.attachStore.set({ [ATTACHED_KEY]: map });
  }

  dogfoodLog(): DogfoodLog {
    return this.log;
  }

  /**
   * Attach → run → always detach, recording banner dwell + conflicts.
   *
   * A failure inside `fn` is classified rather than rethrown: only a genuine
   * connection drop yields `connection-lost` (which `withRecovery` counts as a
   * lifecycle recovery). A CDP command that merely failed — `readNativeTree`
   * does not swallow protocol errors the way `dispatchNative` does — yields
   * `command-failed` and never touches the reattach metric.
   */
  async withDebugger<T>(
    tabId: number,
    fn: (t: CdpTransport) => Promise<T>,
  ): Promise<{ outcome: AttachOutcome; value?: T }> {
    // One operation per tab at a time. Chrome allows a single debugger client
    // per target, so two overlapping operations collide with each other: the
    // second attach is refused with "Another debugger is already attached" —
    // indistinguishable from DevTools holding the tab, so it would be scored as
    // a `conflict` and inflate one of the three headline metrics with a
    // self-inflicted collision. The first operation's teardown would also
    // detach out from under the second. Queueing removes both.
    return this.runExclusive(tabId, () => this.attachAndRun(tabId, fn));
  }

  /** Serialize per tab; operations on different tabs still run concurrently. */
  private runExclusive<T>(tabId: number, task: () => Promise<T>): Promise<T> {
    const previous = this.opTails.get(tabId) ?? Promise.resolve();
    const run = previous.then(task, task);
    const settled = run.then(
      () => {},
      () => {},
    );
    this.opTails.set(tabId, settled);
    // Drop the entry once this is the last queued operation, so a long-lived
    // worker doesn't accumulate one promise per tab it ever touched.
    void settled.then(() => {
      if (this.opTails.get(tabId) === settled) this.opTails.delete(tabId);
    });
    return run;
  }

  private async attachAndRun<T>(
    tabId: number,
    fn: (t: CdpTransport) => Promise<T>,
  ): Promise<{ outcome: AttachOutcome; value?: T }> {
    const attach = await this.attach(tabId);
    if (!attach.ok) return { outcome: attach };
    const startedAt = Date.now();
    // `finally` runs on paths where neither assignment has happened yet, so it
    // reads this optionally; only an explicit `connection-lost` marks the
    // teardown as a drop, which is the conservative default.
    let outcome: AttachOutcome | undefined;
    let value: T | undefined;
    try {
      value = await fn(transportFor(tabId));
      outcome = { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      outcome = {
        ok: false,
        error: isConnectionLost(msg) ? "connection-lost" : "command-failed",
      };
    } finally {
      // A book-keeping failure here must not discard an already-successful
      // result, nor turn it into a spurious retry of a page action.
      await this.detach(
        tabId,
        Date.now() - startedAt,
        outcome?.error === "connection-lost",
      ).catch(() => {});
    }
    return outcome.ok ? { outcome, value } : { outcome };
  }

  /**
   * Attach, and record it, as ONE transaction on the storage queue.
   *
   * The enabled-check lives in here rather than in the caller because the
   * caller cannot make it atomic. `detachAll` reads the attach map on this same
   * queue, so an attach that is merely *checked* upstream can still be in
   * flight when the revoke takes its snapshot: it is in neither the map nor
   * refused, and its banner goes up after the panel has said native is off.
   * Sharing the queue removes the window rather than narrowing it — an attach
   * either lands in the map before the revoke reads it, or finds the flag
   * already false.
   */
  private async attach(tabId: number): Promise<AttachOutcome> {
    return this.enqueue(async () => {
      if (!(await this.isEnabled())) return { ok: false, error: "disabled" };
      try {
        await chrome.debugger.attach({ tabId }, PROTOCOL);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isDebuggerConflict(msg)) {
          await this.log.record({ kind: "conflict", at: Date.now() });
          return { ok: false, error: "conflict" };
        }
        return { ok: false, error: "attach-failed" };
      }
      const attached = await this.readAttached();
      attached[tabId] = Date.now();
      await this.writeAttached(attached);
      await this.log.record({ kind: "attach", at: Date.now() });
      return { ok: true };
    });
  }

  /**
   * Detach from every tab this session still holds — the revoke path.
   *
   * Turning native mode off has to actually drop the capability, not just stop
   * offering it: `debugger` cannot be an optional permission (spike-confirmed),
   * so there is no `chrome.permissions.remove` to call and "revoked" can only
   * mean "not attached". Normally nothing is attached — `withDebugger` detaches
   * in `finally` — but an MV3 suspend mid-operation can leave a live attachment
   * whose `finally` never ran, and that keeps the banner up on a tab the user
   * believes they just turned native off for.
   *
   * Reads the attach map from storage rather than memory for the same reason
   * the map lives there at all: the suspend that strands an attachment is
   * exactly the event that destroys the memory recording it.
   *
   * @returns how many tabs were detached.
   */
  async detachAll(): Promise<number> {
    const attached = await this.enqueue(() => this.readAttached());
    let detached = 0;
    for (const [id, startedAt] of Object.entries(attached)) {
      const tabId = Number(id);
      // Through the per-tab queue, NOT around it. Tearing down an operation
      // that is mid-flight makes its CDP call throw, which `withDebugger`
      // classifies as `connection-lost` and `withRecovery` then RETRIES — so
      // switching native off during a read would re-attach immediately after,
      // put the banner back, and book a `reattach-ok` that never happened.
      // Queueing waits for the operation instead; its own `finally` detaches,
      // and this then finds nothing left to do.
      if (
        await this.runExclusive(tabId, () =>
          this.detachIfLive(tabId, Date.now() - startedAt),
        )
      ) {
        detached++;
      }
    }
    return detached;
  }

  /**
   * Detach one tab for the revoke path, reporting whether it was really live.
   *
   * The difference from {@link detach} is that this one does NOT trust the
   * bookkeeping. An entry can outlive its attachment — a drop Chrome never
   * reported, or an `onDetach` that lost the race with a worker teardown — and
   * such an entry is arbitrarily old. Logging it as an ordinary detach would
   * add hours to "total time attached", which is the banner-tolerance number
   * the ship/no-ship decision reads, and would report "detached from 1 tab(s)"
   * to a user whose banner was never up.
   *
   * So the CDP call decides: it resolving is the only evidence the attachment
   * was live. If it rejects, the entry is recorded as an unsolicited detach of
   * unknown duration — true, and with no `attachedMs` to inflate the dwell
   * total — rather than as a clean detach or as nothing at all.
   */
  private async detachIfLive(
    tabId: number,
    attachedMs: number,
  ): Promise<boolean> {
    const claimed = await this.enqueue(async () => {
      const attached = await this.readAttached();
      if (attached[tabId] === undefined) return false;
      delete attached[tabId];
      await this.writeAttached(attached);
      return true;
    });
    if (!claimed) return false;

    // Resolving proves the attachment was live. A rejection proves only that
    // THIS call failed — so classify it rather than assuming the bookkeeping
    // was stale: `isConnectionLost` is the same conservative test used for a
    // mid-operation drop, and anything outside that family means the tab is
    // plausibly still attached, which is worth reporting rather than silently
    // orphaning.
    const failure = await chrome.debugger
      .detach({ tabId })
      .then(() => undefined)
      .catch((err: unknown) =>
        err instanceof Error ? err.message : String(err),
      );
    if (failure === undefined) {
      await this.log.record({ kind: "detach", at: Date.now(), attachedMs });
      return true;
    }
    // `detach-stale`, NOT `detach-unsolicited`: revoke-time cleanup over an
    // entry Chrome had already dropped is neither a suspend nor a target-gone
    // drop, and folding it into the MV3 headline counter would inflate the one
    // number DOGFOOD.md calls the main engineering risk. No `attachedMs`
    // either — the entry's age is not time a banner was up.
    await this.log.record({
      kind: "detach-stale",
      at: Date.now(),
      reason: isConnectionLost(failure) ? "already-gone" : "detach-refused",
    });
    return false;
  }

  /**
   * @param connectionLost the operation failed because the debuggee went away,
   *   so this teardown is cleaning up after a drop rather than ending a healthy
   *   session. It must still be recorded as **unsolicited**: claiming the entry
   *   here is what stops `onDetach` from recording it, so logging a deliberate
   *   `detach` instead would erase the drop entirely — a report reading
   *   "unsolicited detaches: 0" beside "reattach recovered: N" is exactly the
   *   contradiction that hides the MV3 signal this dogfood measures.
   */
  private async detach(
    tabId: number,
    attachedMs: number,
    connectionLost = false,
  ): Promise<void> {
    // Claim the entry atomically: if onDetach already took it, that drop was
    // unsolicited and is its to record — this teardown must not double-count.
    const wasAttached = await this.enqueue(async () => {
      const attached = await this.readAttached();
      if (attached[tabId] === undefined) return false;
      delete attached[tabId];
      await this.writeAttached(attached);
      return true;
    });
    if (!wasAttached) return;
    await this.log.record(
      connectionLost
        ? {
            kind: "detach-unsolicited",
            at: Date.now(),
            reason: "connection-lost",
            attachedMs,
          }
        : { kind: "detach", at: Date.now(), attachedMs },
    );
    // The tab may be gone; a failed detach is not actionable.
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }
}
