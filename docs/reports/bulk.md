# Creating reports in bulk

`POST /api/v1/reports/bulk` creates up to 1,000 reports of one report template from a CSV file, one
report per row, and records what happened to every row. This page covers C166.5 and C166.6 of
[the Phase 9 plan](../plans/phase-9.plan.md) as built in Workflow 9B (`api-exports`) and offered in
the console in Workflow 9C (`dashboard-analytics`). The resource is ours: the public `batch-jobs`
resource is deferred (C177). Single reports are created as [the reports page](README.md#creating-reports)
says; exports are on [their own page](../analytics/exports.md).

- [The upload](#the-upload)
- [The CSV](#the-csv)
- [The job and each row's outcome](#the-job-and-each-rows-outcome)
- [Privacy](#privacy)
- [In the console](#in-the-console)

## The upload

```sh
curl -X POST "$OPENVERIFY_API_URL/api/v1/reports/bulk" \
  -H "Authorization: Bearer $OPENVERIFY_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -F report-template-id=rptp_01JC0000000000000000000000 \
  -F file=@names.csv
```

- **The body** is `multipart/form-data` with exactly two parts: the field `report-template-id` and
  the CSV in the part `file`. Any other part, or a repeated one, is 400; another media type is 415.
- **Limits** (`REPORT_BULK_LIMITS`, ours, provisional): at most 2 MiB (413) and 1,000 data rows; a
  record holds at most 65,536 characters.
- **Permissions.** `reports:write`, plus each link column's own scope when the header names it:
  `account-id` needs `accounts:read` and `inquiry-id` needs `inquiries:write` (Phase 6 decision 39;
  403 otherwise). A workflow run cannot upload (403).
- **The template** must be active with a published version, else 422 `report_template_not_published`
  at `/report-template-id`. Every report is created from that template.
- **Rate limit.** The `report-bulk` policy allows 5 uploads an hour per environment, counted first
  (429). `Idempotency-Key` is honoured.
- **The answer** is 202 with the job (`report-bulk-job`, `rbulk_`), `pending`. A file refused whole
  is 422 with each problem at `/file` as a code and, for a header problem, the column's name; never a
  cell's value.

## The CSV

The file is read by the same reader as list imports (`readCsv` in `@openverify/checks`): UTF-8, a
header row first, one record per row.

- **The header** names columns from two sets, in any order: the query members of the template's
  report type (below), and the optional link columns `account-id` and `inquiry-id`. A column outside
  them refuses the whole file (`unknown_column`), as does a repeated one (`duplicate_column`). A
  member the header leaves out is simply not sent.
- **Cells** are trimmed, and an empty cell is left out of the query. A leading `'` before a formula
  character, as a spreadsheet export writes it, is removed again, as the list importer does.
- **List members**: `additional-names` and `list-ids` hold several values in one cell, separated by
  `|` (`Jane Example|J. Example`), each value trimmed.
- **Link columns**: `account-id` (`acc_…`) and `inquiry-id` (`inq_…`) link the row's report as
  `POST /reports` links one.

The query columns of each report type, generated from `REPORT_QUERY_FIELDS` in
`packages/contracts/src/report-queries.ts`; each type's page says what each member means:

| Report type                         | Query columns                                                                                                                                                                                      |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `report/watchlist`                  | `name-first`, `name-middle`, `name-last`, `term`, `birthdate`, `address-country-code`, `gender`, `identification-number`, `identification-type`, `identification-country-code`, `additional-names` |
| `report/business-watchlist`         | `term`, `address-country-code`, `registration-number`, `lei`, `website`, `swift-bic`, `imo-number`, `mmsi`, `aircraft-serial`, `aircraft-tail`                                                     |
| `report/crypto-address-watchlist`   | `crypto-address`, `chain-id`                                                                                                                                                                       |
| `report/politically-exposed-person` | `name-first`, `name-middle`, `name-last`, `term`, `birthdate`, `country-code`, `additional-names`                                                                                                  |
| `report/adverse-media`              | `name-first`, `name-middle`, `name-last`, `term`, `birthdate`, `country-code`, `additional-names`                                                                                                  |
| `report/business-adverse-media`     | `term`, `country-code`                                                                                                                                                                             |
| `report/email-address`              | `email-address`                                                                                                                                                                                    |
| `report/phone-number`               | `phone-number`                                                                                                                                                                                     |
| `report/address-lookup`             | `addressee`, `address-street-1`, `address-street-2`, `address-city`, `address-subdivision`, `address-postal-code`, `address-country-code`                                                          |
| `report/ip-address`                 | `ip-address`                                                                                                                                                                                       |
| `report/custom-list`                | `name-first`, `name-last`, `email-address`, `phone-number`, `government-id-number`, `government-id-class`, `ip-address`, `country-code`, `string`, `list-ids`                                      |

An example for an `ip-address` template:

```csv
ip-address,inquiry-id
192.0.2.10,inq_01JC0000000000000000000000
198.51.100.7,
```

## The job and each row's outcome

`GET /api/v1/reports/bulk/:id` (`reports:read`) reads a job; a job of another environment is 404.

```json
{
  "data": {
    "type": "report-bulk-job",
    "id": "rbulk_01JC0000000000000000000000",
    "attributes": {
      "status": "completed",
      "report-template-id": "rptp_01JC0000000000000000000000",
      "row-count": 3,
      "created-count": 2,
      "failed-count": 1,
      "rows": [
        {
          "row": 1,
          "outcome": "created",
          "report-id": "rep_01JC0000000000000000000001",
          "error-code": null
        },
        {
          "row": 2,
          "outcome": "created",
          "report-id": "rep_01JC0000000000000000000002",
          "error-code": null
        },
        { "row": 3, "outcome": "failed", "report-id": null, "error-code": "report_query_invalid" }
      ],
      "error-code": null,
      "created-at": "2026-11-07T10:00:00.000Z",
      "completed-at": "2026-11-07T10:00:04.000Z"
    }
  }
}
```

- **Status:** `pending`, `running`, `completed` or `failed`.
- **Rows** are numbered from 1 (the header is row 0) in the file's order, and listed in row order.
  **Every row is reported: `created` with its `report-id`, or `failed` with its `error-code`. A row is
  never skipped.** The counts are the rows'.
- **A row's code** is a code, never a value:
  - the refusal's own problem code where it has one, such as `report_lists_required`;
  - else by status: `not_found` (404), `conflict` (409),
    `redacted` (410) or `report_query_invalid` (422, and a row whose cells do not make a valid query);
  - `report_create_failed` for anything else;
  - for a row the CSV reader refused (a row with the wrong number of cells, say), the reader's code,
    such as `field_count_mismatch`.
- **Each report** is created through the same service as `POST /reports`, with `origin: bulk`, and
  its first run is queued after it commits. A row's report and its outcome are written in one
  transaction, so a retried job never creates a row's report twice.
- **A whole-file `error-code`** ends the job `failed`: `report_bulk_file_unreadable` (the CSV is gone
  or no longer opens), `report_bulk_file_refused` (the CSV no longer reads as it did at the upload),
  `report_runs_unavailable` (the worker runs no reports), or `report_bulk_expired` (the job had not
  ended a day after the upload, and its CSV was deleted).
- **Audit:** `report-bulk-job.created` with the template and the row count only.

## Privacy

The CSV holds third-party personal data: the names, addresses and numbers of people who need not be
anyone's inquiry subject.

- It is stored sealed in object storage, bound to its job, and **deleted when the job ends**.
  `export-sweep` (every 60 seconds) deletes the CSV of any job that ended or is older than 24 hours.
- No subject's redaction reaches it, since it belongs to no subject; it is kept a day at most.
- The CSV is masked in the API logs (`PII_REPORT_BULK_ATTRIBUTES`): a stored log keeps the parts'
  metadata only.
- The reports it creates are ordinary reports, masked, redacted and retained as any other.

## In the console

**Bulk reports** (`/exports/bulk-reports`, `reports:write`) sits under Reports in the navigation. It
offers the environment's active report templates and a file field; it reads the templates with
`report-templates:read`, and an operator without it gets a "Report template ID" field instead
(checked as an `rptp_` id before anything is sent; Workflow 9D, K9-20), since the API needs only
`reports:write`. The browser's upload goes
to the console route `/exports/bulk-reports/upload`, which checks the request's origin, that it is
multipart and at most 2 MiB plus 64 KiB of framing, and the operator's session, then streams it to
the API with an `Idempotency-Key` of its own. Its answer is in the console's words, never the API's
problem. The page then shows the job (`?job=rbulk_…`): its status, its counts and every row, created
with a link to its report or failed with its code, each code in words with the code beside it (an
unknown one reads "not described"; K9-21).
