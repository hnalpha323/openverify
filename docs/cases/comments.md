# Comments and notifications

## Comments

`POST /cases/:id/add-comment` takes `meta.message` (1 to 10,000 characters). The message is sealed; the comment (`cscm_`) records its commenter's type and id and fires `case-comment.created`, whose payload holds no message. `GET /cases/:id/comments` lists them newest first in cursor pages.

Comments are append-only: there is no edit and no delete. `POST /case-comments/:id/redact` nulls the message and keeps the id, the author and the times; the author may redact their own comment with `cases:write`, anyone else needs `cases:redact`. It is audited.

Comments are plain text. A mention is a `@[usr_…]` token; it counts only for an active user of the organisation who holds `cases:read` and may see the case's template, and it is kept in `mentions[]` (at most 50). Any other token stays text, with no error, so a comment cannot be used to learn whether a user exists. The author is not notified of their own mention. A review request's statement is a comment by the relaying user, so its mentions are checked the same way.

## Notifications

In-app notifications (`unot_`) are written for `assigned`, `mentioned` and `sla-breached`, naming the case and nothing of its content. `GET /api/v1/dashboard/notifications` (`filter[unread]`) and `POST /api/v1/dashboard/notifications/:id/read` serve them on the dashboard API, behind the operator's session; an API key has none. They are kept 90 days.

### Emails

Each in-app notification, and each user a template version lists in `notify-on-create` when a case is created, is owed a link-only email, written in the same transaction (the `case_notification_emails` outbox, ids and a kind only). The worker sends them, every 30 seconds (`case-notification-emails`), through its SMTP settings (`OPENVERIFY_SMTP_URL`, `OPENVERIFY_MAIL_FROM`):

- a fixed sentence per kind and the case's console link (`OPENVERIFY_DASHBOARD_PUBLIC_URL/cases/<id>`), never a comment, a field, a filename or the case's name; without the console URL the message names no case and has no link;
- only to a user who can still read the case at send: active, holding `cases:read`, able to see the template, and the case not redacted; any other is skipped;
- at most three tries, each claim held for five minutes, so a worker that stops mid-send leaves it to the next run; without an SMTP server nothing is sent and the queue is emptied.
