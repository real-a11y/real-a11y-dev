---
"@real-a11y-dev/cli": minor
"@real-a11y-dev/testing": patch
---

Add `real-a11y show-report`, which opens the snapshot report of your tests in the browser and keeps it current. The page redraws as tests write new snapshots, so it follows a watch-mode run in another terminal without a reload:

```sh
npx vitest --watch          # in one terminal
npx real-a11y show-report   # in another
```

It reads the records `@real-a11y-dev/testing/reporter` writes (`./a11y-snapshots`, or the folder you name), runs no tests itself, and serves the page on `127.0.0.1` only. `--port` picks the port and `--no-open` leaves the browser closed.

`@real-a11y-dev/testing` re-releases the bundled snapshot viewer, which now tells you when records come from a different release. The page the reporters write behaves as before.
