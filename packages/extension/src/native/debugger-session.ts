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

export interface AttachOutcome {
  ok: boolean;
  /** Static reason when !ok: "conflict" | "attach-failed". */
  error?: "conflict" | "attach-failed";
}

/**
 * Owns the debugger connection for native mode and the dogfood log. One
 * instance per service-worker wake; MV3 may suspend the worker between uses,
 * so it never assumes a durable attach — `withDebugger` attaches fresh and
 * detaches in `finally`, and `onDetach` records unsolicited drops.
 */
export class NativeDebuggerSession {
  private log: DogfoodLog;
  /** Tabs we believe we're attached to, with the attach timestamp. */
  private attachedAt = new Map<number, number>();

  constructor(storage: {
    get(k: string): Promise<Record<string, unknown>>;
    set(i: Record<string, unknown>): Promise<void>;
  }) {
    this.log = new DogfoodLog(storage);
    // MV3: the debugger detaches when the SW suspends, when DevTools opens on
    // the tab, or when the tab closes. Record it as the lifecycle signal.
    chrome.debugger.onDetach.addListener((source, reason) => {
      const tabId = source.tabId;
      if (typeof tabId !== "number" || !this.attachedAt.has(tabId)) return;
      const attachedMs =
        Date.now() - (this.attachedAt.get(tabId) ?? Date.now());
      this.attachedAt.delete(tabId);
      void this.log.record({
        kind: "detach-unsolicited",
        at: Date.now(),
        reason: String(reason),
        attachedMs,
      });
    });
  }

  dogfoodLog(): DogfoodLog {
    return this.log;
  }

  /** Attach → run → always detach, recording banner dwell + conflicts. */
  async withDebugger<T>(
    tabId: number,
    fn: (t: CdpTransport) => Promise<T>,
  ): Promise<{ outcome: AttachOutcome; value?: T }> {
    const attach = await this.attach(tabId);
    if (!attach.ok) return { outcome: attach };
    const startedAt = Date.now();
    try {
      const value = await fn(transportFor(tabId));
      return { outcome: { ok: true }, value };
    } finally {
      await this.detach(tabId, Date.now() - startedAt);
    }
  }

  private async attach(tabId: number): Promise<AttachOutcome> {
    try {
      await chrome.debugger.attach({ tabId }, PROTOCOL);
      this.attachedAt.set(tabId, Date.now());
      await this.log.record({ kind: "attach", at: Date.now() });
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isDebuggerConflict(msg)) {
        await this.log.record({ kind: "conflict", at: Date.now() });
        return { ok: false, error: "conflict" };
      }
      return { ok: false, error: "attach-failed" };
    }
  }

  private async detach(tabId: number, attachedMs: number): Promise<void> {
    if (!this.attachedAt.has(tabId)) return; // already dropped (onDetach handled it)
    this.attachedAt.delete(tabId);
    await this.log.record({ kind: "detach", at: Date.now(), attachedMs });
    // The tab may be gone; a failed detach is not actionable.
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }
}
