# Sharing verifications (Connect)

Connect lets one organisation (the **source**) share a person's verification data with another organisation (the **destination**) on the same OpenVerify install, with the person's consent, so the destination does not have to collect the same documents again. It is off unless the operator enables it (`OPENVERIFY_CONNECT_ENABLED`, default `false` in the images and the chart), and an organisation receives connections only after its admin turns on its `connect-inbound` setting (default off, audited).

Behaviour labelled "Ours" is OpenVerify's own design, given with its reason; everything else follows the source API's sharing model as `docs/research/phase11-connect.md` records it. The [mapping page](mapping.md) lists the source API's Connect paths against OpenVerify's.

## How a share moves

1. **Connection.** The source creates a connection to the destination organisation with a [share policy](connections.md) (what may be copied). The destination's admin activates it in the console, with a second factor, citing the data-sharing agreement between the two organisations.
2. **Consent.** The person consents to the disclosure: in the source's flow (a `share-consent` step, a witnessed record), or the source's operator attests a consent given elsewhere (an attested record, labelled "not witnessed"). See [consent](consent.md).
3. **Share token.** The source creates a [share token](share-tokens.md) for one object (an inquiry, an account, a transaction or a decided verification), bound to that consent and that connection. The destination is told by the `connect/share-token.inbound-created` event; no data moves yet.
4. **Peek and redeem.** The destination may [peek](peek-and-redeem.md) at what the source holds (values or "present", per the policy), then redeems the token with its own consent record: by API (clone or hydrate) or [client-side](client-side.md), through an inquiry its backend creates for the person.
5. **Provenance.** Every copy carries [provenance](provenance.md): a cloned result is never shown, served or counted as a check the destination ran.

## The trust assumption

Both organisations are tenants of **one install**, run by one operator. The source trusts that install to enforce the policy, the consent and the one-time token; the destination trusts it to report faithfully where each copy came from. The install's operator can read both organisations' data (it holds the keys, `docs/security/crypto-inventory.md`), and moves data between them only on both controllers' instructions (`docs/compliance/roles.md`). Sharing between two installs is not built: see [limits](limits.md).

## What a redemption cannot recall

A redemption copies the data into the destination's own rows. After that:

- withdrawing the consent stops every **future** transfer under it, and tells the counterparty (`connect/share-token.consent-withdrawn`), but recalls nothing already copied;
- redacting the source tells the destination (`connect/share-token.source-redacted`, advisory only) and changes nothing at the destination;
- each copy belongs to the controller that holds it, and its operator decides what its own law requires.

## Pages

| Page | What it covers |
|---|---|
| [connections.md](connections.md) | the connection lifecycle, activation, policies and their versions, the agreement reference |
| [share-tokens.md](share-tokens.md) | lifetime, single use, expiry, environment kinds, the handle model |
| [consent.md](consent.md) | both controllers' records, flow and attested records, the biometric tick, withdrawal (not legal advice) |
| [peek-and-redeem.md](peek-and-redeem.md) | the peek envelope, clone and hydrate, field mappings, account linking, limits |
| [provenance.md](provenance.md) | the provenance marker, `accept-cloned-results`, the binding rule of C235.8 |
| [client-side.md](client-side.md) | redemption through a server-created inquiry and the `share-consent` step on web and Android |
| [events-and-workflows.md](events-and-workflows.md) | the events, webhooks, workflow actions and triggers |
| [mapping.md](mapping.md) | the source API's Connect paths and scopes against OpenVerify's (generated) |
| [limits.md](limits.md) | what Connect does not do, with the reasons |

The routes, their scopes and rate policies are in [the API reference](../api/README.md#connect).
