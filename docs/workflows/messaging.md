# Messaging

`send_email`, `send_sms`, `send_slack_message` and the two inquiry-link actions all go through one messenger, which applies the rules below to the **rendered** message, never only the template. Each is A-tier: an adapter, with a deterministic sandbox provider that records and never sends and is refused in production. They run in the worker, so the worker binds SMS, Slack and SMTP.

Every step outputs `{ delivery, provider, sandbox, message-ref }`, and `delivery` says what is known, never "sent" or "delivered":

| `delivery` | Means |
|---|---|
| `recorded` | A sandbox provider recorded it |
| `accepted` | The provider accepted it |
| `unknown` | The outcome is not known. The step ends `unknown_effect`, which blocks a resume until it is acknowledged |

Messages are at most once. They retry only on proof of non-delivery: a 429 with `Retry-After`, a connection refused before anything was sent, or an SMTP 4xx before `DATA`. A timeout, or a 5xx after the request was sent, is `unknown`.

## Email

Through the install's `Mailer` and `OPENVERIFY_MAIL_FROM`, one recipient a step. The recipient is an OTP-confirmed address of an inquiry of the run (the trigger's inquiry and every inquiry that is a subject of the run; an account's own fields never count), or an address or domain on `workflow-email-recipients`. An unconfirmed field needs `allow-unconfirmed` and the acknowledgement `unconfirmed:<step id>`, and a literal must be on the allowlist.

Limits, failing closed: 5 an hour and 20 a day per recipient, 1,000 an hour per environment, and 20 a day per recipient across the install, which shares one From address's reputation. Keys hold an HMAC of the address, never the address. A subject is at most 200 characters with CR and LF removed, text 32 KiB, HTML 64 KiB with every value escaped. There are no attachments and no secrets.

## SMS

Through the existing sender, by default to the confirmed number. A literal needs `workflow-sms-recipients`. Destination countries are `workflow-sms-countries`, or the countries the inquiry template's phone step accepts; with no template in scope, none, so no SMS. It uses the OTP budget rules and at most **half** of the hourly SMS budget, so OTP sends keep a share. At most 480 characters.

## Slack

Incoming webhooks only. The URL is a [workflow secret](secrets.md) bound to `hooks.slack.com`, with a path of `/services/T…/B…/…`. Links do not unfurl. One message a second per environment and secret, with a burst of 3, honouring `Retry-After`. `&`, `<` and `>` are escaped in every value. At most 3,000 characters. Slack's error codes read `slack_<code>`. Each operator creates their own Slack app; if you host OpenVerify for others, read Slack's API terms.

## Inquiry links

`send_inquiry_link_email` and `send_inquiry_link_sms` send a one-time link, placed only in the outgoing message and scrubbed from everything stored; the output holds `{ one-time-link-id, expires-at, delivery }`. They go **only to a destination the person confirmed**: a link opens the person's own flow, so neither takes `allow-unconfirmed`.

## Links in a message

A link may point only at the flow's own host or a host on `workflow-link-hosts`, `https:` only, checked on the rendered message: a value holding a URL or a bare host fails with `message_link_refused`. A bare host is any dotted name ending in two or more letters, because no public-suffix list ships. So `report.pdf` or `Node.js` in a message is refused too.

## Sandbox records

Sandbox messages go to their own Valkey lists, one per environment and kind (`workflow-sms`, `email`, `slack`), bodies sealed, at most 500 entries for 24 hours, apart from the OTP list. `POST /sandbox/email-messages/search` reads by recipient, `/sandbox/slack-messages/search` by secret id and `/sandbox/workflow-sms-messages/search` by number, under `sandbox:read`, masked. A Slack record holds the secret id, never the URL. A production environment's key answers 404. A record of a message no run sent is kept and no search serves it.

## Personal data leaving OpenVerify

A template that carries PII taint is an egress step, with the acknowledgement and the audit entry of [HTTPS](https-request.md#personal-data-leaving-openverify). The default templates carry ids and console links only.

- **Recipients.** Your email, SMS and Slack providers are recipients, and so is whoever reads the channel.
- **Processor terms** and **transfers** follow your contract with each provider.
- **Redaction cannot reach what left**: a sent message stays in its provider and in its reader's hands.
