# Device handoff

A person who starts a verification on a desktop can continue it on a phone, whose camera is
better suited to photographing an ID document and taking a selfie. The template places a
`device_handoff` step where the move should happen, usually before `government_id`. Plan reference:
C96 in `docs/plans/phase-7.plan.md`.

## The step

```json
{
  "id": "device_handoff",
  "type": "device_handoff",
  "methods": ["qr"],
  "qrTtlSeconds": 300,
  "linkTtlSeconds": 900,
  "confirmationCode": false,
  "skipOnMobile": true,
  "allowContinueHere": true
}
```

Every option is optional, and the values shown are the server's defaults:

| Option | Meaning |
|---|---|
| `methods` | `qr`, `email` and `sms`, in any combination. The default is QR only. |
| `qrTtlSeconds` | How long a QR token lives: 120 to 900 seconds. |
| `linkTtlSeconds` | How long an emailed or texted token lives: 300 to 3,600 seconds. |
| `confirmationCode` | The desktop shows six digits, and the phone must type them. |
| `skipOnMobile` | A session on a smartphone or tablet (from its parsed user agent) skips the step. An SDK session always skips it. |
| `allowContinueHere` | The person may skip the handoff and continue on the desktop. |

Our lifetimes are shorter than the one hour that is common elsewhere. A short-lived token gives a
phishing message less time to work. A token never outlives its inquiry.

**Publishing** refuses a template with a `device_handoff` step:
- when the environment's `organization-display-name` setting is empty (422
  `display_name_required`, pointing at the step), because the phone shows that name;
