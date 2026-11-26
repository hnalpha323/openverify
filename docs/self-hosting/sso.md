# Single sign-on (OIDC)

OpenID Connect sign-in for console users, per organisation (C248; built in Workflow 11B by `sso-oidc`, `apps/api/src/operator-auth/oidc/`). SAML and SCIM are not built (C286).

## What was tested, and what was not

- **Tested in-process only**: Okta-, Entra- and Google-shaped discovery documents served by an in-process identity provider in the test suites (`apps/api/src/operator-auth/oidc/*.test.ts`) and in the full-stack spec `e2e/tests/sso-oidc.spec.ts`.
- **Untested**: every real identity provider. Whether your provider works with OpenVerify, and how it is configured, is yours to verify before you enforce SSO.

## Setting up a provider

An admin holding `settings:write` through an organisation-wide assignment adds the provider in the console's Settings → Security, with the step-up. Per provider: the exact issuer (the platform reads the issuer's discovery document itself, and the document's issuer must equal the stored one exactly, or Entra's `{tenantid}` template filled by a `tid` pin), the client id and client secret (stored sealed, never served), the allowed email domains (required), a tenant pin (`tid` or `hd`) for a multi-tenant issuer, optional `required-amr`/`required-acr` values, just-in-time provisioning (off by default) with its default roles, and whether SSO is enforced. Register one redirect URI per provider: `<OPENVERIFY_DASHBOARD_PUBLIC_URL>/sso/callback/<provider id>`, the console's own route; without `OPENVERIFY_DASHBOARD_PUBLIC_URL` no SSO works (`sso_not_configured`).

Discovery and token calls go through the outbound guard: a private address is refused in production unless the install names that exact issuer URL in `OPENVERIFY_SSO_PRIVATE_ISSUERS` (on Kubernetes, also allow it in `networkPolicy.egress.identityProviders`).

## What the platform enforces

- The authorization code flow with PKCE (`S256`), `state` and `nonce`, held in a single-use server-side record of 10 minutes behind a `__Host-` cookie; the ID token's issuer, audience, nonce, expiry and algorithm (RS256, ES256, PS256, EdDSA) are checked, keys come only from the issuer's JWKS.
- **The ID token's signature from the token endpoint is checked**: the library skips that check by default, so the platform forces it on.
- A returning user is matched only by the stored provider, issuer and subject; an email is matched only for the first link of an existing user, inside the allowed domains and with `email_verified: true`.
- A just-in-time default role may hold no organisation-level permission and none of the sensitive permissions C248.5 names.
- With `require-mfa`, a sign-in whose ID token does not meet the provider's `required-amr` or `required-acr` must pass the user's local factor; a provider naming neither never stands in for it. The console's sessions page shows an SSO session's provider `amr` values as the provider stated them, or "None stated" (C248.6; Workflow 11F, KP11-26 and KP11-90); a sign-in that passes the local factor after the provider keeps none.
- Refusals reach the browser as one generic problem; the audit and the logs name the code, and each is counted as `metric: sso_sign_in_refused` ([monitoring.md](monitoring.md)).

## Limits to know

- **Deprovisioning at the identity provider ends console access only at the user's next sign-in or at the console's idle timeout** (`OPENVERIFY_CONSOLE_IDLE_TIMEOUT_SECONDS`, 30 minutes by default; the absolute limit is `OPENVERIFY_CONSOLE_ABSOLUTE_TIMEOUT_SECONDS`, 12 hours). A session already open keeps working until then. End a user's sessions from the console when you remove them.
- **The console's password form sends no organisation hint**; only the API's sign-in route takes one. A user with the same email in several organisations is checked against each.
- **With SSO enforced**, password sign-in is refused except through the break-glass grant `user:allow-password` ([break-glass.md](break-glass.md)).
- OIDC moves authentication to your identity provider; the console's own roles, environments and `pii:view` still decide what a user may do.
