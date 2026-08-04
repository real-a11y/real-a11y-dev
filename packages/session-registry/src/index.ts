import { redactUrl } from "@real-a11y-dev/snapshot";

/** Upper bound for idle timeouts (1 hour) to avoid resource-exhaustion warnings. */
const MAX_IDLE_MS = 3_600_000;

/**
 * Holds named browser sessions and schedules work on them.
 *
 * - One command per session at a time, so concurrent invocations against
 *   the same session do not race a mutable page.
 * - Multiple sessions run independently.
 * - An idle timeout stops every session if no command has completed recently,
 *   preventing orphaned Chromium processes on quiet machines.
 *
 * This package is consumer-neutral: errors are the typed classes below, each
 * carrying a `hint`, and the embedding surface (CLI daemon, MCP server) maps
 * them onto its own error contract.
 */

/**
 * Base class for every error this registry throws. The `hint` is a remedy the
 * consumer can surface next to the message.
 */
export class SessionRegistryError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "SessionRegistryError";
  }
}

/**
 * A session was requested with browser-defining flags (or a working directory)
 * different from the ones it was created with.
 */
export class SessionIdentityError extends SessionRegistryError {
  constructor(message: string, hint?: string) {
    super(message, hint);
    this.name = "SessionIdentityError";
  }
}

/** A session reuse requested origins outside the session's pinned allowlist. */
export class SessionOriginError extends SessionRegistryError {
  constructor(message: string, hint?: string) {
    super(message, hint);
    this.name = "SessionOriginError";
  }
}

/**
 * A transient failure because the registry is shutting down. Consumers should
 * treat this as retryable against a fresh registry/daemon.
 */
export class RegistryShutdownError extends SessionRegistryError {
  constructor() {
    super("session daemon is shutting down");
    this.name = "RegistryShutdownError";
  }
}

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

export interface SessionFlagsLike {
  headful?: boolean;
  cdp?: string;
  storageState?: string;
  allowedOrigins?: readonly string[];
  chromePath?: string;
  realA11yChromePath?: string;
  realA11yBrowsersDir?: string;
  proxy?: {
    server: string;
    bypass?: string;
    username?: string;
    password?: string;
  };
  verbose?: boolean;
  /**
   * Working directory pinned to the first run so a session cannot be reused
   * to auto-discover a config from an arbitrary directory.
   */
  cwd?: string;
}

interface SessionHolder<T extends SessionLike> {
  session: T;
  createdAt: number;
  lastUsedAt: number;
  queue: Promise<unknown>;
  busy: boolean;
  identityKey: string;
  allowedOrigins: string[];
  /** Working directory pinned to the first run. */
  cwd?: string;
}

export interface SessionRegistryOptions {
  /**
   * Idle timeout in ms; `0` disables automatic shutdown. Values above 1 hour
   * are capped at 1 hour.
   */
  idleTimeoutMs?: number;
  /** Called when the idle timer fires; the daemon stops itself. */
  onIdleTimeout?: () => void | Promise<void>;
}

interface CreationEntry<T extends SessionLike> {
  promise: Promise<SessionHolder<T>>;
  identityKey: string;
  allowedOrigins: readonly string[];
  /** Working directory pinned to the first run. */
  cwd?: string;
}

export class SessionRegistry<T extends SessionLike> {
  private sessions = new Map<string, SessionHolder<T>>();
  private creating = new Map<string, CreationEntry<T>>();
  private stopping = false;
  private stopped = false;
  private idleTimer?: NodeJS.Timeout;
  private busyCount = 0;
  private idleMs: number;
  private readonly startupGraceMs: number;
  private hasRun = false;
  private readonly onIdleTimeout?: () => void | Promise<void>;

  constructor(options: SessionRegistryOptions = {}) {
    this.idleMs = this.clampIdleTimeout(options.idleTimeoutMs ?? 0);
    // Give the daemon enough time to bind its socket and process the first run
    // before an aggressive idle timeout can shut it down. After the first run
    // completes, the user-supplied idle timeout takes over.
    this.startupGraceMs = Math.max(this.idleMs, 30_000);
    this.onIdleTimeout = options.onIdleTimeout;
    if (this.idleMs > 0) this.resetIdleTimer();
  }

