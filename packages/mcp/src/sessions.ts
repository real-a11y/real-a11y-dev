/**
 * Named browser sessions for the MCP server.
 *
 * Embeds the same `SessionRegistry` the CLI session daemon uses (single-flight
 * scheduling within a session, parallel across sessions, idle timeout), but
 * in-process: stdio transport means the parent MCP client is the only caller,
 * so there is no socket, token, or pidfile — those exist in the CLI daemon
 * because it crosses processes; this doesn't.
 *
 * Auth stays process-level operator config: every named session inherits the
 * same storage state / origin allowlist / CDP / headful settings from the
 * environment. The `session` tool parameter selects a page context — never
 * credentials.
 */

import type { A11ySession, NativeCheckpoint } from "@real-a11y-dev/browser";
import {
  SessionRegistry,
  SessionRegistryError,
  type SessionInfo,
} from "@real-a11y-dev/session-registry";
import { redactUrl } from "@real-a11y-dev/snapshot";

import { CheckpointStore } from "./checkpoints.js";

// Public API surface for embedders: a custom `SessionManager` signals
// refusals by throwing `SessionRegistryError` (the server maps it to a tool
// error); `SessionInfo` is the registry's row type, re-exported rather than
// copied so the two cannot drift.
export {
  RegistryShutdownError,
  SessionRegistryError,
  type SessionInfo,
} from "@real-a11y-dev/session-registry";

/**
 * Name grammar for the `session` tool parameter. Deliberately STRICTER than
 * the CLI's `--session` (whose `sanitizeSessionName` rewrites hostile
 * characters instead of rejecting, allows `.`, and caps at 55 chars): the CLI
 * embeds names in filesystem paths and must accept whatever a shell passes,
 * while a tool parameter comes from an agent — rejecting a malformed name
 * outright surfaces the typo instead of silently normalizing it into a
 * different session. Changing one grammar does not change the other.
 */
export const SESSION_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;

export const DEFAULT_SESSION = "default";

/**
 * One named session: the browser session plus the page-coupled server state
 * that used to live as `buildServer` closure variables. The checkpoint store
 * is INJECTED, not owned: findings checkpoints outlive the browser (see
 * `McpSessionManager.checkpoints`), while `openedUrl` and the tree checkpoint
 * are bound to this record and die with it.
 */
export class SessionRecord {
  /** Where `open_page` last put this session; `pageUrl()` fallback only. */
  openedUrl = "";
  /**
   * The tree checkpoint, if one has been captured.
   *
   * It holds the captured tree HERE, in Node, rather than in the page — which
   * is what lets it survive a navigation well enough to say so. The in-page
   * checkpoint it replaced could only vanish, leaving `diff_tree` unable to
   * distinguish "nothing changed" from "the document went away".
   */
  treeCheckpoint: NativeCheckpoint | undefined;

  constructor(
    readonly session: A11ySession,
    readonly checkpoints: CheckpointStore = new CheckpointStore(),
  ) {}

  // SessionLike, delegated — the registry schedules and closes records.
  currentUrl(): string | undefined {
    return this.session.currentUrl();
  }
  async close(): Promise<void> {
    await this.session.close();
  }
}

/**
 * What `buildServer` needs from a session provider. `run` is deliberately the
 * only way to reach a record: scoping access to a callback makes the
 * per-session single-flight guarantee structural instead of an instruction in
 * the server's prose.
 *
 * Refusals (bad name, session cap, shutdown) are signalled by throwing
 * `SessionRegistryError` (re-exported from this package) — the server turns
 * those into tool errors with the hint attached; anything else escapes as a
 * genuine exception.
 *
 * Implementations must not depend on `this` binding: the server may store,
 * pass, and call these methods detached (`process.on("SIGTERM",
 * manager.shutdown)` must work). Use closures or bound/arrow members.
 */
