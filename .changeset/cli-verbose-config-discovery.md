---
"@real-a11y-dev/cli": minor
---

feat(cli): --verbose says where the config came from

Config auto-discovery stats `./a11y.config.json` in the directory you run from and
nowhere else — no upward walk, which is deliberate for v1. The consequence is a
quiet one: run from a subdirectory and you get no config, every default reverts to
its built-in, and nothing says so. The config is right there on disk, so the
natural conclusion is that config defaults don't work.

`--verbose` now prints one line before anything depends on it:

```
config: /work/app/a11y.config.json (auto-discovered)
config: /work/app/custom.json (from --config)
config: skipped (--no-config); built-in defaults only
config: none found — looked for /work/app/nested/a11y.config.json
  auto-discovery checks the directory you run from and does not walk upward, so a
  config in a parent directory is not picked up. Pass --config <file> to name one.
```

Paths are absolute deliberately. The failure this exists for is a config that is
real but not where the command ran from, and `a11y.config.json` is what the user
already believes they have — a relative path would add nothing.

The `none found` line carries three things because each answers a different
question: which path was checked, why checking elsewhere won't help, and what to
do instead. Knowing the path alone doesn't tell you that no other path ever will
be searched.

Behaviour is unchanged without `--verbose`, and discovery itself is untouched — an
upward walk to the git root would change documented behaviour and is a separate
call.
