# Search, bulk actions, export and print

## Lists and search

`GET /cases` lists newest first (`created_at DESC, id DESC`) with the filters `status`, `case-template-id`, `account-id`, `reference-id`, `inquiry-id`, `report-id`, `case-queue-id`, `assignee-id`, `status-category` and `sla-state`.

`POST /cases/search` (`cases:read`, `case-search`) takes `query`, `sort` and `page`:

- `query` is an `and` / `or` / `not` tree at most two deep, 1 to 20 clauses in each `and` or `or`, with leaves `{ attribute, operator, value }`. Attributes: `template` and `case_queue` (names), `case_template_id`, `case_queue_id`, `status` (a key), `state` (the status category), `resolution`, `assignee` (a `usr_` id), `resolver` (`usr_`, `key_` or `wfr_`), `account_id` and `inquiry_id` (held), `tag_id` (a tag name), the timestamps `created_at`, `updated_at`, `resolved_at`, `sla_expires_at` (RFC 3339 with an offset; `gt`, `gte`, `lt`, `lte` apply only to them), and `fields.<searchable key>` (equality only, a string of at most 1,024 characters, a number or a boolean). `eq null` means "holds nothing" on the nullable attributes.
- A query with any `fields.*` leaf needs PII visibility, else 403 naming `pii:view`: an equality query would otherwise tell whether a masked value is held.
- Problems are a 422 whose `errors[]` carry a `search_*` code and a pointer, never the value.
- `sort` is one of the four timestamps, `asc` or `desc` (a missing timestamp sorts last), each read from an index in that order, so a page never sorts the environment's cases; `page` takes `after` or `before` (case ids, from `links.next` and `links.prev`) and a size of 1 to 100, default 10.
- It is read-after-write consistent: it runs on Postgres over plaintext columns and HMAC indexes.

## Bulk actions

`POST /cases/bulk` (202) takes `action` (`assign`, `set-status`, `set-queue`, `add-tags`, `remove-tags`), `case-ids` (at most 500) or a `search` (resolved when asked; more than 500 is `case_bulk_too_large`) and a `meta` per action; assigning needs `cases:assign`. A job applies each case through the single-case rules under the creator's visibility, with its own history rows and events, and records per case `applied`, `no_change` or `refused` with the problem's code. `GET /case-bulk-actions/:id` reads it, for its creator alone. A sweep enqueues again, every minute, an action a lost enqueue or a crashed worker left unfinished. The events of a bulk job carry its `cblk_` id, never a person, so a bulk resolution is never a person's step in a decision.

## Export

`POST /case-exports` (`cases:export`, `case-exports`, 202) takes `format` (`csv` or `json`), `include-personal-data` (needs `pii:view`) and at most one of `filter` (the list filters) or `search`; neither means every case the requester can see. The selection is decided when asked, at most 10,000 cases (`export_too_large`), and sealed as case ids. The job writes the file sealed into storage, records `exported` in each case's history and fires `case.exported` per case. A file holds at most 64 MiB: the job builds a JSON bundle case by case and stops as soon as the text passes the limit, and the export then fails with `export_too_large`. An export a lost enqueue or a stopped worker left `pending` or `running` is enqueued again by `case-export-sweep` after a minute and finished by the next job.

- **Only the creating principal** lists (`GET /case-exports`), reads and downloads an export; anyone else gets 404. Each download re-checks `cases:export`, and `pii:view` when personal data was included. A download before completion answers 404; after `expires-at` (24 hours) 410, and the sweep deletes the file.
- **CSV:** one row per case: id, name, template, status, category, resolution, queue, assignee id, created, assigned, resolved, SLA state, `sla-expires-at`, tags, and each held kind's ids in one space-separated cell; `fields` only with personal data. Comments are never in a CSV. Every cell is quoted, and a cell starting with `=`, `+`, `-`, `@`, a tab, a carriage return or a line feed (or their full-width forms) gets a leading apostrophe. No escaping is safe in every spreadsheet program, as OWASP warns: open an export as data, never as a workbook to trust.
- **JSON:** per case, the case as the API serves it, its history, its comments and the held objects' ids and types, masked as the requester reads them; without personal data, fields, messages and filenames are null.
- Redacted content reads `redacted`, never an empty value. The audit entries record the filter's shape (attribute names, operators, `"[value]"` for values) and the counts, never a value.
- An export is not redacted with its cases: its file is gone after 24 hours.

## Print

The console prints a case with the browser (a server-made PDF and its fonts wait for Phase 9). `POST /cases/:id/print` (`cases:read`) is called first: it writes the audit entry and a `print-initiated` history row, fires `case.print-initiated`, and answers the case.