export interface SessionManager {
  run<R>(name: string, task: (record: SessionRecord) => Promise<R>): Promise<R>;
  list(): SessionInfo[];
  stop(name: string): Promise<boolean>;
  stopAll(): Promise<void>;
  /**
   * The named session's findings-checkpoint store, WITHOUT creating or
   * reserving a browser session. Checkpoint-only tools (list / diff / export /
   * import) go through this so a typo'd `session` can't burn a `maxSessions`
   * slot, and so checkpoints survive the idle timeout closing the browser.
   */
  checkpoints(name: string): CheckpointStore;
  /**
   * Permanent teardown: close every session, release timers, refuse new work.
   * `stopAll` is the recoverable sibling (sessions relaunch on the next call);
   * this is for process exit.
   */
  shutdown(): Promise<void>;
}

export interface McpSessionManagerOptions {
  /** Builds a fresh, not-yet-opened browser session from operator env config. */
  createSession: () => A11ySession;
  /**
   * Cap on concurrently live sessions so an agent typo in `session` cannot
   * accumulate Chromiums. Default 4.
   */
  maxSessions?: number;
  /**
   * Idle ms before all sessions close (the server process stays up; the next
   * call relaunches — and findings checkpoints survive, they live outside the
   * sessions). Default 15 minutes; `0` disables; capped at 1 hour by the
   * registry.
   */
  idleTimeoutMs?: number;
}

export class McpSessionManager implements SessionManager {
  private readonly registry: SessionRegistry<SessionRecord>;
  private readonly createSession: () => A11ySession;
  private readonly maxSessions: number;
  /**
   * Findings-checkpoint stores, keyed by session name, OUTSIDE the registry:
   * the idle timeout closes browsers (cheap to relaunch) but must not
   * silently discard baselines an agent saved for a later diff — that failure
   * mode re-baselines and reports zero regressions. The one documented way to
   * discard checkpoints stays `close_browser`, which deletes the store.
   */
  private readonly stores = new Map<string, CheckpointStore>();

  constructor(options: McpSessionManagerOptions) {
    this.createSession = options.createSession;
    this.maxSessions = Math.max(1, options.maxSessions ?? 4);
    this.registry = new SessionRegistry<SessionRecord>({
      idleTimeoutMs: options.idleTimeoutMs ?? 900_000,
    });
  }

  // Arrow members, not prototype methods: `SessionManager` is shaped like a
  // callback bag, and callers will treat it like one (`const { run } =
  // manager`, `process.on("SIGTERM", manager.shutdown)`). Detached calls must
  // not lose `this`.
  //
  // `run` is async on purpose: validation failures become rejections, so
  // callers can rely on the returned promise carrying every failure mode.
  run = async <R>(
    name: string,
    task: (record: SessionRecord) => Promise<R>,
  ): Promise<R> => {
    this.assertValidName(name);
    // Synchronous check-then-schedule: no `await` before the registry call
    // registers the name, so N parallel calls with N new names each see the
    // reservations of the calls before them. `has`/`size` count in-flight
    // creations too — `list()` alone misses them until the factory resolves.
    if (!this.registry.has(name) && this.registry.size() >= this.maxSessions) {
      throw new SessionRegistryError(
        `session limit reached (${this.maxSessions} live sessions)`,
        "close one with close_browser (see list_sessions), or raise REAL_A11Y_MCP_MAX_SESSIONS",
      );
    }
    // All sessions share one env-derived construction config, so the identity
    // flags are identical by construction — pass an empty identity and let the
    // registry's pinning stay armed for a future per-session option.
    // idleTimeoutMs -1: keep the registry-wide default set in the constructor.
    return this.registry.run(
      name,
      {},
      -1,
      async () =>
        new SessionRecord(this.createSession(), this.checkpoints(name)),
      task,
    );
  };

  list = (): SessionInfo[] => this.registry.list();

  stop = async (name: string): Promise<boolean> => {
    this.assertValidName(name);
    const stopped = await this.registry.stop(name);
    // Closing a session is the documented way to discard its checkpoints —
    // even when the browser was already gone (idle timeout) and only the
    // store remains.
    this.stores.delete(name);
    return stopped;
  };

  /**
   * Close every session and discard every checkpoint — `close_browser
   * all=true`. NOT the idle-timeout path: that one fires inside the registry
   * (`SessionRegistry.fireIdleTimeout`), which cannot see these stores, so
   * checkpoints survive it by construction.
   */
  stopAll = async (): Promise<void> => {
    this.stores.clear();
    await this.registry.stopAll();
  };

