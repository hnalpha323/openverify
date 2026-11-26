# Automated decisions

This is not legal advice. You are the controller, and you decide your own basis. This page says what OpenVerify records and refuses for a decision a workflow makes about a person, so you can meet GDPR Article 22 and your own law.

Not reviewed by counsel.

## The four duties

1. **A basis** for each automated adverse decision: contract, law or explicit consent (Art. 22(2)).
2. **Notice before collection**: the person is told that automated decisions are made, what they rest on and what follows.
3. **A contest route, with a reviewer who can change the outcome** (Art. 22(3)).
4. **A DPIA** that records where people take part, and where they do not.

Read the CJEU's SCHUFA judgment (C-634/21) with your own counsel: a score that someone else applies without review can itself be a decision. A workflow that reads a score and declines is that case.

## What is adverse

`decline_inquiry` always. `add_list_item` and `add_face_list_item` unless the list's `purpose` is `allow` or `watch` (`block` by default). `update_transaction_status` when the status is in the type's `adverse-statuses` (`declined` by default). `update_object` archiving an account. An adverse step gets the record and the gates below. Prefer review: mark the inquiry for review, open a case, and decline as the case's next step.

## The record

Every approve, decline, adverse step and mark for review writes one (`idec_`), whoever makes it, served as `inquiry.decisions` and by `GET /decisions?filter[subject-id]=` with the subject's read scope. A simulated decision writes none.

| Field | For your DPIA |
|---|---|
| `kind`, subject | What was decided, about an inquiry, account, transaction or list item |
| `actor` | A user, an API key or a run. Never the system |
| `run` | The workflow, version, node, the routes taken, and the SHA-256 of each condition and Evaluate Code source they depended on |
| `solely-automated` | Computed from what happened |
| `human-step` | Who, by which event, singly or in bulk |
| `evidence` | Codes and ids only, with the tier, stage and confidence of every H-tier input, and each Calculate that fell back on a default |
| `pending-evidence` | Reports, screenings, graph indexing and signals still pending |
| `decision-basis`, `contest-route`, `biometric-basis` | As declared |
| `comment` | Sealed, masked without PII visibility |
| `needs-review`, `error-code` | A gate stopped it |

`inquiry.declined` carries `meta.decision`. Redacting a subject keeps the row's codes, ids and flags, the accountability record of Art. 5(2) and Art. 22, and nulls only its comment.

## Solely automated

`solely-automated` is `false` only when, on the path actually run, a wait was **resolved** by a `case.resolved` event, resolved **singly**, by a **user** who held `inquiries:write` when the event was staged, on a case that holds the subject, and the route to the decision read that resolution. A timeout, a manual, CSV, API or case-action start, a bulk action, an API key and a run never count. A report's dismissal does not count: it is a review of the report, not of the decision. For an API decision, `meta.solely-automated` is what you declare, and absent it reads as not declared. The console's wording ("a person reviews this path") comes from a static reading, which decides nothing.

## The gates

In production every adverse step needs, with no static exemption:

- `decision-basis`: `contract`, `law` or `explicit-consent`;
- `contest-route`: an `https:` URL on `workflow-link-hosts` or the flow's host, or a contact, optionally with a case template. A case template alone is refused, because it does not reach the person. A transaction or account subject may use its type's `contest-route` when every active type of that kind holds one;
- `heuristic:<step id>` when its path reads an H-tier value.

At run time, a production step that reaches a solely automated decision without them errors `decision_basis_missing`, and its subject goes to review: an inquiry is marked for review, and a transaction, list item or account gets the error in its record with `needs-review: true`. Sandbox environments publish with warnings.

An approve is gated too. From a run it answers `review_required` on an inquiry that a person must look at: a rejected handoff, a verification ended in review, an errored report, a list that was not screened, an unevaluated signal.

## Biometric decisions

An adverse step is biometric when an inquiry, verification or list-match trigger admits a template with a biometric check or a face list (a filter that does not bound the templates counts), when its path reads a biometric result, or when it reads the status of such a template. Under any other trigger, reading an inquiry or check status counts unless the paths bound the template to non-biometric ones. `add_face_list_item` always is.

In production such a step needs `biometric-basis`: `explicit-consent` or `substantial-public-interest`. With `explicit-consent` the run checks at the decision that the inquiry recorded **both** `consent.biometric` (and `consent.biometric-matching` for a face list) **and** `consent.automated-decision`, otherwise `biometric_consent_missing` and review. Art. 9(2)(a) and Art. 22(2)(c) are two consents, so collect both: add `consent.automated-decision` to your consent step, with your text saying that automated decisions are made.

## A person asks for review

A declined inquiry's flow shows the recorded route, with the host before the link.

`POST /inquiries/:id/reopen` (a user with `inquiries:write`, with a required `meta.comment`) moves `declined` to `needs_review`, fires `inquiry.reopened`, and opens **human review pending**: until a user decides, every decline by a run or an API key answers `human_review_pending`, so automation cannot decline it again. A redacted inquiry answers 410. A decline deleted the inquiry's face template, and a reopen does not bring it back, so a reopened inquiry has none. For other adverse kinds the remedy is the subject's own reversal by a user: a status change, removing a list item, unarchiving an account.

Until cases land, publish refuses a contest route that names a case template.

## A notice paragraph per path

Adapt these with your counsel:

- **Decline by rule:** "We check your documents automatically. If a check fails, we may decline your application without a person reviewing it. You can ask for a person to review the decision at <route>."
- **Review first:** "We check your documents automatically. A member of our team reviews any application that does not pass, and decides."
- **Block list:** "We keep a list of details linked to fraud. If yours match, we may add them to that list. You can contest this at <route>."
