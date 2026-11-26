# Exports and saved views

An export cuts one CSV file of a list (inquiries, verifications, accounts, reports, a list's items or
transactions) under that list's own filters, or under a saved view. This page covers C165 and C166.1
to C166.4 and C166.6 of [the Phase 9 plan](../plans/phase-9.plan.md) as built in Workflow 9B
(`api-exports`) and shown in the console in Workflow 9C (`dashboard-analytics`). Bulk report
creation, the other half of C166, is on [its own page](../reports/bulk.md). Case exports are Phase
8's and have [their own page](../cases/export.md). Routes are under `/api/v1`.

- [The API](#the-api)
- [The columns of each object type](#the-columns-of-each-object-type)
- [How a cell is written](#how-a-cell-is-written)
- [Redaction and the 24 hours](#redaction-and-the-24-hours)
- [Saved views](#saved-views)
- [In the console](#in-the-console)

## The API

| Route                       | What it does                                                                                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /exports`             | Asks for an export (202). The job runs in the worker.                                                                                                                                  |
| `GET /exports`              | The caller's own exports, newest first, of the types the caller still holds `:export` for; `filter[status]`, `filter[object-type]`.                                                    |
| `GET /exports/:id`          | One export. Another principal's export is 404, as if it did not exist; a type permission the caller lost is 403.                                                                       |
| `GET /exports/:id/download` | The file, `text/csv`, as an attachment named `export-<type>-<id>.csv`, `private, no-store`. 404 before the file is cut, 410 once it expired, 403 for personal data without `pii:view`. |

```json
{
  "data": {
    "type": "export",
    "attributes": {
      "object-type": "inquiries",
      "format": "csv",
      "filter": {
        "filter[status]": "completed",
        "filter[created-at-start]": "2026-11-01T00:00:00Z"
      },
      "include-personal-data": false
    }
  }
}
```

- **What it exports.** `filter` takes the list route's own filters, checked by that route's query
  schema (a filter the list does not take is 400 at `/data/attributes/filter/<key>`), or
  `saved-view-id` names a saved view; never both, and never neither, so no request exports a whole
  list by accident. Verifications need `filter[type]` and lists need `filter[list-id]`, unless the
  saved view supplies them. The format is `csv` only.
- **Permissions.** Each object type has its own permission, held by `admin` alone by default (none is
  a `:read`, so viewers never hold one): `inquiries:export`, `verifications:export`,
  `accounts:export`, `reports:export`, `lists:export` and `transactions:export`
  (`EXPORT_PERMISSIONS` in `@openverify/core`). `include-personal-data` needs `pii:view`, and so do
  the filters that read personal data: `filter[next-step-name]`, a transaction's string field and
  `filter[identifier]` (each 403 otherwise).
- **Who sees it.** Only the principal that asked for an export lists, reads and downloads it. Every
  read and download checks the type permission again, and a download of a file with personal data
  checks `pii:view` again.
- **Limits** (ours, provisional): at most 50,000 rows (`EXPORT_LIMITS`) and 64 MiB (the job's
  `EXPORT_BYTE_LIMIT`). A larger export
  fails with `export_too_large`; it is never cut short. The `exports` policy allows 10 exports an hour
  per environment.
- **A saved view** must be the caller's own or shared (else 404) and of the same list (else 422).
- **A list** must have an importer; a list kind without one (face, selfie background) is 422
  `export_list_kind_refused` at `/data/attributes/filter/filter[list-id]` (Workflow 9D, K9-29).
- **What the export records** (`exportAttributesSchema`): `status` (`pending`, `running`,
  `completed`, `failed`, `expired`), `filter-keys` (the filter's keys, never a value), `saved-view-id`,
  `include-personal-data`, `row-count`, `byte-size` (while the file is kept), `error-code` (only on a
  failure: `export_too_large`, else `export_failed`), `created-at`, `cut-at` (when the rows were
  read: the file is the list at that moment), `completed-at` and `expires-at`. The CSV itself stays
  plain: these facts are on the resource, beside the download.
- **Audit.** `export.created` records the object type, the format, whether personal data was asked
  for, the filter's keys and the saved view; `export.downloaded` records each download. No filter
  value is audited, and the filter is masked in the API logs (`PII_EXPORT_ATTRIBUTES`).
- **An API key's blocklist.** An export a key asks for leaves out the columns the key's attribute
  blocklist names, and every column under them; `id` always stays
  ([API keys](../settings/api-keys.md)).

## The columns of each object type

The documented columns, in the order the file holds them (`EXPORT_CSV_COLUMNS` in
`packages/contracts/src/exports.ts`). A column marked \* holds personal data and is masked unless the
export includes personal data (below).

| Object type     | Permission             | Columns                                                                                                                                                                                                                                             |
| --------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inquiries`     | `inquiries:export`     | `id`, `status`, `reference-id`\*, `inquiry-template-id`, `inquiry-template-version-id`, `account-id`, `tags`, `next-step-name`\*, `created-at`, `started-at`, `completed-at`, `failed-at`, `expired-at`, `decisioned-at`, `redacted-at`, `fields`\* |
| `verifications` | `verifications:export` | `id`, `type`, `status`, `inquiry-id`, `country`, `id-class`, `checks`, `created-at`, `submitted-at`, `completed-at`, `redacted-at`, `extracted-fields`\*                                                                                            |
| `accounts`      | `accounts:export`      | `id`, `account-type-id`, `status`, `reference-id`\*, `tags`, `created-at`, `updated-at`, `redacted-at`, `fields`\*                                                                                                                                  |
| `reports`       | `reports:export`       | `id`, `type`, `status`, `report-template-id`, `inquiry-id`, `account-id`, `reference-id`\*, `has-match`, `created-at`, `redacted-at`, `query`\*                                                                                                     |
| `transactions`  | `transactions:export`  | `id`, `transaction-type-id`, `transaction-type-version-id`, `status`, `reference-id`\*, `created-at`, `updated-at`, `redacted-at`, `fields`\*                                                                                                       |
| `lists`         | `lists:export`         | the list kind's import columns (below)                                                                                                                                                                                                              |

- **A list's items** are written under exactly the columns the list importer reads for that kind
  ([the columns per kind](../lists/importers.md#columns)), so the file imports again unchanged;
  `EXPORT_CSV_COLUMNS` therefore holds no fixed columns for lists, and a test holds every importer
  kind to its import columns (Workflow 9D, K9-29). Pending and redacted items hold no value and are left out. A list item's value is
  third-party personal data, so every cell is empty unless the export includes personal data.
- **A report's** `type` is the public `report/<type>`, its `reference-id` is its account's, and its
  `query` is the report's query as one JSON cell.
- **A verification's** `type` is the public spelling (`government-id`); `checks` lists each check that
  ran as `<check>:<status>`, separated by spaces, in check name order; `extracted-fields` holds a
  government ID's extraction as one JSON cell and is empty for the other types.
- **`fields`** (inquiries, accounts, transactions) is one JSON cell. A transaction's `file` field is
  its id and name as the API serves it, never its content.
- **Times** are ISO 8601 in UTC; an empty cell is a time that has not happened. `tags` are separated by
  spaces.
- **Never in a file** (Phase 8 C138.4): secrets, tokens, storage keys, wrapped keys, face templates,
  embeddings, raw fingerprints, EXIF, and other environments' data.

## How a cell is written

- **Masked.** Without personal data, a personal value column is empty, and a JSON column (`fields`,
  `query`, `extracted-fields`) keeps its keys with every value `null` (a transaction field as
  `{ type, value: null }`), as the API masks a reader without `pii:view`.
- **Redacted.** A redacted object's personal columns, and its `tags`, read `redacted`, never an empty
  cell, so a redaction is never mistaken for a value nobody entered.
- **The rows** are the list's, in the list's own order (`created-at` descending, then id), under the
  list's own filters: the inquiry and transaction lists through their filter hooks, the others
  through the options their routes read.
- **The CSV** goes through Phase 7's writer (`writeCsv` in `@openverify/checks`): a header row, every
  cell quoted, embedded quotes doubled, CRLF after every record, the last one too. A cell that starts
  with `=`, `+`, `-`, `@`, a tab, CR, LF or their full-width forms gets a leading `'`, so a spreadsheet
  does not run it as a formula. No escape is safe in every spreadsheet: a file saved and opened again
  can lose the quotes.

## Redaction and the 24 hours

The file is sealed in storage and **kept 24 hours after it completed** (`EXPORT_LIMITS`), then
deleted by `export-sweep` (every 60 seconds) and the retention pass; the export then reads `expired`
and keeps its count and times, and a download answers 410.

**An export cut before a redaction keeps that person's data until the file is deleted, at most 24
hours later.** A redaction does not reach a file that was already cut (review P36). The console's
exports page says so beside the list of exports.

## Saved views

A saved view (`svw_`, ours) is a named set of filters on one list, kept on the dashboard API for users
(`GET`, `POST`, `PATCH /:id` and `DELETE /:id` on `/api/v1/dashboard/saved-views`; a session and the
list's read permission). The lists are inquiries, accounts, reports, cases, transactions, API logs,
webhook deliveries, events and audit logs (`SAVED_VIEW_LISTS`).

- **No personal data in a view.** A filter key the list marks as personal data is refused with 422
  `saved_view_pii_filter`; any string field of any transaction type version counts as one. An audit
  log view cannot hold `filter[ip]`.
- **Shared views.** A view may be shared with every user of the environment who can read its list.
  Only its owner changes or deletes it (another owner's view is 403); a shared view is copied to be
  changed.
- **Views that no longer fit.** A view whose filters its list no longer accepts says so
  (`filters-valid: false` with the keys in `invalid-filters`) instead of widening silently.
- **Exports.** An export of a saved view (`saved-view-id`) reads the view's filters; the export
  records the view's id and the filter's keys, never a value.
- `GET` answers the caller's own views and the shared views of the lists it can read, oldest first,
  unpaged.

## In the console

- **`/exports`** (shown to a holder of any of the six `:export` permissions; the others see which
  permissions export) has a new-export form per type the operator holds, with that type's filters:
  a verification type (required) for verifications, a list id (required) for lists, a status for
  inquiries, and a created range in UTC days for every type but lists (both days included: the end
  is sent as the next midnight).
  Personal data is offered only with `pii:view`, after a confirmation. A saved view is exported by
  its id, chosen on its list page (the export page opens as `/exports?view=svw_…&type=…`), so no
  filter value travels in a URL.
- **The exports list** shows each export's type, status, row count with what its filter named (or
  the failure in words), whether it holds personal data, its cut time and how long its file is kept;
  the page says beside it that an export cut before a redaction keeps that person's data for up to 24
  hours. The download goes through the
  console's own route (`/exports/[id]/download`), which never stores the file.
- **Saved views** are offered on all nine lists through one slot on each list page
  (`components/saved-views/`). The slot reads the views through the console route
  `GET /exports/saved-views?list=<list>`, which sends only the list's name. A view whose filters the
  page cannot show is not applied, so a list is never wider than its view; a page parameter the view
  cannot keep is named as not kept when it is saved.

The console's pages are described in [the dashboard README](../../apps/dashboard/README.md#analytics-saved-views-and-exports-c1649-c165-c166).
