/**
 * Best-effort process start time, used to tell a live daemon from a recycled
 * PID. Each platform has its own source (`/proc`, `ps`, PowerShell) and
 * fallbacks; `undefined` means the start time could not be determined.
 */

import { execFileSync, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { stat } from "node:fs/promises";

export async function processStartTimeMs(
  pid: number,
): Promise<number | undefined> {
  if (process.platform === "win32") return processStartTimeMsWindows(pid);
  if (process.platform === "darwin") return processStartTimeMsDarwin(pid);
  return processStartTimeMsLinux(pid);
}

async function processStartTimeMsLinux(
  pid: number,
): Promise<number | undefined> {
  try {
    // Parse /proc/<pid>/stat for starttime (field 22, in clock ticks since boot).
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const closeParen = stat.lastIndexOf(")");
    if (closeParen === -1) return undefined;
    const after = stat.slice(closeParen + 1).trim();
    const fields = after.split(/\s+/);
    if (fields.length < 22) return undefined;
    const starttimeTicks = Number(fields[19]);
    if (!Number.isFinite(starttimeTicks)) return undefined;

    const bootTimeSec = getBootTimeSec();
    const clockTick = getClockTick();
    if (bootTimeSec !== undefined && clockTick !== undefined) {
      return Math.round((bootTimeSec + starttimeTicks / clockTick) * 1000);
    }
  } catch {
    // Fall through to the filesystem/ps fallbacks below.
  }

  // Fallback 1: /proc/<pid> is created when the process starts, so its ctime
  // is a reliable proxy even when /proc/stat btime or CLK_TCK are unavailable.
  try {
    const st = await stat(`/proc/${pid}`);
    if (st.ctimeMs) return st.ctimeMs;
  } catch {
    // ignore
  }

  // Fallback 2: `ps` may still work in restricted containers.
  try {
    const out = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 2000,
    }).trim();
    const ms = new Date(out).getTime();
    if (!Number.isNaN(ms)) return ms;
  } catch {
    // ignore
  }

  // Fallback 3: `ps -o etime=` gives elapsed time, from which we can compute
  // an approximate start time. This is less precise but works when lstart is
  // unavailable.
  const elapsed = psElapsedMs(pid);
  if (elapsed !== undefined) return Date.now() - elapsed;

  return undefined;
}

function psElapsedMs(pid: number): number | undefined {
  try {
    const out = execFileSync("ps", ["-o", "etime=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 2000,
    }).trim();
    return parseEtime(out);
  } catch {
    return undefined;
  }
}

function parseEtime(etime: string): number | undefined {
  const m = etime.trim().match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!m) return undefined;
  const days = Number(m[1] || 0);
  const hours = m[2] ? Number(m[2]) : 0;
  const minutes = Number(m[3]);
  const seconds = Number(m[4]);
  if (
    Number.isNaN(days) ||
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    Number.isNaN(seconds)
  ) {
    return undefined;
  }
  return (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
}

function getBootTimeSec(): number | undefined {
  try {
    const stat = readFileSync("/proc/stat", "utf8");
    const line = stat.split("\n").find((l) => l.startsWith("btime "));
    if (!line) return undefined;
    const sec = Number(line.split(/\s+/)[1]);
    return Number.isFinite(sec) ? sec : undefined;
  } catch {
    return undefined;
  }
}

function getClockTick(): number | undefined {
  try {
    const out = execSync("getconf CLK_TCK", { encoding: "utf8" }).trim();
    const tick = Number(out);
    return Number.isFinite(tick) && tick > 0 ? tick : undefined;
  } catch {
    return 100;
  }
}

function processStartTimeMsDarwin(pid: number): number | undefined {
  try {
    const out = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 2000,
    }).trim();
    const ms = new Date(out).getTime();
    if (!Number.isNaN(ms)) return ms;
  } catch {
    // ignore
  }

  // Fallback to elapsed time when start time is unavailable.
  const elapsed = psElapsedMs(pid);
  if (elapsed !== undefined) return Date.now() - elapsed;

  return undefined;
}

function processStartTimeMsWindows(pid: number): number | undefined {
  try {
    const pidStr = String(pid);
    const command =
      `(Get-Process -Id ${pidStr} -ErrorAction SilentlyContinue)` +
      ".StartTime.ToUniversalTime().ToString('yyyyMMddHHmmssfff')";
    const out = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-Command", command],
      { encoding: "utf8", timeout: 3000 },
    ).trim();
    if (/^\d{17}$/.test(out)) {
      const y = Number(out.slice(0, 4));
      const mo = Number(out.slice(4, 6)) - 1;
      const d = Number(out.slice(6, 8));
      const h = Number(out.slice(8, 10));
      const mi = Number(out.slice(10, 12));
      const s = Number(out.slice(12, 14));
      const ms = Number(out.slice(14, 17));
      return Date.UTC(y, mo, d, h, mi, s, ms);
    }
  } catch {
    // ignore
  }
  return undefined;
}
