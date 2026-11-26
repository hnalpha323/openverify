# Email address report (`report/email-address`)

Facts about an email address and its domain, and a reputation band. **Tiers:** R for the facts we compute (syntax, DNS, the domain lists, RDAP); H for the band; A for breach data (`emailIntelligence`). **Stage:** `beta`. There is no review: the report never has a match. See [the reports overview](README.md) for what every type shares.

## What a result means

The report is `ready` with every field it could compute. A field it could not decide, or that needs an unbound provider, is `null` and listed in `unavailable-fields` with its reason, never `false`.

| Field | Meaning |
|---|---|
| `email-domain` | The domain (PII: a vanity domain names its owner). The console reads `email-domain-kind` instead. |
| `email-domain-kind` | `free_mail`, `relay`, `disposable` or `custom` (not PII). |
| `email-domain-exists`, `email-is-valid-mx` | DNS: the domain exists; it accepts mail (a null MX does not). |
| `email-is-disposable` | On the disposable list (`data/disposable_email_blocklist.conf`, pinned). |
| `email-domain-age-days` | From RDAP, for custom domains only. |
| `email-is-free-provider`, `email-is-relay`, `email-is-role-account` | From authored tables: 237 consumer domains anyone can sign up to for free (ISP and paid mailboxes are not free mail), 17 relay domains, 89 role mailbox names. |
| `email-mx-provider`, `email-spf-policy`, `email-dmarc-policy` | Ours, informational: they say nothing about a person and never change the band. SPF reads only the domain's own record; DMARC follows the RFC 9989 tree walk (at most 8 queries). |
| `email-domain-typo-suggestion` | A major provider's domain one edit away (PII). |
| `email-is-deliverable` | `true` only for a report created by an inquiry's completion when that inquiry confirmed exactly this address with a one-time code. Otherwise `null`: `not_confirmed`, or `not_linked` for any other origin, so no API caller can test guessed addresses against an inquiry's confirmed one. It is never `false`. |
| `email-credentials-leaked-recent`, `email-breach-count` | From a bound breach provider. |
| `email-is-spam`, `email-malicious-activity-detected-recent`, `email-estimated-age-days`, `age-estimated-*` | Always `null`: no adapter or documented method in Phase 6. |

## The reputation band (H)

`email-reputation` is the worst band reached, with its confidence and every reason that applied (`email-reputation-reasons`):

| Band | Reasons | Confidence |
|---|---|---|
| `low` | `syntax_invalid`, `domain_not_found`, `domain_rejects_mail` (null MX), `no_mail_server`, `disposable_domain` | 0.95 |
| `low` | `domain_recently_registered` (a custom domain younger than `min-domain-age-days`) | 0.7 |
| `low` | `mx_of_disposable_service` (a custom domain served by a disposable service's mail servers) | 0.5 |
| `medium` | `role_account` | 0.6 |
| `medium` | `young_domain` (a custom domain younger than `young-domain-days`), `recent_breach` (within 365 days) | 0.5 |
| `medium` | `domain_typo_of_major_provider` | 0.4 |
| `high` | `accepts_mail`: none of the above, and the domain accepts mail | 0.5: an absence of bad signals is weak evidence |
| `null` | `privacy_relay` (a relay hides the real address); or a check that could reach a worse band failed (a DNS or RDAP error, a failed breach provider, an undated breach, the disposable list missing) | — |

It is never `high` on a timeout. `email-is-suspicious` is `true` exactly when the band is `low`, and `null` when the band is. Every value is provisional.

## Configuration

`min-domain-age-days` (1–3,650; 30) and `young-domain-days` (1–3,650; 365). The type does not recur.

## How it is computed

MX, TXT and DMARC answers are read with the exchanges' real host names and kept in the worker's memory only (an hour, five minutes for a missing name), never in Valkey. RDAP asks the registered domain (one label shorter until a registry answers) and keeps its dates in memory per environment for a day. No SMTP probing is done. A sandbox environment answers the reserved names (`.test`, `.example`) without DNS.

## Sandbox

The sandbox breach provider answers a breach 90 days old for a local part holding `sandbox-breached`, and none otherwise (`sandbox-spam` has no adapter). In sandbox environments `disposable.example` reads as disposable and `relay.example` as a relay. See [the sandbox providers page](../checks/sandbox-providers.md#phase-6-reports).

## Events

`report/email-address.ready`, `.errored`, `.redacted`.
