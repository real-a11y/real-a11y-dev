/**
 * Windows token-file ACL tightening, shared by the daemon entrypoint, the
 * CLI-side spawner, and the test helper — its own module so `client.ts` can
 * use it without importing `spawn.ts` (which imports `client.ts`).
 */

import { execFile } from "node:child_process";
import { platform, userInfo } from "node:os";

import { CliError } from "../exit.js";

/**
 * On Windows, `chmod` is a no-op, so the auth token would rely on the profile
 * directory's inherited ACL. Set an explicit DACL on the token file so only the
 * current user can read it. This is not best-effort: a failure means the token
 * is potentially readable by other local users, which would let any process that
 * can read the token issue commands against the reused browser session.
 */
export async function tightenWindowsTokenAcl(tokenFile: string): Promise<void> {
  if (platform() !== "win32") return;

  const resolveUser = (): Promise<string | undefined> =>
    new Promise((resolve) => {
      execFile("whoami", (err, stdout) => {
        if (err) {
          try {
            resolve(userInfo().username);
          } catch {
            resolve(undefined);
          }
          return;
        }
        resolve(stdout.trim() || undefined);
      });
    });

  const user = await resolveUser();
  if (!user) {
    throw new CliError(
      "could not determine current Windows user for token-file ACL",
      "run from an interactive session or set USERNAME",
    );
  }

  await new Promise<void>((resolve, reject) => {
    execFile(
      "icacls",
      [tokenFile, "/inheritance:r", `/grant:r`, `${user}:F`, "/Q"],
      (err) => {
        if (err) {
          reject(
            new CliError(
              `could not tighten token file ACL (${err.message}); other local users may be able to read the session auth token`,
              "ensure icacls is available and you have permission to modify the token file",
            ),
          );
          return;
        }
        resolve();
      },
    );
  });
}
