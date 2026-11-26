# Lists, the graph and transactions

This is not legal advice.

Not reviewed by counsel.

Three features of Workflow 7B that process personal data in ways a verification does not: lists hold data about people who need not be subjects, the graph links accounts (profiling), and transactions keep records an operator may be required to hold.

## Lists: third-party data

A list is the operator's own: blocked emails, IP ranges, document numbers, names, faces, backdrops and more ([lists](../lists/README.md)). Its items are values an operator entered or imported about people who may never start an inquiry, so no subject's redaction reaches them (`THIRD_PARTY_LIST_PII_TABLES` in `apps/api/src/services/redaction.test-support.ts`: importers, staged import rows, list items).

| Concern | What the software provides | What stays yours |
|---|---|---|
| Source and basis | Items come only from the list routes, importers and workflow actions you run; list values never appear in logs, problems, events or metadata ([lists](../lists/README.md#retention-and-redaction)) | The basis for holding each list, and the information Article 14 asks you to give people whose data you did not collect from them ([sharing](sharing.md#information-to-the-person) summarises Article 14) |
| Retention | `item-retention-days` per list (up to 3,650 days), applied by the daily retention pass; required on face and background lists; an importer's file kept only until its import ends and then at most the lesser of `item-retention-days` and 7 days | Choosing the window |
| Access and erasure | List memberships of an account appear in the export's `operator-review` part ([access requests](access-requests.md)); an item is removed with `DELETE /api/v1/list-item/<kind>/:id` | Searching lists for a requester and judging what to disclose |
| Effect | A list match is a signal for review, not a decision by itself, unless a workflow you publish makes it one ([automated decisions](automated-decisions.md)) | Whether a match may lead to an adverse decision |

**Face and background lists are biometric data**: they need the environment's recorded basis `biometric-lists-basis` and the subject's matching consent, they are advisory only, and their thresholds are as Workflow 11D left them (face 0.72 at a false-negative identification rate of 25.3%; backgrounds not calibrated) ([biometric data](biometric-data.md#face-and-background-lists-as-calibrated)).

## The graph: profiling

The graph links accounts that share attributes (a document number, a phone, a device fingerprint, an address) to find fraud rings and duplicates ([graph](../graph/README.md)). It is profiling in the GDPR's sense: an operator who turns it on records it in the DPIA, with its purpose, the kinds it indexes, the retention of stored results and who may unmask ([DPIA](dpia.md)).

- `graph-indexing` is on by default; `graph-weak-kinds` (IP address, browser fingerprint, name, birthdate and other weak links) and `graph-components` are off by default, because they link people on little evidence. All three need `settings:privacy`.
- Values are stored as pseudonymous keys; a plaintext value is read back only from the record that holds it, by an audited unmask that needs `pii:view`.
- A graph query's parameters (what a principal searched for) are kept for `graph-query-retention-days` (default 30 days). A subject's redaction deletes the account's entries and removes it from every stored result.

## Transactions: records you may have to keep

Transactions record an operator's own events (a payment, a withdrawal, a claim) with typed fields and files ([transactions](../transactions/README.md)).

- A subject's redaction reaches their transactions (owner decision 1 after Workflow 7B): an inquiry's redaction every transaction naming it, an account's every transaction attached or related to it.
- **`never` fields stay.** A field with the redaction policy `never` is kept through every cascade and through `transaction-retention-days`; it is how an operator keeps what a legal duty such as anti-money-laundering record keeping requires. `never` is refused on types that can hold personal data in structure, and on a `string` it needs an explicit acknowledgement. Only the transaction's own redaction with `meta.include-never`, audited, removes them.
- `transaction-retention-days` (unset by default) redacts transactions past it in the daily pass.
- Whether your record-keeping duty overrides an erasure request, and for how long, is yours to decide.
