/**
 * Holds named browser sessions and schedules work on them.
 *
 * - One command per session at a time, so concurrent CLI invocations against
 *   the same session do not race a mutable page.
 * - Multiple sessions run independently.
 * - An idle timeout stops every session if no command has completed recently,
 *   preventing orphaned Chromium processes on quiet machines.
 */

export interface SessionLike {
  currentUrl(): string | undefined;
  close(): Promise<void>;
}

export interface SessionInfo {
  name: string;
  url?: string;
  createdAt: number;
  lastUsedAt: number;
  busy: boolean;
}

interface SessionHolder<T extends SessionLike> {
  session: T;
  createdAt: number;
  lastUsedAt: number;
  queue: Promise<unknown>;
  busy: boolean;
}

export interface SessionRegistryOptions {
  /** Idle timeout in ms; `0` disables automatic shutdown. */
  idleTimeoutMs?: number;
  /** Called when the idle timer fires; the daemon stops itself. */
  onIdleTimeout?: () => void | Promise<void>;
}

export class SessionRegistry<T extends SessionLike> {
  private sessions = new Map<string, SessionHolder<T>>();
  private creating = new Map<string, Promise<SessionHolder<T>>>();
  private idleTimer?: NodeJS.Timeout;
  private busyCount = 0;
  private readonly idleMs: number;
  private readonly onIdleTimeout?: () => void | Promise<void>;

  constructor(options: SessionRegistryOptions = {}) {
    this.idleMs = options.idleTimeoutMs ?? 0;
    this.onIdleTimeout = options.onIdleTimeout;
  }

  /**
   * Run `task` exclusively for `name`.  Creates the session with `factory` on
   * first use; `factory` is only called once per name even for racing requests.
   */
  async run(
    name: string,
    factory: () => Promise<T>,
    task: (session: T) => Promise<number>,
  ): Promise<number> {
    const holder = await this.getOrCreate(name, factory);
    const next = (async () => {
      await holder.queue;
      holder.busy = true;
      this.busyCount++;
      this.clearIdleTimer();
      try {
        const exitCode = await task(holder.session);
        holder.lastUsedAt = Date.now();
        return exitCode;
      } finally {
        holder.busy = false;
        this.busyCount--;
        this.resetIdleTimer();
      }
    })();
    holder.queue = next.catch(() => 0);
    return next;
  }

  list(): SessionInfo[] {
    return [...this.sessions.entries()].map(([name, holder]) => ({
      name,
      url: holder.session.currentUrl(),
      createdAt: holder.createdAt,
      lastUsedAt: holder.lastUsedAt,
      busy: holder.busy,
    }));
  }

  async stop(name: string): Promise<boolean> {
    const holder = this.sessions.get(name);
    if (!holder) return false;
    this.sessions.delete(name);
    await holder.session.close();
    this.resetIdleTimer();
    return true;
  }

  async stopAll(): Promise<void> {
    this.clearIdleTimer();
    const holders = [...this.sessions.values()];
    this.sessions.clear();
    this.creating.clear();
    await Promise.allSettled(holders.map((h) => h.session.close()));
  }

  private async getOrCreate(
    name: string,
    factory: () => Promise<T>,
  ): Promise<SessionHolder<T>> {
    const existing = this.sessions.get(name);
    if (existing) return existing;

    const inFlight = this.creating.get(name);
    if (inFlight) return inFlight;

    const create = (async () => {
      try {
        const session = await factory();
        const holder: SessionHolder<T> = {
          session,
          createdAt: Date.now(),
          lastUsedAt: Date.now(),
          queue: Promise.resolve(),
          busy: false,
        };
        this.sessions.set(name, holder);
        this.resetIdleTimer();
        return holder;
      } finally {
        this.creating.delete(name);
      }
    })();

    this.creating.set(name, create);
    return create;
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer();
    if (this.idleMs <= 0 || this.sessions.size === 0 || this.busyCount > 0)
      return;
    this.idleTimer = setTimeout(() => {
      void (this.onIdleTimeout ? this.onIdleTimeout() : this.stopAll());
    }, this.idleMs);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }
}
