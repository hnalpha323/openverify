# Phone and email checks

This page describes the `phone_number` and `email_address` verification types as Phase 5 ships them: how a one-time code is sent and confirmed, the limits that keep the SMS channel from being abused, the four checks, and what a pass does and does not mean. The binding contracts are C55 and C56 of `docs/plans/phase-5.plan.md`; the tiers and the honesty rules are ADR 0002.

## Contents

- [What a pass means](#what-a-pass-means)
- [The steps](#the-steps)
- [Sending a code](#sending-a-code)
- [Confirming a code](#confirming-a-code)
- [Limits](#limits)
- [Channels and configuration](#channels-and-configuration)
- [The checks](#the-checks)
- [Standards](#standards)
- [Privacy](#privacy)
- [Clients](#clients)
- [Known limits](#known-limits)

## What a pass means

- **Phone:** the user entered the code that was sent by text message to that number, within its lifetime. It shows that they could read messages sent to the number at that moment.
- **Email:** the user entered the code that was sent to that address. It shows that they could read mail sent to it at that moment.

Neither establishes who the person is, that the number or address belongs to them, or that they will keep it. A number can be ported, reassigned or read on a swapped SIM card. Use these checks as contact verification, never as proof of identity.

## The steps

| Step (flow-spec) | Verification type | Default attempts | Settings |
|---|---|---|---|
| `phone_otp` | `phone_number` (`phone-number`) | 5 | `allowedCountries` (1–250 ISO 3166-1 codes, required), `codeLength` 6–10 (default 6), `allowVoip` (default false), `maxAttempts` |
| `email_otp` | `email_address` (`email-address`) | 5 | `codeLength` 6–10 (default 6), `maxAttempts` |

A verification moves `initiated → confirmed` when a code is confirmed, then `confirmed → submitted` when the client submits it (C50.7). A template that has a phone step cannot be published unless an SMS sender is bound for the environment's kind, nor one with an email step without a configured mailer: both answer 422 `otp_channel_not_configured` (C55.10).

## Sending a code

`POST /api/v1/flow/verifications/:id/otp` with `{ "phone-number": "+1…" }` or `{ "email-address": "…" }`. In order (C55.6, P11):

1. **The destination is checked** (C55.8). The server answers 422 `otp_destination_invalid` or `otp_destination_not_allowed` before anything is counted.
   - **Phone:** read in international form only (`+`, then digits, spaces, hyphens, dots and parentheses), at most 32 characters and 15 digits. libphonenumber-js with its full metadata must find it valid. Its region must be in `allowedCountries`. Premium-rate, shared-cost, toll-free, UAN, pager and voicemail numbers are refused, and VoIP numbers unless the step sets `allowVoip`. A valid non-geographic number (such as `+800`) belongs to no allowed country and is refused as not allowed. No carrier lookup is made: libphonenumber-js carries no carrier data.
   - **Email:** an ASCII dot-string local part (no SMTPUTF8), a domain of letters, digits and hyphens with a dot (or another script, converted with `url.domainToASCII`), no IP literal, the RFC 5321 lengths (64 for the local part, 254 in all). Only a validated address reaches the mailer, as an `{ address }` object, so a crafted address cannot add recipients or headers.
2. **The send count and cooldown are read.** A verification takes at most 5 accepted sends. After sends 1 to 4 the next must wait 30, 60, 120 and 240 seconds (429 `otp_resend_too_soon` with `resend-available-at` and `Retry-After`). A send after the fifth submits the verification, and its check fails `otp_not_confirmed`, so the user can start again within `maxAttempts` (no dead end, C55.6).
3. **The limits are consumed** (see [Limits](#limits)).
4. **Under the locks** (the inquiry, then the verification, C40.6) the count is re-checked, the send counted, and a new code stored as its HMAC. A code sent to another destination supersedes the open one.
5. **After the commit the message is sent.** A failed delivery marks the code errored, does not count toward the five sends, and answers 502 `otp_delivery_failed`, so the user can try again or change the destination.

**The code** is `crypto.randomInt(0, 10^length)`, zero-padded, 6 digits by default. It is never stored: the database keeps `HMAC-SHA-256(K_otp, "otp/v1|" + verification + "|" + channel + "|" + destination + "|" + code)`, with `K_otp = HKDF-SHA-256(KEK, "", "openverify/otp/v1", 32)` for the key-encryption key that `code_key_id` names (C55.3). A code whose KEK has left the keyring reads as expired, and the user asks for a new one.

**The messages** (English or Spanish, by the session's language, C55.9):

- SMS: `<org>: <code> is your verification code. Do not share it.`, then a blank line and `@<flow host> #<code>`, the origin-bound one-time code line that lets a browser offer the code only on the flow's own site.
- Email: subject `<org> verification code`; plain text, no links.

`<org>` is the organization's name with control characters, `@`, `#`, URLs, host names and runs of 4 or more digits removed, cut to 40 characters, so a tenant cannot make the message carry a link or a number to call. `<flow host>` is the host of `OPENVERIFY_FLOW_PUBLIC_URL`, never the request's `Host` or `Origin`.

## Confirming a code

`POST /api/v1/flow/verifications/:id/otp/confirm` with `{ "code": "…" }` (C55.4, C55.5):

- Each try first **reserves an attempt** (a conditional update that only succeeds while the code is open, unexpired and under 5 tries), then compares in constant time, so concurrent guesses cannot exceed the budget.
- A right code confirms the challenge, releases its reservation (a first right code counts no wrong entry) and moves the verification to `confirmed`. The client then submits it.
- A wrong code answers 422 `otp_incorrect` with `attempts-remaining`. The fifth wrong try of a code closes it (`attempts-remaining: 0`, later tries 409 `otp_code_exhausted`); the user asks for a new code.
- **Ten wrong entries** across a verification's codes (a new code never resets the count) submit it; the check fails `otp_attempts_exhausted`, a user-behaviour failure the user can retry within `maxAttempts`.
- A code lives **600 seconds** (409 `otp_expired` after). With no code left to enter and no send left, a confirm submits the verification (`otp_not_confirmed`).
- After a confirmation, sends and confirms answer 409 `otp_already_confirmed`.

## Limits

Every OTP limit is a GCRA in Valkey, per environment, and **fails closed**: while Valkey cannot answer, sends and confirms answer 503 `otp_rate_limited` (C55.7, decision 12). Every refusal is one `429 otp_rate_limited` with `Retry-After`. The limits are provisional (decision 7):

| Limit | Size | Counted per |
|---|---|---|
| `otp-destination-hour` | 5 sends an hour | destination (its blind index) and channel |
| `otp-destination-day` | 10 sends a day | destination and channel |
| `otp-ip-hour` | 10 sends an hour | client IPv4 address, or IPv6 /64 |
| `otp-inquiry-day` | 10 sends a day | inquiry |
| `otp-sms-prefix-hour` | 20 SMS an hour | first 8 digits of the E.164 number |
| `otp-sms-country-hour` | half of the environment budget an hour | destination country; only for a step that allows more than one country |
| `otp-sms-max-per-hour` | the environment budget an hour | environment (SMS only) |
| `otp-destination-guess-day` | 20 wrong codes a day | destination and channel, across inquiries |

- **The environment budget** is the setting `otp-sms-max-per-hour` (default 200, `PATCH /api/v1/dashboard/settings`), capped by the install-wide `OPENVERIFY_OTP_SMS_MAX_PER_HOUR_CEILING` (default 1,000; above it the setting answers 422). When the budget trips, the API writes one `environment.otp-sms-budget-tripped` audit entry an hour, and the settings resource shows the latest as `otp-sms-budget-tripped-at`. Keep a spending limit at the SMS provider as well: this budget counts what OpenVerify sends, not what the provider bills.
- **The guess budget** stops one destination from being guessed across many inquiries: the 21st wrong code against it in a day trips it, and from then on sends and confirms to it answer 429 until the window allows one again.
- **A refused user continues to review** (C55.6, V11). A refusal by a destination, inquiry, guess or environment limit, or a 503 while Valkey is down, is recorded on the verification (`limited_reason`). The client may then submit it without a confirmed code, and the check answers `not_applicable`/`otp_delivery_unavailable`, so the verification goes to review rather than failing. **A refusal by `otp-ip-hour` is not recorded**: the client's submit then answers 409 `otp_not_confirmed`, and the user waits for the hour's window.
- **Per-IP limits behind a proxy.** `otp-ip-hour` keys on `request.ip`. With `OPENVERIFY_TRUST_PROXY=false` (the default), that is the socket peer: behind a load balancer or reverse proxy, every user then shares the proxy's address and the per-IP limit counts them all as one. When an SMS sender is bound and `OPENVERIFY_TRUST_PROXY` is false, the API logs this once at start. Set `OPENVERIFY_TRUST_PROXY` to the hop count, or to the addresses or CIDR ranges of your proxies, so `request.ip` is the client's address; never trust a header from the open internet.

Cooldowns and expiry use the application clock; the limits read Valkey's clock.

## Channels and configuration

- **SMS** is sent from the API process, on the flow request, through an `SmsSender` bound per environment kind (C55.10, C63):
  - `OPENVERIFY_PROVIDER_SMS_SANDBOX` and `OPENVERIFY_PROVIDER_SMS_PRODUCTION` take `twilio`, `sandbox` (sandbox environments only; a sandbox binding on production stops the API) or empty (unbound).
  - `twilio` sends through Twilio's Messaging API with an API key: `OPENVERIFY_TWILIO_ACCOUNT_SID`, `OPENVERIFY_TWILIO_API_KEY_SID`, `OPENVERIFY_TWILIO_API_KEY_SECRET`, and exactly one of `OPENVERIFY_TWILIO_MESSAGING_SERVICE_SID` and `OPENVERIFY_TWILIO_FROM`. Calls go through the outbound HTTP client: private networks refused, no redirect followed, a response cap, 10 s. A missing credential stops the API, naming the variable, never its value. Sender registration (for example A2P 10DLC in the US) and the account's own spending limits are the operator's (decision 8).
  - `sandbox` sends nothing. See [the sandbox SMS sink](sandbox-providers.md#sms-sender-and-sink).
- **Email** uses the API's mailer (`OPENVERIFY_SMTP_URL`, `OPENVERIFY_MAIL_FROM`), the one that sends operator invitations. SPF, DKIM and DMARC for the sending domain are the operator's (decision 10). An email code's provenance names the provider `smtp`.
- The worker sends nothing: it only judges what the API recorded.

## The checks

| Check | Type | Tier | Default | Passes when | Fails with | `not_applicable` with |
|---|---|---|---|---|---|---|
| `phone_number_otp_comparison` | user behaviour | R | required | a code sent to the number was confirmed | `otp_attempts_exhausted`, `otp_not_confirmed` | `otp_delivery_unavailable` (a limit refused the user), `input_missing` |
| `email_address_otp_comparison` | user behaviour | R | required | a code sent to the address was confirmed | `otp_attempts_exhausted`, `otp_not_confirmed` | `otp_delivery_unavailable`, `input_missing` |
| `email_address_disposable_detection` | fraud | R | advisory | the domain is on no list | `disposable_domain` | `list_unavailable` |
| `email_address_mx_detection` | user behaviour | R | advisory | the domain takes mail | `domain_not_found`, `domain_rejects_mail`, `no_mail_server` | `execution_error`, `provider_not_configured` |

- **OTP comparison.** Metadata: `channel` (`sms` or `email`), `sends`, `failed-attempts`, and `limited-reason` after a limit refusal. Provenance names the sender (`sandbox: true` for the sandbox sender).
- **Disposable.** The address's domain and each parent domain (shortest last; a one-label TLD is never matched) are looked up in the operator's lists first, then in the pinned list: `disposable-email-domains` at commit `6fcca80` (CC0-1.0, 9,213 domains, SHA-256 `e3bd7355…0f79`), fetched by `python3 scripts/fetch_data.py` from `data/manifest.json` and checked against its pin before use. Settings: `deny-domains` and `allow-domains` (at most 500 each). The most specific level wins, and at each level the operator's lists win over the file, so an `allow-domains` entry passes a listed domain and a `deny-domains` entry fails one the file lacks. Without the file only the operator's lists decide; with no match it answers `list_unavailable`. Metadata: `match` (`none`, `listed`, `denied` or `allowed`) and `match-depth`, never the domain. No public suffix list is used (its licence is MPL-2.0).
- **MX.** A DNS lookup through the worker's resolver (`node:dns/promises`, 3 s, 2 tries), cached by the domain's SHA-256: 1 hour when the domain takes mail, 5 minutes for NXDOMAIN, a null MX or no address. A usable MX record passes. A null MX (RFC 7505) fails `domain_rejects_mail`, NXDOMAIN `domain_not_found`; without MX records the A and AAAA records are read (RFC 5321's implicit MX), and with neither it fails `no_mail_server`. A timeout or other failure is retried with the job, then `execution_error` (review). No SMTP connection is ever made. Metadata: `route` (`mx`, `null_mx`, `implicit`, `nxdomain` or `reserved`) and `record-count`, never a host name. In sandbox environments, names under `.test` and `.example` take mail and names under `.invalid` do not, without a DNS query.

Every check answers `input_missing` when the verification holds no destination. The OTP comparisons are required by default; the domain checks are advisory, because a disposable address or a missing MX record is a signal for the operator, not a reason to stop the user (the code was delivered).

## Standards

The code mechanics follow the out-of-band authenticator rules of NIST SP 800-63B-4 §3.1.3 and OWASP ASVS 5.0.0 V6.5 and V6.6, although contact verification is not authentication:

| Rule | Source | OpenVerify |
|---|---|---|
| At least six decimal digits from an approved random generator; 20 bits of entropy | SP 800-63B-4 §3.1.3.2; ASVS 6.5.3, 6.5.4 | `crypto.randomInt`, 6 to 10 digits |
| Valid for at most 10 minutes | SP 800-63B-4 §3.1.3.2; ASVS 6.5.5 | 600 s |
| Usable once, bound to the request that sent it | SP 800-63B-4 §3.1.3.2; ASVS 6.5.1, 6.6.2 | bound to the verification, channel and destination; a new send supersedes the open code |
| Rate limiting against guessing; a new secret does not reset the failure count | SP 800-63B-4 §3.1.3.2, §3.2.2; ASVS 6.6.3 | 5 tries per code, 10 per verification, 20 per destination a day |
| SMS (PSTN) is a restricted authenticator; consider SIM swap and porting | SP 800-63B-4 §3.1.3.3 | not used for authentication; see [What a pass means](#what-a-pass-means) |
| Codes sent to validate an email address are not authentication | SP 800-63B-4 §3.1.3.1 | email codes validate the address only |

## Privacy

- The number and the address are sealed at rest (`otp_challenges.destination`) with a blind index under the environment's subkey; the code is kept only as its HMAC, nulled once the challenge leaves `sent`.
- No code, number or address appears in a log (except under the `pii` key), an event, a problem, check metadata or a flow document; the flow shows the destination masked (`+1 ••• ••• 0147`, `a•••@example.com`).
- The verification's `phone-number` or `email-address` attribute is PII: masked for keys and operators without `pii:view`, and null once the inquiry is redacted. `confirmed-at`, `sends` and `failed-attempts` are not PII.
- The sandbox sink keeps codes, never numbers (their blind index only), for 15 minutes.

## Clients

- **Web flow:** a country selector limited to `allowedCountries` (or an email field), the code entry (`autocomplete="one-time-code"`), the resend countdown, tries left, "change number", a delivery failure back at the destination, "start again" after `otp_not_confirmed`, and "continue" after a limit refusal. A confirmed code is submitted at once, also on resume.
- **Android SDK:** the same steps in Compose Multiplatform. It has no libphonenumber: it sends the number as `+<calling code> <number as typed>`, and the server's validation is the authority. "Continue without a code" sends again to the remembered destination, which the server answers by submitting the verification.

## Known limits

- No voice OTP or email link (C50.9). No paid phone lookups (carrier, line type, SIM swap): those belong to the Phase 6 phone report (decision 11).
- VoIP detection is only as good as libphonenumber's number-range metadata, which cannot see a number ported to a VoIP carrier.
- An IP-limit refusal is not recorded, so that user cannot continue to review until the hour's window allows another send.
- The disposable list is a snapshot; new throwaway domains appear daily. Refresh the pin in `data/manifest.json` from time to time.
- `nodemailer` moves to 10.1.4 or later on or after 2026-11-01 (C67). Until then only validated `{ address }` objects reach it, and the three 2026-10-19 advisory payloads are tested as refused.
