# Triage Labels

The skills speak in terms of five canonical triage roles. This tracker is a Notion
database, which has no labels — so the roles live as options on a **`Triage`
select property** on the Tasks data source
(`collection://3a81c354-b0b5-8097-ae40-000b30cf9cb9`).

| Label in mattpocock/skills | Option in our tracker | Meaning                                  |
| -------------------------- | --------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`        | Maintainer needs to evaluate this ticket |
| `needs-info`               | `needs-info`          | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`     | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`     | Requires human implementation            |
| `wontfix`                  | `wontfix`             | Will not be actioned                     |

Apply one with `notion-update-page`, `command: "update_properties"`, e.g.
`{ "Triage": "ready-for-agent" }`. Clear it with `null`.

## `Triage` is a different axis from `Status`

`Status` (`Not started` → `Up next` → `In progress` → `In review` → `Done` /
`Cancelled`) tracks where the work **is**. `Triage` tracks whether it is **ready
to be picked up, and by whom**. Don't collapse them — a ticket can be
`Not started` + `ready-for-agent` (an agent may start it now) or `Not started` +
`needs-info` (nobody can).

The one place they overlap: a ticket marked `wontfix` should also be moved to
`Status: Cancelled`, so it leaves the board.
