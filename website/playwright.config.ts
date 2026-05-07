import { defineConfig } from "@playwright/test";

// VitePress preview is single-process so we don't need workers > 1.
// `webServer` boots `vitepress preview` on demand; the build is expected
// to have already happened (CI does it as a separate step).
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : "list",
  // Drop the default `-{platform}` suffix from snapshot file names. The
  // `auditSnapshot()` output is platform-stable (same Chromium, identical
  // tree shape — theme/contrast/font-rendering don't enter the tree),
  // so committing one baseline per shape works on every contributor OS.
  snapshotPathTemplate: "{testFileDir}/{testFileName}-snapshots/{arg}{ext}",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm exec vitepress preview --port 5173",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
  },
});