  /**
   * Run `task` exclusively for `name`.  Creates the session with `factory` on
   * first use; `factory` is only called once per name even for racing requests.
   *
   * Generic over the task's result: the CLI daemon returns exit codes, the MCP
   * server returns structured tool results — the scheduling is identical.
   */
  async run<R>(
    name: string,
    sessionFlags: SessionFlagsLike,
    idleTimeoutMs: number,
    factory: () => Promise<T>,
    task: (session: T) => Promise<R>,
  ): Promise<R> {
    if (this.stopping || this.stopped) {
      throw new RegistryShutdownError();
    }
    // A non-negative idle timeout overrides the registry default. `0` disables
    // automatic shutdown for the current run (and any concurrent sessions).
    if (idleTimeoutMs >= 0) {
      this.setIdleTimeout(idleTimeoutMs);
    }
    this.busyCount++;
    const holder = await this.getOrCreate(name, sessionFlags, factory).catch(
      (err) => {
        this.busyCount--;
        this.resetIdleTimer();
        throw err;
      },
    );
    const next = (async () => {
      await holder.queue;
      holder.busy = true;
      this.clearIdleTimer();
      try {
        const result = await task(holder.session);
        holder.lastUsedAt = Date.now();
        return result;
      } finally {
        holder.busy = false;
      }
    })();
    holder.queue = next.catch(() => 0);
    try {
      return await next;
    } finally {
      this.busyCount--;
      this.hasRun = true;
      this.resetIdleTimer();
    }
  }

  list(): SessionInfo[] {
    return [...this.sessions.entries()].map(([name, holder]) => {
      const rawUrl = holder.session.currentUrl();
      return {
        name,
        url: rawUrl ? redactUrl(rawUrl) : undefined,
        createdAt: holder.createdAt,
        lastUsedAt: holder.lastUsedAt,
        busy: holder.busy,
      };
    });
  }

  async stop(name: string): Promise<boolean> {
    const holder = this.sessions.get(name);
    if (!holder) return false;
    this.sessions.delete(name);
    // Let any in-flight work finish before tearing down the session.
    await holder.queue.catch(() => 0);
    await holder.session.close();
    this.resetIdleTimer();
    return true;
  }

  /** Drop all current sessions but keep the registry available for new runs. */
  async stopAll(): Promise<void> {
    this.stopping = true;
    this.clearIdleTimer();
    const holders = [...this.sessions.values()];
    const inFlight = [...this.creating.values()];
    this.sessions.clear();
    this.creating.clear();
    try {
      await Promise.allSettled([
        ...inFlight.map((entry) => entry.promise.catch(() => 0)),
        ...holders.map(async (h) => {
          await h.queue.catch(() => 0);
          await h.session.close();
        }),
      ]);
    } finally {
      this.stopping = false;
      this.resetIdleTimer();
    }
  }

  /** Shut the registry down permanently; no new runs will be accepted. */
  shutdown(): void {
    this.stopping = true;
    this.stopped = true;
    this.clearIdleTimer();
  }

  /** Whether the registry has been permanently shut down. */
  isShutdown(): boolean {
    return this.stopped;
  }

  setIdleTimeout(ms: number): void {
    this.idleMs = this.clampIdleTimeout(ms);
    this.clearIdleTimer();
    this.resetIdleTimer();
  }

  private clampIdleTimeout(ms: number): number {
    if (!Number.isFinite(ms)) return 0;
    if (ms <= 0) return 0;
    return Math.min(ms, MAX_IDLE_MS);
  }

