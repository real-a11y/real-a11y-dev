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
  one. **A relation takes an array of page URLs, not a name**: sending
  `"Project": "CLI"` is rejected. Use the URLs below.
- **GitHub** (url) — the PR that carries the work. Fill it in when the PR opens;
  this is the only link between a ticket and the diff that closed it.
- **Due date** (date) — optional.

Current projects:

| Project                                   | Page URL (the value `Project` takes)                        |
| ----------------------------------------- | ----------------------------------------------------------- |
| CLI                                       | `https://app.notion.com/p/3a81c354b0b58044a91bc2bb592f1388` |
| Testing                                   | `https://app.notion.com/p/3bb1c354b0b581deaa9cd0f18ebb78cf` |
| Release sync — docs/npm/extension cadence | `https://app.notion.com/p/3af1c354b0b581bc9c59ee72aa19fd01` |
| Dogfood follow-ups — 0.1.0-beta.1         | `https://app.notion.com/p/3a81c354b0b5816bb2bff81fd574ca0b` |
| Phase 2: session daemon                   | `https://app.notion.com/p/3b01c354b0b581b690dbc4c790a406a6` |

Re-query them with `notion-query-data-sources` in `rows` mode against the Projects
data source rather than trusting this table after a reorganisation. Not
`notion-fetch` — on a data source that returns the **schema**, not the rows, so it
hands you no project URLs at all.

## Conventions

- **Create a ticket**: `notion-create-pages` with
  `parent: { type: "data_source_id", data_source_id: "3a81c354-b0b5-8097-ae40-000b30cf9cb9" }`
  and `properties: { Name, Status, Project: ["<project page URL>"] }`. The body
  goes in `content` as Notion-flavored Markdown — do not repeat the title in the
  body. Pass an explicit `parent`; **without one the page is created as a private
  workspace draft** nobody else can open.
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
  right columns. Prefer it for "show me the board".
- `mode: "rows"` — single data source, and the only mode with structured filters
  and sorts. Reach for it whenever you need a filtered lookup (the frontier query
  below is one), rather than pulling a whole view and post-filtering by hand.

The shared workspace usage limit applies to **single-data-source `sql`** queries
on non-Business plans, not to `rows`.

## GitHub still exists — it is not the tracker

The repo has open GitHub issues and they are not abandoned, but new work is
tracked in Notion. The `GitHub` property is a one-way bridge: ticket → PR. Do not
open a GitHub issue to represent a task, and do not assume a Notion ticket has a
GitHub counterpart.

**The exception is a bug somebody else reported.** `.github/ISSUE_TEMPLATE/` is
live, so external reports arrive as GitHub issues, and that issue is the
reporter's only window on the work. Mirror it into a Notion ticket if you want it
on the board, but the GitHub issue is what gets the reply and the close —
mirroring it and walking away leaves the reporter watching a thread nobody will
touch again.

## When a skill says "publish to the issue tracker"

Create a page in the Tasks data source.

## When a skill says "fetch the relevant ticket"

`notion-fetch` the task page URL, with `include_discussions: true`.

## Wayfinding operations

Used by `/wayfinder`. This tracker has no native blocking or sub-issue support, so
the fallback shape applies:

- **Map**: a Notion page (not a Tasks row) holding the Notes / Decisions-so-far /
  Fog body. **Give it an explicit `parent`.** The map is the one URL everyone
  watches, and a create with no parent defaults to a private workspace draft only
  its author can open — which leaves every child's `Part of <url>` pointing
  somewhere the team can't follow. Put it under the page the Tasks database lives
  on, or ask where it belongs.
- **Child ticket**: a Tasks row whose body starts with `Part of <map page URL>`.
- **Blocking**: a `Blocked by: <task URL>` line at the top of the child body. A
  ticket is unblocked when every blocker is `Done` or `Cancelled`.
- **Frontier query**: tasks in the map's project whose `Status` is `Not started`
  or `Up next` and whose blockers are all closed; first in map order wins.
- **Claim**: set `Status` to `In progress`.
- **Resolve**: comment the answer, set `Status` to `Done`, then append a context
  pointer to the map's Decisions-so-far.
