# Break-glass procedures

Two commands get a locked-out operator back into the console (C277.9, hardening H19). Both act on the database directly, outside the console's permission checks, so **only the people who hold the runtime role's database credential can run them**: whoever can reach `DATABASE_URL` (a shell in the API image, or a host with the repository and the credential). Decide in advance who that is, run them only on a written request from the organisation's admin, and review afterwards.

## `user:reset-mfa`

```bash
pnpm --filter @openverify/api user:reset-mfa <email> [--organization <org_...>]
```

(`node dist/commands/user-reset-mfa.js`.) For a user who lost every second factor and recovery code: it removes the user's MFA factors and recovery codes, ends their sessions, and writes the system audit entry `user.mfa-reset` in every environment of the organisation (with the count of sessions it ended). The user then signs in with the password alone and enrols again, which an organisation with `require-mfa` on makes them do. When several organisations have a user with that email it changes nothing and asks for `--organization`. Its messages name the user and the organisation by id, never a secret.

## `user:allow-password`

```bash
pnpm --filter @openverify/api user:allow-password <email> [--organization <org_...>]
```

(`node dist/commands/user-allow-password.js`; C248.6.) For an organisation whose SSO provider is enforced and is down, misconfigured or gone: it grants the user one password sign-in within 24 hours (`users.password_login_allowed_until`), which the next password sign-in uses and clears, and writes the system audit entry `user.password-login-allowed` in every environment of the organisation. It exits 0 when granted, 1 when refused (nothing written) and 2 on bad arguments. The user still needs their password and, where required, their second factor ([sso.md](sso.md)).

## Reviewing afterwards

1. In the console's audit explorer (`docs/settings/audit-log.md`), filter on the action (`user.mfa-reset` or `user.password-login-allowed`) and the user: each entry is a system entry, so it names no operator. Match it to the written request, and record who ran the command where your own change log keeps it.
2. Check what the user did next: their sign-ins and the actions after them, in the same explorer.
3. After `user:allow-password`, fix or replace the identity provider; the grant expires by itself after 24 hours or one use.
4. After `user:reset-mfa`, confirm the user enrolled a new factor.