  checkpoints = (name: string): CheckpointStore => {
    this.assertValidName(name);
    let store = this.stores.get(name);
    if (!store) {
      // Hygiene: drop empty stores of sessions that no longer exist, so
      // checkpoint reads against typo'd names can't grow the map unbounded.
      // Stores holding real checkpoints are kept — that's saved data.
      for (const [n, s] of this.stores) {
        if (s.size === 0 && !this.registry.has(n)) this.stores.delete(n);
      }
      store = new CheckpointStore();
      this.stores.set(name, store);
    }
    return store;
  };

  shutdown = async (): Promise<void> => {
    this.registry.shutdown();
    this.stores.clear();
    await this.registry.stopAll();
  };

  private assertValidName(name: string): void {
    if (!SESSION_NAME_RE.test(name)) {
      throw new SessionRegistryError(
        `invalid session name "${name}"`,
        "use 1-32 characters from A-Z, a-z, 0-9, _ and -",
      );
    }
  }
}

/**
 * Back-compat adapter for `buildServer(session)` embedders: ONE externally
 * owned session, presented honestly as single-session. A named `session`
 * other than "default" is refused with the remedy — pretending every name
 * maps to the one page would silently cross-contaminate checkpoints and
 * diffs, which is worse than an error. No scheduling is added — calls run
 * exactly as they did before named sessions existed.
 *
 * Closure-based on purpose: every method must survive being detached from
 * the object (see the `SessionManager` contract).
 */
export function singleSessionManager(session: A11ySession): SessionManager {
  const record = new SessionRecord(session);
  const createdAt = Date.now();
  let lastUsedAt = createdAt;
  /** A tool call has touched the session since start (or since last stop). */
  let used = false;
  /** In-flight calls — no serialization is added, but `list` reports truth. */
  let inFlight = 0;

  const notSingleSession = (name: string) =>
    new SessionRegistryError(
      `this server has a single browser session — there is no session "${name}"`,
      `it was started on one externally managed session; omit the session parameter (or pass "${DEFAULT_SESSION}")`,
    );

  const live = () => used || inFlight > 0 || session.currentUrl() !== undefined;

  const run = async <R>(
    name: string,
    task: (record: SessionRecord) => Promise<R>,
  ): Promise<R> => {
    if (name !== DEFAULT_SESSION) throw notSingleSession(name);
    used = true;
    lastUsedAt = Date.now();
    inFlight++;
    try {
      return await task(record);
    } finally {
      inFlight--;
      lastUsedAt = Date.now();
    }
  };

  const list = (): SessionInfo[] => {
    if (!live()) return [];
    const rawUrl = session.currentUrl();
    return [
      {
        name: DEFAULT_SESSION,
        // Same contract as the registry's list(): never the raw URL — an
        // embedder's page can carry credentials in userinfo/query.
        url: rawUrl ? redactUrl(rawUrl) : undefined,
        createdAt,
        lastUsedAt,
        busy: inFlight > 0,
      },
    ];
  };

  const stop = async (name: string): Promise<boolean> => {
    // Only the one session this manager actually has can be closed. Closing
    // the embedder's browser because an agent typo'd a name would be the
    // worst possible reading of "was not open".
    if (name !== DEFAULT_SESSION || !live()) return false;
    // Closing is what close_browser always did on this path. The session
    // OBJECT stays with the embedder — A11ySession relaunches lazily on the
    // next use, so this frees resources without taking ownership.
    await session.close();
    record.checkpoints.clear();
    record.treeCheckpoint = undefined;
    record.openedUrl = "";
    used = false;
    return true;
  };

  const stopAll = async (): Promise<void> => {
    await stop(DEFAULT_SESSION);
  };

  const checkpoints = (name: string): CheckpointStore => {
    if (name !== DEFAULT_SESSION) throw notSingleSession(name);
    return record.checkpoints;
  };

  return {
    run,
    list,
    stop,
    stopAll,
    checkpoints,
    // The embedder owns the session's lifecycle and this manager holds no
    // timers — permanent teardown is just "close what's open".
    shutdown: stopAll,
  };
}