  private async getOrCreate(
    name: string,
    sessionFlags: SessionFlagsLike,
    factory: () => Promise<T>,
  ): Promise<SessionHolder<T>> {
    const requestedOrigins = sessionFlags.allowedOrigins ?? [];
    const requestedCwd = sessionFlags.cwd;
    const identity = identityKey(sessionFlags);

    const existing = this.sessions.get(name);
    if (existing) {
      if (existing.cwd !== requestedCwd) {
        throw new SessionIdentityError(
          `session "${name}" was created in a different working directory`,
          "stop the session first, then retry with the new directory",
        );
      }
      if (existing.identityKey !== identity) {
        throw new SessionIdentityError(
          `session "${name}" was created with different browser flags`,
          "stop the session first, then retry with the new flags",
        );
      }
      if (!isOriginSubset(requestedOrigins, existing.allowedOrigins)) {
        throw new SessionOriginError(
          `session "${name}" does not include all requested origins`,
          "stop the session first, then retry with the new targets or --audit-origin",
        );
      }
      return existing;
    }

    const inFlight = this.creating.get(name);
    if (inFlight) {
      if (inFlight.cwd !== requestedCwd) {
        throw new SessionIdentityError(
          `session "${name}" is already being created in a different working directory`,
          "stop the session first, then retry with the new directory",
        );
      }
      if (inFlight.identityKey !== identity) {
        throw new SessionIdentityError(
          `session "${name}" is already being created with different browser flags`,
          "stop the session first, then retry with the new flags",
        );
      }
      if (!isOriginSubset(requestedOrigins, inFlight.allowedOrigins)) {
        throw new SessionOriginError(
          `session "${name}" is already being created without all requested origins`,
          "stop the session first, then retry with the new targets or --audit-origin",
        );
      }
      return inFlight.promise;
    }

    const create = (async () => {
      try {
        const session = await factory();
        if (this.stopping || this.stopped) {
          await session.close();
          throw new RegistryShutdownError();
        }
        const holder: SessionHolder<T> = {
          session,
          createdAt: Date.now(),
          lastUsedAt: Date.now(),
          queue: Promise.resolve(),
          busy: false,
          identityKey: identity,
          allowedOrigins: requestedOrigins.slice().sort(),
          cwd: requestedCwd,
        };
        this.sessions.set(name, holder);
        this.resetIdleTimer();
        return holder;
      } finally {
        this.creating.delete(name);
      }
    })();

    this.creating.set(name, {
      promise: create,
      identityKey: identity,
      allowedOrigins: requestedOrigins,
      cwd: requestedCwd,
    });
    return create;
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer();
    if (this.idleMs <= 0 || this.busyCount > 0 || this.stopped) return;
    // Use a longer grace period until the first run completes so a short
    // idle timeout does not race the socket/pidfile handshake.
    const requestedDelay = this.hasRun ? this.idleMs : this.startupGraceMs;
    if (!Number.isFinite(requestedDelay) || requestedDelay < 0) return;
    if (requestedDelay > MAX_IDLE_MS) {
      this.idleTimer = setTimeout(() => this.fireIdleTimeout(), MAX_IDLE_MS);
      return;
    }
    this.idleTimer = setTimeout(() => this.fireIdleTimeout(), requestedDelay);
  }

  private fireIdleTimeout(): void {
    // A run may have started between arming and firing; don't shut down
    // while a command is still in progress.
    if (this.busyCount > 0 || this.stopped) return;
    void (this.onIdleTimeout ? this.onIdleTimeout() : this.stopAll());
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }
}

function identityKey(flags: SessionFlagsLike): string {
  const base: Record<string, unknown> = {
    headful: flags.headful,
    cdp: flags.cdp,
    chromePath: flags.chromePath,
    realA11yChromePath: flags.realA11yChromePath,
    realA11yBrowsersDir: flags.realA11yBrowsersDir,
    storageState: flags.storageState,
    proxy: flags.proxy,
    cwd: flags.cwd,
  };
  return JSON.stringify(base);
}

function isOriginSubset(
  requested: readonly string[],
  pinned: readonly string[],
): boolean {
  if (requested.length === 0) return true;
  const pinnedSet = new Set(pinned);
  return requested.every((origin) => pinnedSet.has(origin));
}
