# Importing list items from CSV

`POST /api/v1/importer/list-item/<plural>` (`importers:write` and `lists:write`) adds items to one list from a CSV file, on the worker. Eleven kinds have an importer; face and background lists take items from inquiries only.

## The upload

Two forms, the same fields:

- **JSON:** `{ "data": { "attributes": { "list-id", "file", "mode"?, "encoding"? } } }`, the file base64-encoded.
- **Multipart:** the parts `data[attributes][file]` (a file part), `data[attributes][list-id]`, `[mode]` and `[encoding]`; any other or repeated part is 400.

The answer is 201 with the importer, `pending`. The file is sealed with its own data key and kept in the object store until the import ends, then for at most `least(item-retention-days, 7)` days. A stored API log keeps a JSON file as its length and SHA-256 only, and never a part's file name without `pii:view`.

| Limit | Value |
|---|---|
| File | 20,000,000 bytes (413 above) |
| Rows | 100,000 records (a larger file is refused with `row_limit_exceeded`) |
| A record | 4,096 characters |
| Error rows kept | 1,000 |
| Uploads | 10 an hour per environment (`importers` policy, 429 with `Retry-After`) |

**Encodings.** UTF-8 (the default) or a WHATWG single-byte encoding (`windows-1252`, `iso-8859-2`, ...), named by any label `TextDecoder` reads and stored by its WHATWG name. UTF-16 and multi-byte encodings (`shift_jis`, `gbk`) are refused with 422 `invalid_value`. A byte that does not decode refuses the file with `invalid_encoding`, never a replacement character.

**Modes.** `all-or-nothing` (the default): any row error rolls every write back and the import ends `errored`. `skip-invalid`: the good rows are written, the rest are listed; the import ends `errored` only when the file is refused or nothing was written.

**Idempotency.** A request with an `Idempotency-Key` is answered once (C107.3). The same file (list, mode, encoding and SHA-256) uploaded again within 24 hours answers the earlier importer with 201 and takes no rate token. A row already on the list counts in `already-present-count`; a row repeated within the file counts in `duplicate-count`.

## Columns

A header row is required. Every column of the kind must be present (a missing, unknown or repeated column refuses the file); an optional column may hold an empty cell.

| Kind | Columns |
|---|---|
| `email-address` | `value`, `match_type` (`email_address` or `domain`, empty for the address) |
| `phone-number`, `ip-address`, `string`, `browser-fingerprint`, `device-fingerprint` | `value` |
| `government-id-number` | `id_number`, `id_class` (empty for any class) |
| `name` | `name_first`, `name_last` |
| `country` | `country_code` |
| `geolocation` | `latitude`, `longitude`, `radius_meters` |
| `field` | `field_value` (the list names its field) |

## Errors

`GET /api/v1/importers/:id/errors` lists `{ row, column, code }`, the whole-file errors (row `null`) first. An error is a code and a place, never a value.

| Scope | Codes |
|---|---|
| The whole file | `invalid_encoding`, `missing_column`, `unknown_column` (column `null`, so a file without a header never echoes a person), `duplicate_column`, `row_limit_exceeded` |
| One row | `record_too_large`, `field_count_mismatch`, `invalid_value`, `unparseable_phone`, `host_bits_set`, `out_of_range`, `unsupported_class` |

Only a row with the wrong number of fields and an invalid opening quote are stepped over as row errors. Every other parser error, a record too large or an unclosed quote among them, refuses the whole file in both modes, because the parser can lose the records after it without saying so.

## Spreadsheet formulas

Exported CSV (a graph export, for example) is written with every cell quoted and a leading apostrophe before a cell that starts with `=`, `+`, `-`, `@`, a tab, a carriage return or a line feed, or their full-width forms (OWASP's CSV injection guidance). An import strips that one apostrophe again, so an export round-trips. No escape is safe in every spreadsheet program: open a file from an untrusted source with formulas disabled.

## The job

The `list-import` job reads the sealed object, decodes it strictly, stages the rows sealed, writes them through the list's item writer in file order in one transaction under the importer's row lock, records the errors and ends the import. A failure it can retry (the object store is unreachable) leaves the import `pending` for the `list-import-sweep` (every 15 s, for imports enqueued more than 2 minutes ago); after 10 attempts it ends with `attempts_exhausted`. Throughput measured during Workflow 7B: 600 to 1,300 rows a second under load, so a 100,000-row import takes 1.5 to 3 minutes.
