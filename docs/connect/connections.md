# Connections

A connection (`connect/connection`, id `cxn_…`) joins a **source** organisation to a **destination** organisation on one install. There is one connection per ordered pair; a self-connection (source equals destination) is allowed in both environment kinds, for testing without a partner. A connection is organisation-level: it carries the tokens of both environment kinds (sandbox to sandbox, production to production).

## Lifecycle

| Status | Reached by | Who |
|---|---|---|
| `pending` | create (`POST /api/v1/connect/connections`), reactivate, or a new policy version on an active connection | the source |
| `active` | activate, in the console only | the destination's admin |
| `inactive` | deactivate (`POST /api/v1/connect/connections/{id}/deactivate`) | either side |

- **Create** needs `connect-connections:write`, the destination's organisation id and a share policy. A destination that does not exist on the install, or has not turned on `connect-inbound`, answers the same 422 `destination_not_found`: a create is not a way to find out which organisations exist. The source sees the destination's name only from the first activation on.
- **Activate** is the destination's act in the console (`connect-connections:activate`, the built-in `admin` only), with a step-up second factor within the last 10 minutes (an OIDC re-authentication for an SSO session). The admin confirms the policy version shown (409 `share_policy_changed` if it moved meanwhile), enters an agreement reference and acknowledges. An API key cannot activate: the route is not on the server API.
- **Deactivate** expires every `created` token on the connection in the same transaction (`expiry-reason: connection_deactivated`), and a redemption in flight fails at commit with `connection_inactive`. **Ours** (reason: the source API says only that access stops; OpenVerify makes the stop atomic so no token outlives its connection).
- **Reactivate** (the source only) returns the connection to `pending`; the destination must activate again.
- **No deletion.** No route deletes a connection; the record stays for audit.
- `connect-connections:write` and `connect-connections:activate` are organisation-level: a sandbox API key and a user without `environments:production` cannot create, deactivate, reactivate or change the policy.

## The share policy (ours)

**Ours** (reason: the source API leaves what is shared to the products in use; OpenVerify writes it down per connection so the consent and the copy can be checked against it). A policy is a versioned body, frozen per version (`cxnp_…`):

- `purpose`: one value in this release, `share.reuse-kyc`;
- `source-types`: which of `inquiry`, `account`, `transaction` and `verification` may be shared;
- `verifications`: which verification types, and whether their extracted data, check results and files are copied;
- `fields`: allowlists of inquiry, account and transaction field keys (no wildcard, at most 200 each);
- `biometric`: whether selfie images, ID portraits and face-match and liveness results may be shared (`selfie` needs it);
- `peek`: per path, `full` (the value) or `presence` (whether a value exists), `presence` by default;
- `attested-consent`: which source consents the destination accepts, `none`, `non-biometric` (the default) or `all` (see [consent](consent.md)).

Face templates are never shareable, whatever a policy says. A policy that breaks a rule answers 422 `share_policy_invalid` with JSON pointers.

**Versions.** `POST /api/v1/connect/connections/{id}/share-policy` (the source) creates the next version; an active connection returns to `pending` until the destination activates the new version. A `created` token keeps the version it was created under and redeems under it once the connection is active again: nothing is widened for an existing token. The connection serves the current version and `accepted-policy-version`; earlier versions are not served by any route yet, so the console cannot show a diff between versions (open after Workflow 11F; the next release).

The policy states what the platform will copy. It says nothing about what the destination does with a copy.

## The agreement reference (ours)

**Ours** (reason: an activation records an organisational decision, so it cites the agreement behind it). At activation the destination enters `agreement-reference` (1 to 500 characters, sealed at rest): the reference of the data-sharing agreement between the two organisations. Where the destination is established outside the source's jurisdiction, that agreement is where the transfer safeguards are recorded ([the compliance guide](../compliance/README.md)). It is not personal data and must not contain any; the platform stores it and does not judge it. An object's redaction never touches it.

Activation records that a named destination user accepted a stated policy and cited an agreement. It is not the person's consent, which each share needs on its own ([consent](consent.md)).

## Console

Settings → Connect (`/settings/connect`, linked from Settings) lists connections in both directions with status, counterparty and policy version; a connection page shows the policy in words, the agreement reference (destination side) and the actions each side may take. The seeded partner organisation of `seed:dev --connect` ("Example Partner") is a sample, recognised by its seeded names.
