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

/**
 * Bound on the liveness probe `attach()` sends before trusting a reused
 * session (see there). It runs inside the promise `detachAll` waits on, so an
 * unbounded probe against a wedged tab — blocked on a synchronous `alert()`,
 * say — would let turning native mode off hang right along with it. A timeout
 * is treated as "can't tell" (falls through to the conservative branch),
 * never as proof the connection is gone.
 */
const PROBE_TIMEOUT_MS = 2000;

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
  // `no (target|tab) with given id` — Chrome phrases this per target type, and
  // the `{ tabId }` form this module always uses yields the TAB wording ("No tab
  // with given id 7."). Matching only the `target` spelling meant a closed tab
  // fell through to the "plausibly still attached" branch in `detachIfLive`,
  // which puts the entry back: the map then never cleared and every later revoke
  // re-reported the same dead tab as `detach-refused`.
  return /detached|not attached|target closed|no (?:target|tab) with given id|tab was closed/i.test(
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
   * One in-flight `attach()` call per tab, tracked so `detachAll` can wait for
   * it. The `chrome.debugger.attach` call inside `attach()` runs OUTSIDE the
   * storage mutex on purpose (holding it across that round-trip let a slow
   * attach on one tab block another tab's teardown) — but that means a revoke
   * reading the map for its snapshot has no other way to observe an attach
   * that hasn't landed yet. See `attach` and `detachAll`.
   */
  private pendingAttaches = new Map<number, Promise<void>>();

  /**
   * Is native mode still on? Consulted INSIDE the attach's storage transaction,
   * which is what makes "switch it off" and "attach" mutually exclusive rather
   * than merely usually-ordered — see {@link attach}.
   */
  private isEnabled: () => Promise<boolean>;

  /**
   * Cancel callback for an in-flight {@link runPick}, keyed by tab id. Lets
   * {@link cancelPick}/{@link cancelAllPicks} resolve a pick session that is
   * currently just an in-memory `Promise` awaiting either a click or a stop
   * — there is nothing in `chrome.storage` to read it back from, unlike
   * every other piece of state this class tracks, because a pick session
   * that outlives an MV3 suspend has nothing left to cancel anyway (see
   * {@link runPick}'s own comment).
   */
  private pickCancel = new Map<number, () => void>();

  /**
   * Reject callback for an in-flight {@link runPick}, keyed by tab id —
   * distinct from {@link pickCancel}, which *resolves* the pick as a plain
   * cancel. `chrome.debugger.onDetach` uses this one instead: a detach mid-
   * pick (DevTools opening on the tab, the SW's own connection dropping) is
   * a genuine connection loss, not the user cancelling, and `attachAndRun`
   * only classifies it that way (`connection-lost`, feeding the reattach
   * metric like every other native op's drop) when `fn` REJECTS rather than
   * resolves — see the constructor's `onDetach` listener.
   */
  private pickReject = new Map<number, () => void>();

  /**
   * Tabs with a pick STOP that arrived before {@link runPick} had registered
   * {@link pickCancel} for them — the attach a START triggers can take real
   * time (a slow round trip, a queued operation ahead of it), and a STOP
   * that lands during that window previously found nothing to cancel,
   * `cancelPick` reported `false`, and the START went on to arm
   * `Overlay.setInspectMode` moments later — behind a toolbar button the
   * panel had already shown as "off", with no way for the user to reach it
   * again short of the per-tab operation queue's next unrelated op. `runPick`
   * consumes (and clears) its own tab's entry the instant it starts, so a
   * pending cancel resolves the pick immediately without ever arming the
   * overlay. Consumed unconditionally on every `runPick` call, so a stray
   * STOP with nothing outstanding at all costs at most one future pick
   * silently resolving as cancelled — never a hang.
   */
  private pendingPickCancel = new Set<number>();

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
      // An armed pick occupies the SAME per-tab operation queue as reads and
      // actions (see `withDebugger`'s own comment) — so if this detach isn't
      // settled, the queue can't advance until the user happens to click
      // something or explicitly stops picking, exactly the way a genuinely
      // failed read or act never gets to (those always resolve `fn`, one way
      // or the other). Reject rather than resolve: `attachAndRun`'s own catch
      // classifies a rejection via `isConnectionLost`, so this reads as the
      // same kind of drop a mid-read/mid-act disconnect already does, not as
      // the user pressing Escape.
      this.pickReject.get(tabId)?.();
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
      // result, nor turn it into a spurious retry of a page action. `detach`
      // derives the dwell duration from the map's own timestamp rather than a
      // duration measured here, which is what makes a reused session's total
      // banner time correct rather than just this operation's slice of it.
      await this.detach(tabId, outcome?.error === "connection-lost").catch(
        () => {},
      );
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
    const result = this.attachTracked(tabId);
    // Registered for the FULL call, including the post-CDP-call transaction
    // below — not just the `chrome.debugger.attach` round-trip — since a
    // revoke racing the transaction is the same hazard as one racing the CDP
    // call itself. Settles even on rejection so a failed attach doesn't wedge
    // `detachAll` forever waiting on it.
    const settled = result.then(
      () => {},
      () => {},
    );
    this.pendingAttaches.set(tabId, settled);
    void settled.then(() => {
      if (this.pendingAttaches.get(tabId) === settled) {
        this.pendingAttaches.delete(tabId);
      }
    });
    return result;
  }

  private async attachTracked(tabId: number): Promise<AttachOutcome> {
    // Cheap pre-check, outside the mutex — the authoritative one is below.
    if (!(await this.isEnabled())) return { ok: false, error: "disabled" };
    // True when Chrome refused because WE already hold the tab, so the existing
    // attachment is reused rather than replaced.
    let reused = false;
    try {
      await chrome.debugger.attach({ tabId }, PROTOCOL);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isDebuggerConflict(msg)) {
        // "Another debugger is already attached" does not say WHO. `runExclusive`
        // only serializes within one worker generation, so after an MV3 suspend
        // the in-memory queue is empty while our own attachment — and its entry
        // in `chrome.storage.session` — can still be live. Scoring that as a
        // DevTools conflict inflates one of the three headline metrics with a
        // self-collision, which is the same class of bug the per-tab queue was
        // added to fix, one generation up.
        const hasEntry = await this.enqueue(
          async () => (await this.readAttached())[tabId] !== undefined,
        );
        // The entry alone is NOT proof: it means we attached at some point, not
        // that we still hold the tab now. An unreported drop — the SW suspended
        // mid-attachment and missed the `onDetach` event — can leave a stale
        // entry while Chrome's real attachment now belongs to someone else, e.g.
        // DevTools opening on the tab in the interim. Reusing on bookkeeping
        // alone would dispatch `fn()` against a session we don't actually hold;
        // its command would fail as `connection-lost`, and `withRecovery` would
        // retry it as a genuine mid-operation drop rather than the stale-entry
        // cleanup it actually is. A live probe is the only way to tell the two
        // apart — cheap and side-effect-free, since we hit `Runtime.evaluate`
        // every real read anyway.
        //
        // Bounded: this call sits inside the promise `detachAll` waits on (see
        // `attach`'s wrapper), so an unbounded probe against a tab whose
        // renderer is wedged — blocked on a synchronous `alert()`, say — would
        // let turning native mode off hang right along with it.
        const probe = await Promise.race([
          chrome.debugger
            .sendCommand({ tabId }, "Runtime.evaluate", { expression: "1" })
            .then(() => ({ ok: true as const })),
          new Promise<{ ok: false; msg: undefined }>((resolve) =>
            setTimeout(
              () => resolve({ ok: false, msg: undefined }),
              PROBE_TIMEOUT_MS,
            ),
          ),
        ]).catch((err: unknown) => ({
          ok: false as const,
          msg: err instanceof Error ? err.message : String(err),
        }));
        // Only a message that specifically says we are not attached proves the
        // entry lied. Anything else — a timeout, a mid-navigation hiccup with no
        // execution context yet, an unrelated protocol error — is the PROBE
        // failing for its own reason, not proof the connection is gone. Treating
        // it as proof would turn one bad `Runtime.evaluate` into a permanent
        // lockout: the entry gets cleared, the next attach hits the same
        // "already attached" with nothing left to reuse, and every attempt after
        // reports a conflict that was never real. Matches this file's existing
        // rule elsewhere: anything unrecognized falls through conservatively
        // rather than inventing a drop.
        const alive = hasEntry && (probe.ok || !isConnectionLost(probe.msg));
        if (!alive) {
          if (hasEntry) {
            // The entry lied. Clear it as stale bookkeeping — the connection
            // was never really ours to lose here — rather than let it survive
            // to confuse the next attach attempt too.
            await this.enqueue(async () => {
              const attached = await this.readAttached();
              delete attached[tabId];
              await this.writeAttached(attached);
            });
            await this.log.record({
              kind: "detach-stale",
              at: Date.now(),
              reason: "stale-conflict",
            });
          }
          await this.log.record({ kind: "conflict", at: Date.now() });
          return { ok: false, error: "conflict" };
        }
        // It is our attachment and it is live, so the operation can just use it.
        reused = true;
      } else {
        return { ok: false, error: "attach-failed" };
      }
    }
    // Re-check and record as ONE transaction on the storage queue, which is the
    // queue `detachAll` snapshots on — so an attach either lands in the map
    // before the revoke reads it, or finds the flag already false and undoes
    // itself. The CDP call above stays OUTSIDE: this mutex is shared with
    // `detach`, `detachIfLive` and the `onDetach` recorder, and holding it
    // across a round-trip let a slow attach on one tab block another tab's
    // teardown and stall the revoke that was trying to stop it.
    const kept = await this.enqueue(async () => {
      if (!(await this.isEnabled())) return false;
      const attached = await this.readAttached();
      // On reuse keep the ORIGINAL timestamp: the banner has been up since that
      // moment, and restarting the clock would under-report the dwell total the
      // ship/no-ship call reads. A fresh attach has no entry to keep.
      if (!(reused && attached[tabId] !== undefined))
        attached[tabId] = Date.now();
      await this.writeAttached(attached);
      return true;
    });
    if (!kept) {
      await chrome.debugger.detach({ tabId }).catch(() => {});
      return { ok: false, error: "disabled" };
    }
    // A reused attachment is not a new attach session — the banner never came
    // down — so recording one would inflate both the session count and, through
    // it, the average dwell.
    if (!reused) await this.log.record({ kind: "attach", at: Date.now() });
    return { ok: true };
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
    // Wait out anything already mid-attach before taking the snapshot below.
    // Each attach re-checks the enabled flag before landing in the map (see
    // `attach`), so by the time this proceeds, every attach that was in
    // flight WHEN THE REVOKE WAS CALLED has already either landed (and will
    // be picked up in the read below) or found the flag false and undone
    // itself — so the count this returns, and the report the panel builds
    // from it, are never stale by the time either goes out. Snapshotting the
    // map BEFORE this wait would miss the point: it's exactly the entries an
    // in-flight attach hasn't written yet that this closes the gap on.
    await Promise.all([...this.pendingAttaches.values()]);
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
    if (!isConnectionLost(failure)) {
      // The attachment is plausibly still live, so putting the entry back is
      // what keeps a later revoke — or `onDetach` — able to see it. Deleting it
      // and reporting nothing is the silent orphan this method exists to avoid.
      await this.enqueue(async () => {
        const attached = await this.readAttached();
        if (attached[tabId] === undefined) {
          attached[tabId] = Date.now() - attachedMs;
          await this.writeAttached(attached);
        }
      });
      await this.log.record({
        kind: "detach-stale",
        at: Date.now(),
        reason: "detach-refused",
      });
      return false;
    }
    await this.log.record({
      kind: "detach-stale",
      at: Date.now(),
      reason: "already-gone",
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
  private async detach(tabId: number, connectionLost = false): Promise<void> {
    // Claim the entry atomically: if onDetach already took it, that drop was
    // unsolicited and is its to record — this teardown must not double-count.
    // The stored timestamp is also the SOURCE OF TRUTH for dwell, not a
    // duration the caller computed: a reused session (attach() found its own
    // surviving attachment and kept the map's ORIGINAL timestamp rather than
    // resetting it) has been up since well before this operation started, and
    // a caller-local `Date.now() - startedAt` would report only this one
    // operation's slice of that — undercounting the banner-tolerance number by
    // however long the attachment survived the worker restart that preceded it.
    const startedAt = await this.enqueue(async () => {
      const attached = await this.readAttached();
      const v = attached[tabId];
      if (v === undefined) return undefined;
      delete attached[tabId];
      await this.writeAttached(attached);
      return v;
    });
    if (startedAt === undefined) return;
    const attachedMs = Date.now() - startedAt;
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

  /**
   * Arm CDP's own element picker — `Overlay.setInspectMode`, the exact
   * primitive DevTools' own "inspect element" tool uses — and resolve once
   * the user clicks something (`Overlay.inspectNodeRequested`) or
   * {@link cancelPick}/{@link cancelAllPicks} is called.
   *
   * Pass this as the `fn` to `withDebugger` (via `native/index.ts`'s
   * `withRecovery`, exactly like `readNativeTree`/`dispatchNative`): the
   * whole pick session — however long the user takes to click — then runs
   * inside ONE attach→detach span, so every existing per-tab queue,
   * dogfood-log and revoke-safety guarantee `withDebugger` already provides
   * applies unchanged. This is deliberately the one native operation that
   * does NOT keep attach dwell minimal — see the picker-mode ticket's own
   * risk note; a caller measuring dwell time should treat this session
   * separately from the rest.
   *
   * MV3 caveat, not solved here: if the service worker suspends while a
   * pick is still armed (a realistic outcome if the user takes longer than
   * the SW's idle timeout to click), the in-memory `Promise` this creates —
   * and the `pickCancel`/`pickReject` entries pointing at it — are destroyed
   * along with the rest of the worker's heap. `chrome.debugger.onDetach`
   * still fires on the fresh worker instance and records the drop (see the
   * constructor), so the attachment itself never leaks or strands the
   * banner — only this specific pick's eventual `NATIVE_PICK_RESULT` push
   * never arrives. The panel's own pick-mode toggle is the recovery: it
   * clears its local "on" state optimistically on stop, never waiting for
   * a push that this scenario means will never come.
   */
  runPick(
    tabId: number,
    t: CdpTransport,
  ): Promise<{ backendNodeId: number; chainBackendNodeIds: number[] } | null> {
    // A STOP that arrived while the attach this pick needed was still in
    // flight — see `pendingPickCancel`'s own comment. Consumed here,
    // unconditionally, before anything is armed.
    if (this.pendingPickCancel.delete(tabId)) {
      return Promise.resolve(null).finally(() =>
        t.send("Overlay.setInspectMode", { mode: "none" }).catch(() => {}),
      );
    }
    return new Promise<{
      backendNodeId: number;
      chainBackendNodeIds: number[];
    } | null>((resolve, reject) => {
      let settled = false;
      const onEvent = (
        source: { tabId?: number },
        method: string,
        params?: object,
      ) => {
        if (source.tabId !== tabId) return;
        // The page-side counterpart to a STOP click in the panel: Chromium
        // fires this when inspect mode is cancelled without a click — the
        // user pressing Escape while the INSPECTED PAGE (not the panel) has
        // focus, which the panel's own Escape listener never sees (it's
        // scoped to the panel's document — see App.tsx's own comment on
        // that). Confirmed empirically against a real Chromium: `Escape` on
        // the page fires `Overlay.inspectModeCanceled` with no
        // `inspectNodeRequested` alongside it.
        if (method === "Overlay.inspectModeCanceled") {
          finish(null);
          return;
        }
        if (method !== "Overlay.inspectNodeRequested") return;
        const picked = params as { backendNodeId: number } | undefined;
        if (!picked) {
          finish(null);
          return;
        }
        void resolveChain(picked.backendNodeId).then((chainBackendNodeIds) =>
          finish({ backendNodeId: picked.backendNodeId, chainBackendNodeIds }),
        );
      };
      /**
       * Chromium's hit test resolves to the exact DOM element under the
       * cursor, which is often a node the accessibility tree never kept —
       * an unnamed wrapper `<span>` inside a named button, padding inside a
       * labelled group, and so on (the DOM picker's own `resolveTracked`
       * walks `.parentElement` for the identical reason). `Accessibility.
       * getAXNodeAndAncestors` returns the AX node for `backendNodeId` and
       * its ancestors up to the root in one call — cheaper than walking the
       * DOM domain's own parent chain node by node — so the panel can try
       * each ancestor in turn against whatever tree it currently has
       * loaded until one is actually present. A failure here (an older
       * Chromium without the method, a torn-down target) degrades to just
       * the raw hit, matching this function's pre-fallback behavior rather
       * than losing the pick entirely.
       */
      const resolveChain = async (backendNodeId: number): Promise<number[]> => {
        try {
          // `getAXNodeAndAncestors` answers "Accessibility has not been
          // enabled" without this — this `runPick` attach span never enables
          // the Accessibility domain otherwise (readNativeTree does, but
          // that's a separate withDebugger call). Idempotent, so calling it
          // again if a later change to this method ever does enable it
          // elsewhere costs nothing.
          await t.send("Accessibility.enable");
          const result = await t.send<{
            nodes?: Array<{ backendDOMNodeId?: number }>;
          }>("Accessibility.getAXNodeAndAncestors", { backendNodeId });
          const ancestorIds = (result.nodes ?? [])
            .map((n) => n.backendDOMNodeId)
            .filter((id): id is number => typeof id === "number");
          // The raw hit always leads, regardless of what index 0 of the
          // ancestor response reports — this is a fallback CHAIN, not a
          // replacement for the actual click target.
          return Array.from(new Set([backendNodeId, ...ancestorIds]));
        } catch {
          return [backendNodeId];
        }
      };
      const finish = (
        value: { backendNodeId: number; chainBackendNodeIds: number[] } | null,
      ) => {
        if (settled) return;
        settled = true;
        chrome.debugger.onEvent.removeListener(onEvent);
        this.pickCancel.delete(tabId);
        this.pickReject.delete(tabId);
        resolve(value);
      };
      const rejectWith = () => {
        if (settled) return;
        settled = true;
        chrome.debugger.onEvent.removeListener(onEvent);
        this.pickCancel.delete(tabId);
        this.pickReject.delete(tabId);
        // A static, recognized string (R6: never surface a raw
        // chrome.runtime.lastError/onDetach reason verbatim) — matches
        // `isConnectionLost`'s own "Target closed." pattern so
        // `attachAndRun`'s catch classifies this the same way a mid-read or
        // mid-act disconnect already is, regardless of what `reason` Chrome
        // actually reported for this detach.
        reject(new Error("Target closed."));
      };
      this.pickCancel.set(tabId, () => finish(null));
      this.pickReject.set(tabId, rejectWith);
      chrome.debugger.onEvent.addListener(onEvent);
      // `Overlay.setInspectMode` answers "DOM should be enabled first" without
      // this — the Overlay domain resolves a hit-tested node against the DOM
      // domain's own node tree, which nothing else in this class ever enables
      // (readNativeTree/dispatchNative go through Accessibility/Runtime, not
      // DOM). `DOM.enable` needs no matching disable: this session's own
      // detach (the `finally` below, then `withDebugger`'s own) drops it with
      // the rest of the attachment.
      void t
        .send("DOM.enable")
        .then(() => t.send("Overlay.enable"))
        .then(() =>
          t.send("Overlay.setInspectMode", {
            mode: "searchForNode",
            highlightConfig: {
              contentColor: { r: 111, g: 168, b: 220, a: 0.35 },
              showInfo: true,
            },
          }),
        )
        .catch(() => finish(null));
    }).finally(() =>
      // Best-effort: if the tab or connection is already gone this is a
      // no-op failure, same as every other cleanup call in this file.
      t.send("Overlay.setInspectMode", { mode: "none" }).catch(() => {}),
    );
  }

  /** Cancel an in-flight {@link runPick} on `tabId` — armed (a `pickCancel`
   *  entry exists) or still attaching (nothing armed yet, so the intent is
   *  recorded in {@link pendingPickCancel} for `runPick` itself to consume;
   *  see that field's own comment for why). Returns whether either applied —
   *  a stop with truly nothing outstanding (picking already resolved, or
   *  this worker instance never armed it) still records a pending cancel and
   *  reports `true`; the cost of that false positive is at most one future
   *  pick silently resolving as cancelled, never a hang, and is the
   *  deliberate trade `pendingPickCancel` documents. */
  cancelPick(tabId: number): boolean {
    const cancel = this.pickCancel.get(tabId);
    if (cancel) {
      cancel();
      return true;
    }
    this.pendingPickCancel.add(tabId);
    return true;
  }

  /**
   * Cancel every in-flight pick, across every tab. Called before
   * {@link detachAll} (the revoke path — turning native mode off): without
   * this, a pick session that never got a click would sit in the per-tab
   * queue {@link detachAll} waits on, and "Disable native mode" would hang
   * until the user happened to click something or time out the worker.
   */
  cancelAllPicks(): void {
    for (const cancel of [...this.pickCancel.values()]) cancel();
  }
}