- when the step offers `sms` and no SMS adapter is bound in the environment (422
  `sms_not_configured`, pointing at the step's `methods`).

An operator sets `organization-display-name` (1 to 100 characters) under `settings:write`. If it is
cleared after a template was published, the phone shows the organisation's own name instead, and no
new handoff can be issued until it is set again.

## How it works

1. The desktop reaches the step. If the step offers QR, the flow asks for a token
   (`POST /api/v1/flow/handoffs`). It draws the QR itself, in the page; no QR service is called.
   Beside the QR it shows the same link as text, a copy button, a countdown, "Get a new code", the
   email and SMS options where they are offered, and "Continue on this device" where it is allowed.
2. The phone opens the link. The token sits in the link's fragment, which browsers never send to a
   server, and the flow clears it from the address bar at once. The phone first asks for a
   **preview** (`POST /flow/handoffs/preview`). The preview uses nothing up, so a link scanner or
   a mail sandbox that opens the link does no harm.
3. The phone shows a **context screen**:
   - the organisation's display name;
   - what will be verified (the step types after the handoff step);
   - when the flow started and, where network data is configured, in which country, with the
     data source's attribution line (for DB-IP: "IP geolocation by DB-IP");
   - advice that depends on the method;
   - **Decline**, with the same weight as **Continue**.
4. **Continue** redeems the token (`POST /flow/handoffs/redeem`) and opens a new session on the
   phone. Its token is held in memory only. The phone then shows the template's **consent** step
   for its own session, with the optional texts unticked. Collection, capture and every biometric
   gate wait for the phone's own consent: the desktop's consent never authorises the phone.
5. While the phone's session is active, the desktop is **locked**. Every non-GET flow call of the
   desktop session is refused with 409 `session_handed_off`, except the handoff routes. The desktop
   shows "You continued on your phone at HH:MM", with the phone's operating system and browser,
   and a **This was not me** button. When the inquiry finishes on the phone, the desktop shows the
   completion screen.

**Decline**, on the phone, revokes the token. The desktop then sees the step again.

**A reload.** A desktop reloaded while the phone works reads `handed-off: true` on its step, so it
stays on the waiting screen and issues nothing; a phone that has left gives the step back. After
the phone completes, the desktop shows the template's completion screen, and an outcome screen
collects no signals, because a finished session may read but not write.

**This was not me**, on the desktop:
- ends the phone's session (`inquiry-session.canceled`);
- cancels the verifications that session created and had not submitted, and deletes their files;
- marks the ones it had already submitted or that were already decided as **from a rejected
  handoff**. They are kept and shown to the reviewer, and are left out of the signals. The inquiry
  goes to `needs_review` with the cause `handoff_rejected`: at once if it is already `completed`,
  otherwise when it completes;
- shows the step again, so the desktop can get a new code or continue here.

A rejected phone's consent authorises nothing afterwards.

### The state of the step

The state is kept per inquiry and step, not per session, so a desktop that resumes keeps it. It is
served as `handoff` on `GET /api/v1/flow/session`.

| State | Set when | Done? |
|---|---|---|
| `pending` | nothing has happened yet | no |
| `issued` | a token was issued | no |
| `redeemed` | the phone continued | yes |
| `continued_here` | the person chose to continue on the desktop | yes |
| `skipped` | served to a mobile or SDK session; this state is never stored | yes |
| `rejected` | the desktop said "this was not me" | no: the step shows again |
| `declined` | the phone declined on its context screen | no: the step shows again |

Moves:
- `pending`, `issued`, `rejected` and `declined` move to `issued` on a new token, and to
  `continued_here` on continue-here;
- `issued` moves to `redeemed` on redemption and to `declined` on a decline;
- `redeemed` moves to `rejected` on "this was not me".

An issue or a continue-here that waited behind a redemption re-reads the state under the inquiry's
lock and is refused, so `redeemed` is never overwritten.

## Email and SMS

A link goes by email or SMS **only to a destination this inquiry has already confirmed with a
one-time code** (an `email_otp` or `phone_otp` step earlier in the flow). Any other destination is
refused with 422 `destination_not_confirmed`, unless the step sets `confirmationCode`.
- With `confirmationCode`, a link may go to an unconfirmed destination. The phone's preview then
  shows only the organisation's name and the method's advice. The context (steps, start time,
  country) appears after the correct code.
- The destination is used only to send. It is never stored, logged or audited. Flow routes are not
  written to the stored API logs, and its name is on the PII list that masks request bodies.
- An SMS destination must suit the flow's `phone_otp` step (its countries and its VoIP rule). A flow
  without one sends no handoff SMS.
- The message names the organisation, the link, and its lifetime. It also advises using the link
  only right after asking for it on the organisation's own site. It never carries the
  confirmation code.

## Tokens and codes

- A token is `ovh_` followed by 32 random bytes in base64url. Only its SHA-256 is stored, and it is
  compared in constant time. It is bound to the inquiry, the step and the issuing session.
- A token is single use. Issuing a new one revokes the session's previous live token.
- A confirmation code is six random digits. It is stored only as SHA-256 over the token and the
  code. The fifth wrong code revokes the token. A wrong code counts whether the preview or the
  redemption checks it.
- The C16 retention pass deletes tokens 30 days after they expire.

## Routes, problems and limits

| Route | Authentication | Success | Problems | Limits |
|---|---|---|---|---|
| `POST /api/v1/flow/handoffs` | session | 201 `{ id, method, expires-at, url-fragment?, confirmation-code? }` | 409 `handoff_not_available`; 422 `handoff_method_not_allowed`, `destination_not_confirmed`, `display_name_required`, `sms_not_configured`; 429 or 503 `handoff_send_limited` | `flow-handoffs` 5 an hour per session; `flow-handoffs-ip` 10 an hour per address; email and SMS also count against `OPENVERIFY_HANDOFF_SENDS_PER_HOUR` per environment (default 200), which fails closed; SMS also under the one-time-code SMS guards |
| `POST /api/v1/flow/handoffs/continue-here` | session | 200 `{ status: continued_here, … }` | 409 `handoff_not_available`, `continue_here_not_allowed` | none |
| `GET /api/v1/flow/handoffs/current` | session | 200 `{ status, redeemed-at, os-name, browser-name }`; the last three only after redemption | 409 `handoff_not_available` | none |
| `POST /api/v1/flow/handoffs/current/reject` | session | 200 `{ status: rejected, … }` | 409 `handoff_not_redeemed` | none |
| `POST /api/v1/flow/handoffs/preview` | none: the token in the body | 200 `{ organization-display-name, method, confirmation-code-required, context }` | 410 `handoff_token_invalid` | `one-time-link-redeem` per address |
| `POST /api/v1/flow/handoffs/decline` | none | 200 `null` | 410 `handoff_token_invalid` | `one-time-link-redeem` per address |
| `POST /api/v1/flow/handoffs/redeem` | none | 200 `{ session-token, expires-at }` | 410 `handoff_token_invalid`; 409 `session_limit_reached` | `one-time-link-redeem` per address |

- **The uniform 410.** The phone's three routes answer every failure with the same 410
  `handoff_token_invalid`: an unknown, used, revoked or expired token, another inquiry's token, an
  inquiry that is no longer open, and a wrong code. The redemption checks the token first; only
  then does the template's session cap (`max-sessions`) apply.
- **Send failures.** If the mail server or the SMS adapter refuses a message, the token is revoked
  and the issue answers 503 `handoff_send_limited`.

## What is recorded

- **The phone's session:** `device-handoff-method` (`qr` covers both the QR and its copied link,
  which cannot be told apart), `handoff-from-session-id`, `handoff-redeemed-at` and, after "this was
  not me", `handoff-rejected-at`. Once both
  sessions have been evaluated, it also gets `handoff-distance-meters` (IP to IP, only with DB-IP
  City Lite), `handoff-country-changed` and `handoff-asn-changed`. Each is `null` where either side
  is unknown. These are R-tier review facts and never a verdict.
