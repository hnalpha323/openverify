# The sender name

`mail-sender-name` is an environment setting that names who an email is from, such as
`Example Bank Security`. This page covers C169.8 of [the Phase 9 plan](../plans/phase-9.plan.md) as
built in Workflow 9B (`api-keys-webhooks`).

## What it is

- A display name only: 1 to 100 characters (trimmed), `null` by default, with control characters,
  `<`, `>`, `@` and `"` refused (`mailSenderNameSchema`), so a name such as
  `Bank Security <alerts@example.com>` cannot be set and no name can carry an address of its own.
- The address stays the installation's, `OPENVERIFY_MAIL_FROM`, the same for every environment and
  organisation. Making that address deliverable (SPF, DKIM, DMARC for its domain) is the operator's.
- With the name set, an email's From is the name and the address of `OPENVERIFY_MAIL_FROM`. The mail
  library writes the header: a name that is not ASCII as RFC 2047 encoded words, an ASCII name that
  holds special characters as an RFC 5322 quoted string, and a plain name as it is. With no name, the
  From is `OPENVERIFY_MAIL_FROM` as it is.

## Format characters and encoded words

Two more kinds of name are refused when the setting is saved (400), and the sender also ignores
them at send time, so a name stored before the rule existed sends with the installation's From
unchanged:

- a name holding a Unicode format character, such as a bidirectional override, which can make a
  reader see the characters in another order;
- a name holding `=?`, the start of an encoded word, which some mail clients decode even inside
  quotes, possibly into an address.

## Which emails use it

Every email sent **for an environment** goes out under that environment's sender name (Workflow 9D,
K9-25): the webhook failure alerts ([webhooks](webhooks.md#failure-alerts)), the case notification
emails, the emails of workflow messaging steps, the email one-time codes and the handoff emails. Each
sender passes its message through `fromEnvironment` (`apps/api/src/mail/sender-name.ts`); with no
name set, the message goes with the installation's From as before. The organisation's invitations
and account notices belong to no environment, so they keep the installation's From.

A sender name makes an email look like it comes from the customer, which also helps someone who
copies it; it adds no authentication. Receivers should still judge an email by its authenticated
domain.
