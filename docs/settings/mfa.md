# MFA, sessions and acting on other users

This page covers C168.1 to C168.5 of [the Phase 9 plan](../plans/phase-9.plan.md) as built in
Workflow 9B (`api-access`): MFA by default, the console MFA reset and the step-up it needs,
reactivation and invitations, an operator's own sessions, and the users list. The console screens
come in Workflow 9C. Second factors are TOTP and WebAuthn passkeys only; there is no SMS or email
factor.

## MFA by default

`require-mfa` is an organisation setting (changed only through an organisation-wide
`settings:write`; see [roles](roles.md#organisation-level-permissions)). With it on, a user must pass
a second factor, or enrol one, before a session can do anything.

- Organisations created since Phase 9 start with `require-mfa: true` (the column's default, so every
  path that creates an organisation gets it).
- Organisations that existed before keep the value they had.
- `pnpm --filter @openverify/api seed:dev` creates its development organisation with
  `require-mfa: false` and says so in its output (`require-mfa   off: set for seed:dev only; ...`);
  `seed:dev --mfa-admin` adds a TOTP-enrolled admin to exercise the enforced path.

The users list shows which factors each user has enrolled; it never judges an account "secure". An
organisation that turns `require-mfa` off is saying so to itself: the console's settings page (9C) is
to state it.

## The step-up: a recent second factor

Some actions on another user need the actor's session to have verified a second factor within the
last **10 minutes** (`STEP_UP_WINDOW_SECONDS` = 600). The session records when it last did, as
`user_sessions.mfa_verified_at`, set at a sign-in that passed a factor, at a factor enrolment, and
by the step-up route:

- `POST /api/v1/dashboard/sessions/current/step-up` takes `{ "totp-code": "…" }` or
  `{ "credential": <passkey assertion> }`, and answers `{ mfa-verified-at, step-up-expires-at }`.
  A recovery code is never accepted, because a stolen one would then let its holder act on other
  users.
- For a passkey, first `POST /api/v1/dashboard/sessions/current/step-up/webauthn/options`.
- A wrong code is 401 `mfa_code_invalid` (the session stays signed in), and each try counts against
  the sign-in rate limit for the user's email (429 past it).

A missing or older check is 403 `step_up_required`; the console then asks for the factor again. In
the console's reset and reactivate dialogs the operator confirms with an authenticator code or, since
Workflow 9D (K9-11), with a security key or passkey: the dialog asks for the passkey options, the
browser signs, and the step-up route verifies the assertion before the action is sent.

## Acting on another user

Resetting, reactivating, deactivating or re-inviting another user could hand access to someone, so
two rules apply ([`services/access/acting.ts`](../../apps/api/src/services/access/acting.ts)):

- **The superset rule.** The actor must hold every permission the target holds, in every environment
  the target can enter (403 `user_more_privileged`). An operator who holds `users:write` but only
  sandbox roles cannot act on a user whose roles reach production.
- **The step-up rule.** As above, with the rule per action below.

| Action                                | Route                                      | Superset | Step-up                          |
| ------------------------------------- | ------------------------------------------ | -------- | -------------------------------- |
| Reset MFA                             | `POST /dashboard/users/:id/reset-mfa`      | yes      | always                           |
| Reactivate                            | `POST /dashboard/users/:id/reactivate`     | yes      | always                           |
| Deactivate, or reverse a deactivation | `PATCH /dashboard/users/:id` with `status` | yes      | only when the actor has a factor |
| Resend an invitation                  | `POST /dashboard/invitations/:id/resend`   | yes      | no                               |

Each needs `users:write`, held organisation-wide. Deactivation keeps working without a factor on
purpose: it only removes access and revokes sessions, so it stays the emergency control in an
organisation without `require-mfa`. An operator with no factor therefore cannot reset another
user's MFA or reactivate a user.

### Reset MFA

`POST /api/v1/dashboard/users/:id/reset-mfa` removes the user's factors and recovery codes and
revokes every session of that user, in one transaction, audited in every environment as
`user.mfa-reset` (with the number of factors removed and sessions revoked). It is never allowed on
oneself (409; replace your own factors in your account). With `require-mfa`, the user enrols again
at their next sign-in. Afterwards, when SMTP and `OPENVERIFY_DASHBOARD_PUBLIC_URL` are configured,
the user is sent a notice holding only a link to the sign-in page; whether it was sent, not
configured or failed is audited as `user.mfa-reset-notified`, and a notice that fails does not undo
the reset. The command line's `pnpm --filter @openverify/api user:reset-mfa <email>` stays for
self-hosters who are locked out of the console.

### Reactivation and invitations

- `POST /api/v1/dashboard/users/:id/reactivate` works on a deactivated user only (409 otherwise). It
  sends a new invitation valid for 7 days, clears the password (the invitation sets a new one), keeps
  the user's factors and history, and **gives no role back**: roles are granted again through
  `PUT /dashboard/users/:id/roles`, with its checks. The user reads `invited` until they accept.
- `POST /api/v1/dashboard/invitations/:id/resend` takes the invited user's `usr_` id, works on an
  invited user only (409 otherwise), and sends a new 7-day invitation whose token replaces the old
  one, so the earlier link stops working. It is limited to 5 an hour per invitation (429).
- Both need SMTP and `OPENVERIFY_DASHBOARD_PUBLIC_URL` (503 without), and both are undone when the
  email cannot be handed to the SMTP server (502).

**A decision for the owner.** `PATCH /dashboard/users/:id` with `status: active` on a deactivated
user keeps its earlier meaning, a reversible suspension that keeps the user's roles, and is now under
the deactivation rules above. So an actor without a factor, who holds a superset, can still undo a
deactivation through `PATCH` with the roles intact, which `POST /reactivate` would not allow. Whether
`PATCH` should refuse that once the console uses `/reactivate` is open.

## Your sessions

`GET /api/v1/dashboard/sessions` lists the caller's own live sessions, newest first: a device
summary such as "Firefox on Linux" (never the user agent itself; `null` when it names neither a
browser nor a system), `created-at`, `last-seen-at` (updated at most once a minute), `expires-at`,
`mfa-verified-at` and `current`. `POST /api/v1/dashboard/sessions/:id/revoke` ends one of them (404
for any other session), and `POST /api/v1/dashboard/sessions/revoke-others` ends every other one,
answering how many. Both are audited. Enrolling a second factor also revokes the user's other
sessions. The device summary comes from the user agent recorded at sign-in, so it is `null` when the
console's server does not pass the browser's user agent on.

## The users list

`GET /api/v1/dashboard/users` serves `mfa-enabled`, `mfa-factors` (each kind with its count, never a
secret) and `last-sign-in-at` (`null` when never, or when the sign-in's audit entry has aged out
under `audit-log-retention-days`) only to holders of `users:write`, so a viewer cannot list the
accounts without a factor.

## Not built

SSO (OIDC, SAML, SCIM), an idle timeout and an unused-permission review are not built.
