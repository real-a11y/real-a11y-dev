# Issue tracker: Notion (Tasks database)

Issues, tickets and specs for this repo live in the **Tasks** database in Notion,
not in GitHub Issues. Use the Notion MCP tools (`notion-*`) for all operations.

|                        |                                                                    |
| ---------------------- | ------------------------------------------------------------------ |
| Database               | [Tasks](https://app.notion.com/p/3a81c354b0b5809aa75cccf9ad8cd984) |
| Data source            | `collection://3a81c354-b0b5-8097-ae40-000b30cf9cb9`                |
| Board view (by status) | `view://3a81c354-b0b5-803a-80d1-000c6da8f70e`                      |
| Table view (all tasks) | `view://3a81c354-b0b5-80a0-ba9a-000cdfe84daa`                      |
| Default page template  | `3a81c354-b0b5-8037-a23a-cad428be5eb8` ("New task")                |

## Schema

- **Name** (title) — the ticket title.
- **Status** (status) — `Not started`, `Up next`, `In progress`, `In review`,
  `Cancelled`, `Done`.
- **Triage** (select) — the five triage roles. See `./triage-labels.md`.
- **Project** (relation → Projects,
  `collection://3a81c354-b0b5-80ca-9fa9-000b60120b45`) — every task should name
  one.
- **GitHub** (url) — the PR that carries the work. Fill it in when the PR opens;
  this is the only link between a ticket and the diff that closed it.
- **Due date** (date) — optional.

Current projects: `CLI`, `Testing`, `Release sync — docs/npm/extension cadence`,
`Dogfood follow-ups — 0.1.0-beta.1`, `Phase 2: session daemon`.

## Conventions

- **Create a ticket**: `notion-create-pages` with
  `parent: { type: "data_source_id", data_source_id: "3a81c354-b0b5-8097-ae40-000b30cf9cb9" }`
  and `properties: { Name, Status, Project }`. The body goes in `content` as
  Notion-flavored Markdown — do not repeat the title in the body.
- **Read a ticket**: `notion-fetch` on the page URL, with
  `include_discussions: true` when comments matter, then `notion-get-comments`.
- **List tickets**: `notion-query-data-sources` with `mode: "view"` against one of
  the view URLs above.
- **Update status / link a PR**: `notion-update-page` with
  `command: "update_properties"`.
- **Comment**: `notion-create-comment` on the page.
- **Close**: set `Status` to `Done`, or `Cancelled` when it will not be actioned.
  There is no separate archive step.

### Listing: do not reach for multi-data-source SQL

`notion-query-data-sources` in `sql` mode across **more than one** data source
requires a Notion Business plan and fails on this workspace. Use:

- `mode: "view"` — unmetered on every plan, and the views above already carry the
  right columns. Prefer this.
- `mode: "rows"` — single data source only, and draws on a shared workspace quota.
  Use it when you need a structured filter a view doesn't express.

## GitHub still exists — it is not the tracker

The repo has open GitHub issues and they are not abandoned, but new work is
tracked in Notion. The `GitHub` property is a one-way bridge: ticket → PR. Do not
open a GitHub issue to represent a task, and do not assume a Notion ticket has a
GitHub counterpart.

## When a skill says "publish to the issue tracker"

Create a page in the Tasks data source.

## When a skill says "fetch the relevant ticket"

`notion-fetch` the task page URL, with `include_discussions: true`.

## Wayfinding operations

Used by `/wayfinder`. This tracker has no native blocking or sub-issue support, so
the fallback shape applies:

- **Map**: a Notion page (not a Tasks row) holding the Notes / Decisions-so-far /
  Fog body.
- **Child ticket**: a Tasks row whose body starts with `Part of <map page URL>`.
- **Blocking**: a `Blocked by: <task URL>` line at the top of the child body. A
  ticket is unblocked when every blocker is `Done` or `Cancelled`.
- **Frontier query**: tasks in the map's project whose `Status` is `Not started`
  or `Up next` and whose blockers are all closed; first in map order wins.
- **Claim**: set `Status` to `In progress`.
- **Resolve**: comment the answer, set `Status` to `Done`, then append a context
  pointer to the map's Decisions-so-far.
