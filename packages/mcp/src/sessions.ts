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

import type { A11ySession } from "@real-a11y-dev/browser";
import {
  SessionRegistry,
  SessionRegistryError,
} from "@real-a11y-dev/session-registry";

import { CheckpointStore } from "./checkpoints.js";

/** Same name grammar as the CLI's `--session`. */
export const SESSION_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;

export const DEFAULT_SESSION = "default";

/**
 * One named session: the browser session plus the page-coupled server state
 * that used to live as `buildServer` closure variables. Checkpoints are per
 * session on purpose — two sessions must never see each other's baselines.
 */
export class SessionRecord {
  readonly checkpoints = new CheckpointStore();
  /** Where `open_page` last put this session; `pageUrl()` fallback only. */
  openedUrl = "";
  /** Root the in-page tree checkpoint was captured with, if any. */
  treeCheckpointRoot: string | undefined;

  constructor(readonly session: A11ySession) {}

  // SessionLike, delegated — the registry schedules and closes records.
  currentUrl(): string | undefined {
    return this.session.currentUrl();
  }
  async close(): Promise<void> {
    await this.session.close();
  }
}

export interface SessionInfo {
  name: string;
  url?: string;
  createdAt: number;
  lastUsedAt: number;
  busy: boolean;
}

/**
 * What `buildServer` needs from a session provider. `run` is deliberately the
 * only way to reach a record: scoping access to a callback makes the
 * per-session single-flight guarantee structural instead of an instruction in
 * the server's prose.
 */
export interface SessionManager {
  run<R>(name: string, task: (record: SessionRecord) => Promise<R>): Promise<R>;
  list(): SessionInfo[];
  stop(name: string): Promise<boolean>;
  stopAll(): Promise<void>;
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
   * call relaunches). Default 15 minutes; `0` disables; capped at 1 hour by
   * the registry.
   */
  idleTimeoutMs?: number;
}

export class McpSessionManager implements SessionManager {
  private readonly registry: SessionRegistry<SessionRecord>;
  private readonly createSession: () => A11ySession;
  private readonly maxSessions: number;

  constructor(options: McpSessionManagerOptions) {
    this.createSession = options.createSession;
    this.maxSessions = Math.max(1, options.maxSessions ?? 4);
    this.registry = new SessionRegistry<SessionRecord>({
      idleTimeoutMs: options.idleTimeoutMs ?? 900_000,
    });
  }

  // `async` on purpose: validation failures become rejections, so callers can
  // rely on the returned promise carrying every failure mode.
  async run<R>(
    name: string,
    task: (record: SessionRecord) => Promise<R>,
  ): Promise<R> {
    if (!SESSION_NAME_RE.test(name)) {
      throw new SessionRegistryError(
        `invalid session name "${name}"`,
        "use 1-32 characters from A-Z, a-z, 0-9, _ and -",
      );
    }
    const live = this.registry.list();
    if (live.length >= this.maxSessions && !live.some((s) => s.name === name)) {
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
      async () => new SessionRecord(this.createSession()),
      task,
    );
  }

  list(): SessionInfo[] {
    return this.registry.list();
  }

  stop(name: string): Promise<boolean> {
    return this.registry.stop(name);
  }

  stopAll(): Promise<void> {
    return this.registry.stopAll();
  }
}

/**
 * Back-compat adapter for `buildServer(session)` embedders: one externally
 * owned session, presented under every name. No scheduling is added — calls
 * run exactly as they did before named sessions existed — and closing stops
 * the record's state but leaves ownership of the session with the embedder.
 */
export function singleSessionManager(session: A11ySession): SessionManager {
  const record = new SessionRecord(session);
  const createdAt = Date.now();
  let lastUsedAt = createdAt;
  return {
    async run<R>(
      _name: string,
      task: (record: SessionRecord) => Promise<R>,
    ): Promise<R> {
      lastUsedAt = Date.now();
      return task(record);
    },
    list(): SessionInfo[] {
      return [
        {
          name: DEFAULT_SESSION,
          url: session.currentUrl(),
          createdAt,
          lastUsedAt,
          busy: false,
        },
      ];
    },
    async stop(): Promise<boolean> {
      await session.close();
      record.checkpoints.clear();
      record.treeCheckpointRoot = undefined;
      return true;
    },
    async stopAll(): Promise<void> {
      await this.stop(DEFAULT_SESSION);
    },
  };
}
