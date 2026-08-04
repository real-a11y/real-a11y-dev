---
id: R8
suite: regression
scenario: "MCP server starts from the packed bin and advertises the full, correct tool set"
area: MCP
type: Automated
priority: P0
status: Active
validFrom: "mcp ≥ 0.1.0-beta.1. Expected list: 20 from mcp 0.1.0-beta.2 (act tools); 19 from the producer migration (#258), which removed `compare_producers` and kept `get_tab_order`; **20** since named sessions added `list_sessions`."
validUntil: ""
expected: "tools/list returns EXACTLY the documented set — assert the sorted list of names, not just the count, so a rename or a swap can't pass. Each entry has a description + inputSchema. Cross-check against the count stated in packages/mcp/README.md and website/packages/mcp/tools.md; a mismatch there is itself the bug."
twin: D4
covers:
  - packages.@real-a11y-dev/mcp
notion: "https://app.notion.com/p/3aa1c354b0b581d6a60ffd9647732fbf"
---

## Steps

Drive the **packed** bin — `npm pack` the package and start the server from the
tarball install, not from `packages/mcp/dist`. A workspace build resolves
differently and hides packaging faults.

1. Start the server over stdio; confirm it handshakes
2. `tools/list`
3. Sort the returned names and compare to the documented set
4. Check each entry has a non-empty `description` **and** an `inputSchema`
5. Cross-check the count stated in `packages/mcp/README.md` and
   `website/packages/mcp/tools.md`
6. Read the server `instructions` string
7. Call a tool before `open_page`

## Expected

- **3** — the sorted list matches **exactly**: no extra, no missing, no renamed.
  Assert the _list_, not the count
- **4** — a tool with no description is invisible to an agent, which is the same as
  not shipping it
- **5** — docs and reality agree. A mismatch there is itself the bug: the count is
  the number a user trusts before installing
- **6** — the instructions name the working loop (`open_page` first;
  `checkpoint_tree` → act → `diff_tree`) and the session semantics: named
  sessions are opt-in via the `session` parameter, calls within one session
  serialize automatically, and different sessions may run in parallel
- **7** — a clear error telling the agent to `open_page` first

## Why this exists

Previously asserted "exactly the 18 expected names" and was wrong from the moment
the act tools landed — then 20, then 19 after the producer migration, and **20 today** (named sessions added `list_sessions`).

The reason this asserts the **list** rather than the count is not pedantry, and the
migration proved it twice over. This row predicted `get_tab_order` and
`compare_producers` would both go, taking 20 back to "18 again — a different 18".
Only `compare_producers` went: `get_tab_order` survives as the only source of
tab-order sequence. A count-only check would have been wrong about the number _and_
silent about which tool actually left. The list is the assertion; the count in the
docs is a separate claim, cross-checked at step 5 because it is what a user reads
before installing.

## Notes

Was "18" — wrong since the act tools landed (#239), then 20, then 19. **20 today**
(mcp ≥ 0.1.0-beta.3). The producer migration (#258) dropped `compare_producers`
only; `get_tab_order` was predicted to go with it and did not — it is the sole
source of tab-order sequence. So this row's own reasoning was right and its
arithmetic wrong, which is the argument for asserting the list: the prediction
"20 → 18" would have failed a count check _and_ the wrong tool would have been
blamed.

**On `covers:`** — like R7, this row is deliberately not listed as covering each
individual tool. It asserts that the tool *list* is correct, not that any tool
works; `mcp.tools.*` coverage belongs to the rows that actually call them (R9,
R10, R25).