- **The verifications:** every verification read carries `from-rejected-handoff`, `true` on those
  a rejected phone session created, so a reviewer can tell them apart. Neither member is PII.
- **Events:** the phone's session emits `inquiry-session.started`, and a rejection emits
  `inquiry-session.canceled`. There are no new event names.
- **Audit entries:** `handoff.issued`, `handoff.previewed`, `handoff.redeemed`, `handoff.declined`,
  `handoff.continued-here` and `handoff.rejected`, plus `handoff.review-requested` (cause
  `handoff_rejected`) when a rejection sends the inquiry to review.
  - Each holds ids, the method and counts only.
  - No principal acts in the flow, so they are system entries: `GET /user-audit-logs` serves them
    with the actor `{ type: "system", id: null }`, with the same scope and masking as every entry.

## Threat model

RFC 10027 (BCP 247) names this attack "illicit onboarding" (its example B6). An attacker starts a
verification for an account they control, takes the QR code, and gets a victim to scan it. The
victim's real document and face would then verify the attacker's account. No token is stolen,
which is why the phone side matters more than the secrecy of the QR.

**What raises the attack's cost:**
- the phone records its own consent;
- the context screen names the organisation, the steps and when the flow started, and offers
  Decline with the same weight as Continue;
- the short lifetimes;
- email and SMS go only to confirmed destinations;
- "this was not me" on the desktop;
- the distance facts as review signals.

**What no web design prevents:** a real-time social-engineering relay, in which the attacker
coaches the victim live and presents a fresh code. The measures above raise its cost and leave
evidence, nothing more.

**What catches it downstream:**
- `selfie_account_comparison`: the victim's face does not match the account's earlier selfies;
- the account graph (C102): one device or address across many accounts, or one account handed to
  many unrelated phones.

## Accessibility

- The QR is an image with an accessible name. Its text alternative is the same link, shown in a
  read-only field with a copy button.
- Each screen moves focus to its heading, and every change of state is announced in a live region.
  The countdown itself is not announced, so it is not read out every second; its expiry is.
- Decline and Continue have the same visual weight, and every button is at least 44 pixels high.

## The QR library

C96.5 named three MIT candidates. Each one's addition to the flow's production bundle was measured
the same way. The flow was built with `vite build`, with the component drawing through each library
in turn (or through no library, for the baseline). Every JavaScript chunk was then compressed with
`gzip -9` and the sizes summed. The bundle was measured on 2026-10-30 at load average 3.9 to 4.1.

| Library | Bundle (gzip) | Added |
|---|---:|---:|
| none (baseline) | 285,979 B | – |
| `lean-qr` 2.7.4 | 289,568 B | **3,589 B** |
| `uqr` 0.1.3 | 289,972 B | 3,993 B |
| `qrcode` 1.5.4 | 295,258 B | 9,279 B |

A second measure bundled only each library's encoder with the shared renderer, with esbuild
(minified, ESM, browser). It gave the same order: `lean-qr` added 3,557 B, `uqr` 3,795 B and
`qrcode` 9,501 B (7,909 B through its `lib/core` entry).

**`lean-qr` 2.7.4 is the flow's QR library.**
- It draws at error correction M or higher, with a four-module quiet zone, as one SVG path.
- `qrcode` stays a dependency of the dashboard, which already used it.
- Removing `uqr` and the flow's `qrcode` is for `integration-7a`.

## Known limits

- An SDK session never offers a handoff; an iOS handoff target is Phase 10.
