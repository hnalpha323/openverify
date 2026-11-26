# Breach response

This is not legal advice.

Not reviewed by counsel.

What the install records that helps you find out what happened, and the notification duties that stay yours.

## Duties to notify

- **UK GDPR, Article 33** (re-read on 2026-11-20, [S2](sources.md)): the controller notifies the supervisory authority of a personal data breach without undue delay and, where feasible, within 72 hours of becoming aware of it, unless the breach is unlikely to result in a risk to people's rights and freedoms; a later notice gives the reasons for the delay. A processor tells its controller without undue delay. Article 34 adds telling the people affected when the risk is high (not re-read here).
- **EU GDPR, Article 33** has the same 72-hour structure in the Regulation as published; **not re-read on 2026-11-20: EUR-Lex returned no text** ([S1](sources.md)).
- **US states** each have breach-notification laws with their own triggers, deadlines and recipients; Colorado's 2024 biometric amendment also asks for an incident-response protocol in the biometric policy ([US state laws](us-state-laws.md)). None is summarised here.
- An operator that is a processor for its clients notifies them under its Article 28 terms ([roles](roles.md)).

## What the install records

| Record | Where | Kept |
|---|---|---|
| Audit log: what users, API keys, workflows and the system changed (settings, keys, roles, exports, unmasks, redactions and more), each with its actor | [audit log](../settings/audit-log.md); `GET /api/v1/user-audit-logs` | `audit-log-retention-days` (unset keeps every entry) |
| Stored API logs: each API call with its principal and status, personal members masked without `pii:view` | `GET /api/v1/api-logs` | `api-log-retention-days` (default 30 days) |
| A request id (`x-request-id`) on each request, reused from the client when well formed (`apps/api/src/request-id.ts`) | the API's logs and stored API logs | the log store you run |
| Webhook deliveries | the console's webhook pages | `webhook-delivery-retention-days` (default 30 days) |
| Egress of workflow steps that carry personal values | the audit log ([HTTPS request](../workflows/https-request.md)) | as the audit log |
| Process logs (JSON through pino, with personal keys redacted in the API and the worker) | standard output of each process | your log pipeline ([logging](../security/logging.md)) |

The process logs other than the API's and the worker's (the console, the flow server, vision, the code runner) have no redaction list of their own ([logging](../security/logging.md)); keep them access-controlled.

## What helps limit a breach

- Sealed columns: personal values are encrypted with per-row data keys under the install's key-encryption key (`OPENVERIFY_KEK`), which you rotate with `kek:rewrap` ([crypto inventory](../security/crypto-inventory.md); [secrets and rotation](../self-hosting/secrets-and-rotation.md)).
- Keys with scopes and per-environment roles; MFA and step-up for the console ([settings](../settings/README.md)).
- The threat model's rows and their open gaps ([threat model](../security/threat-model.md)); how to report a vulnerability in OpenVerify itself ([vulnerability policy](../security/vulnerability-policy.md)).

## What stays yours

Detection, assessment of risk, the notifications and their records, and your incident plan. The software keeps evidence; it does not decide whether a breach is notifiable.
