/**
 * Daemon handshake predicates: whether a connection failure means a stale
 * socket, and whether a running daemon can be reused by this CLI.
 */

import { CLI_VERSION } from "../version.js";

import { DaemonTimeoutError, DaemonTransportError } from "./client.js";
import { DAEMON_PROTOCOL_VERSION } from "./protocol.js";

export interface VersionInfo {
  daemonVersion: string;
  protocolVersion: string;
  sessionCount: number;
  shuttingDown?: boolean;
}

export function isStaleConnectionError(err: unknown): boolean {
  // A timeout means the daemon is alive but slow; don't treat it as a stale
  // socket we can safely unlink.
  if (err instanceof DaemonTimeoutError) return false;
  if (err instanceof DaemonTransportError) return true;
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ECONNREFUSED" || code === "ENOENT") return true;
  return /ECONNREFUSED|ENOENT/.test(err.message);
}

export function isVersionCompatible(version: VersionInfo): boolean {
  // A daemon that is already shutting down is not a candidate for reuse; the
  // client should wait for it to exit and then respawn.
  if (version.shuttingDown) return false;
  const protocolOk = version.protocolVersion === DAEMON_PROTOCOL_VERSION;
  // A "0.0.0" version (fallback when package.json cannot be located) should not
  // force endless respawns; treat it as a wildcard.
  const daemonVersion =
    version.daemonVersion === "0.0.0" ? CLI_VERSION : version.daemonVersion;
  return protocolOk && daemonVersion === CLI_VERSION;
}
