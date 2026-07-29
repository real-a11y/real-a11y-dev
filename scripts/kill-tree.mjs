// Tear down a spawned dev/preview server and anything it started.
//
// One implementation, because there is nothing site-specific about it and two
// copies drift: the weaker one is always the one you find out about, from a
// port that is still held.
//
// The hard part is the grandchild. A server spawned as `pnpm exec vite …` or
// `pnpm exec vitepress preview` is a wrapper whose actual server is a child of
// the child, and `child.kill()` signals only the wrapper. Modern pnpm forwards
// signals, so this usually works anyway — "usually" being the problem, since
// the failure is a surviving server that the next run then audits by mistake.
//
// So: signal the whole process GROUP where we can, and fall back to the direct
// kill where we can't.
//
// - POSIX, child spawned `detached: true` — the child leads its own group, and
//   `process.kill(-pid)` reaches every process in it. This is the reliable path.
// - POSIX, child not detached — the negative pid is not a group we own, so the
//   call throws and we fall through to signalling the child directly. Same
//   behavior as before this was shared.
// - Windows — no process groups in this sense; `taskkill /t /f` walks the tree.
//   `child.kill` uses TerminateProcess, which does not cascade but does end the
//   parent, so it stays as the fallback.
//
// SIGKILL follows SIGTERM after a grace period on POSIX: a server that ignores
// or is too slow to handle the polite signal still goes away, and the timer is
// `unref`'d so it never holds the process open on its own.

import { spawn } from "node:child_process";

const GRACE_MS = 2_000;

export function killTree(child) {
  if (!child?.pid) return;

  if (process.platform === "win32") {
    try {
      const tk = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
      });
      tk.on("error", () => {});
    } catch {
      /* ignore — the direct kill below is the fallback */
    }
    child.kill();
    return;
  }

  const signalGroup = (signal) => {
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch {
      return false;
    }
  };

  if (!signalGroup("SIGTERM")) child.kill("SIGTERM");
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      if (!signalGroup("SIGKILL")) child.kill("SIGKILL");
    }
  }, GRACE_MS).unref();
}
