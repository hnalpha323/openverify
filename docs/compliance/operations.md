# Workflows, cases, exports and analytics

This is not legal advice.

Not reviewed by counsel.

The processing Phases 8 and 9 added around verification: workflows that act on results and can send data out, cases where people review, exports that take data out of the install, and analytics over aggregates.

## Workflows and their egress

Workflows run steps on events, schedules and API calls ([workflows](../workflows/README.md)); the rules are ADR 0007 (`docs/adr/0007-workflows-authority-egress-decisions-sandboxing.md`). The steps that send data to a third party:

| Step | Recipient | What the software enforces |
|---|---|---|
| `make_https_request` | An endpoint the operator names | Private and metadata addresses refused in production; a step that carries personal values off the platform is marked, needs its publisher's `pii:view` and the acknowledgement `egress:<step id>`, and every send writes an audit entry naming the step and the destination ([HTTPS request](../workflows/https-request.md)) |
| `send_email`, `send_inquiry_link_email` | The install's SMTP server (`OPENVERIFY_SMTP_URL`) and the addressee | Only to an OTP-confirmed address of the run's inquiries or to `workflow-email-recipients`; per-recipient limits ([messaging](../workflows/messaging.md)) |
| `send_sms`, `send_inquiry_link_sms` | The `sms` provider bound (`twilio`) and the addressee | The confirmed number, `workflow-sms-countries`, a share of the OTP budget |
| `send_slack_message` | The `slack` provider bound (`incoming-webhook`) and whoever reads the channel | A webhook held as a workflow secret |
| Evaluate Code | Nobody: it runs in a code runner with no network (`docs/workflows/evaluate-code.md`) | On by default; `OPENVERIFY_WORKFLOW_CODE_ENABLED=false` ends such a step with an error |

The providers behind these steps are listed with what each receives on [recipients](recipients.md). Run inputs, variables, outputs and step consoles are sealed, and kept for `workflow-run-retention-days` (default 30 days) and `workflow-run-history-retention-days` (default 365 days) ([retention](retention.md)). A workflow's automated decisions are Phase 8's [automated decisions](automated-decisions.md) page.

## Cases

A case is review work: it holds the objects a person must look at, with fields, comments and attachments ([cases](../cases/README.md)).

- Fields, comments and attachment names are sealed; an attachment is typed by its bytes and scanned when an attachment scanner is bound (`attachmentScanner`: unbound by default, or an operator-run `clamd` that receives the bytes, [recipients](recipients.md)).
- A case redacts only itself, not its objects, and goes by `case-retention-days` (unset by default) ([case redaction](../cases/redaction.md)).
- Cases and comments about an account are in the access export's `operator-review` part, to be judged before disclosure ([access requests](access-requests.md)).
- Case emails are link-only: they carry no case content.

## Exports and bulk reports

- **Case exports** are CSV-neutralised and masked without `pii:view` ([case export](../cases/export.md)).
- **Asynchronous CSV exports** of lists of objects are readable by their creator only, for 24 hours, masked without personal-data permission, and refused over 50,000 rows ([exports](../analytics/exports.md)).
- **Bulk report creation** runs reports in batches ([bulk reports](../reports/bulk.md)); each report sends what its provider receives.

An export is a copy that leaves the install's controls once downloaded: who may create one is a role decision ([roles](../settings/roles.md)).

## Analytics

Analytics counts whole things (inquiries, attempts, cases) in daily rollups and serves only suppressed aggregates: small counts are hidden, rates are shown as bounds where they would reveal a small count, and complementary cells are hidden ([analytics](../analytics/README.md)). Noise against differencing over many queries is deferred (C177), so suppression does not stop every inference a determined reader could make; the page says what suppression does not cover.
