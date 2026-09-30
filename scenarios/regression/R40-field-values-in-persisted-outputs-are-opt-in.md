---
id: R40
suite: regression
scenario: "Field values in persisted outputs are opt-in — CLI snapshot --values, MCP checkpoint_findings / export_checkpoint values"
area: CLI
type: Automated
priority: P1
status: Active
validFrom: "cli ≥ 0.1.0-beta.7 · mcp ≥ 0.1.0-beta.7 (unreleased)"
validUntil: ""
expected: "A snapshot artifact and an exported MCP checkpoint carry no field value by default, though the live tree of the same page shows them. snapshot --values (or defaults.values) puts them in the tree view and records meta.values: true; a password still reads [redacted]. export_checkpoint refuses a checkpoint captured with values unless it too is passed values: true. diff warns when only one side carries values. --redact-input / REAL_A11Y_REDACT_INPUT=1 beat the opt-in."
covers:
  - cli.commands.snapshot.flags.--values
  - cli.commands.snapshot.flags.--redact-input
  - mcp.tools.checkpoint_findings.params.values
  - mcp.tools.export_checkpoint.params.values
notion: ""
---

## Steps

Use a page with a filled plain field and a filled password field, set at runtime
from split string literals so neither value is in the URL:

```html
<label>Email <input id="email" type="email"></label>
<label>Password <input id="pw" type="password"></label>
<script>
  document.getElementById("email").value = "VALUE-" + "email@example.com";
  document.getElementById("pw").value = "PW-" + "SENTINEL";
</script>
```

1. `real-a11y tree <url>` — the live view, for contrast
2. `real-a11y snapshot <url> -o plain.json`
3. `real-a11y snapshot <url> --values -o values.json`
4. `real-a11y diff plain.json values.json`
5. `real-a11y snapshot <url> --values --redact-input -o strict.json`
6. With an `a11y.config.json` of `{ "defaults": { "values": true } }`:
   `real-a11y snapshot <url> -o configured.json`
7. MCP: `open_page` → `checkpoint_findings { name: "a" }` → `export_checkpoint { name: "a" }`
8. MCP: `checkpoint_findings { name: "b", values: true }` → `export_checkpoint { name: "b" }`,
   then `export_checkpoint { name: "b", values: true }`
9. MCP, a server started with `REAL_A11Y_REDACT_INPUT=1`:
   `checkpoint_findings { name: "c", values: true }` → `export_checkpoint { name: "c", values: true }`

## Expected

- **1** — `textbox "Email" = "VALUE-email@example.com"` and
  `textbox "Password" = "[redacted]"`: the live view shows values
- **2** — `plain.json` has no `VALUE-email` anywhere, no `meta.values`, and its tree
  reads `textbox "Email"` bare — byte-for-byte the shape of an artifact written before
  values existed
- **3** — `values.json` has `"values": true` in `meta` and a tree line
  `textbox "Email" = "VALUE-email@example.com"`; the password line reads
  `= "[redacted]"`. `PW-SENTINEL` and `•` appear nowhere
- **4** — stderr warns that only the PR snapshot carries field values; the exit code
  is unaffected (findings carry no values)
- **5** — no value in `strict.json`, and no `meta.values`: strict mode wins
- **6** — `configured.json` carries values, as in (3)
- **7** — the exported artifact has no `VALUE-email`
- **8** — the first export is an error that names `values: true` and quotes no value;
  the second returns an artifact with `meta.values: true` and the email's value
- **9** — the export succeeds and carries no value

## Why this exists

ADR-0001 split outputs in two. **Live** reads (a terminal, an agent's context) show
field values, because a screen reader announces them and the act loop needs to see
that a `type` landed. **Persisted** outputs — artifacts, baselines, PR comments,
exported checkpoints — get committed and posted, so they leave values out unless a
run asks. The two paths share a producer and a serializer, and a single wrong
default would move a page's form contents into a git history or a public PR comment
with nothing on screen to say so.

The MCP export takes a second opt-in on purpose: `values: true` on a checkpoint is
for diffing in-session, which is not the same decision as writing the values into a
file an agent may paste anywhere.

## Notes

Added with the field-values change (ADR-0001, PR B). Artifacts written before it
have no `meta.values` and read as carrying none, which is what they are.
