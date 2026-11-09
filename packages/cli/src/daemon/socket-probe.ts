/**
 * Is a daemon actually listening on a socket path? A leaf module (no daemon
 * imports) so both the client and session probes can use it without a cycle.
 */

import { createConnection } from "node:net";

export async function isSocketPresent(
  socketPath: string,
  timeoutMs = 500,
): Promise<boolean> {
  // A leftover socket file from a crashed daemon is not "present" in the sense
  // we care about; only report it if a daemon is actually listening.
  return new Promise((resolve) => {
    const socket = createConnection(socketPath);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(false);
    }, timeoutMs);

    socket.on("connect", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.end();
      resolve(true);
    });
    socket.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(false);
    });
  });
}
