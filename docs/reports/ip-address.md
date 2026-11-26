# IP address report (`report/ip-address`)

The network facts of one IPv4 or IPv6 address: whether it is a listed Tor exit, in a cloud provider's published ranges, on a VPN or hosting network, flagged by an IP reputation file, and its country, region and network. **Tiers:** R for Tor, provider ranges, geolocation and ASN; H for the VPN and hosting-ASN flags; A for the proxy flag (`ipReputation`). **Stage:** `beta`. There is no review: `has-match` is always `false`, and our own `flagged` says whether any of Tor, VPN, proxy or a provider-range datacenter is true. See [the reports overview](README.md) for what every type shares.

## Running it

- **Query:** `ip-address`, one IPv4 or IPv6 host. A CIDR range, a netmask or a zone index is refused with 422. An IPv4-mapped IPv6 address is read as its IPv4 address.
- **On inquiry completion** (query source `inquiry_session`): the address of the inquiry's first session whose network was evaluated, with `client-address-source` saying how the API resolved it (`socket`, `trusted-list`, `hop-count` or `trust-all`, C93.1). An inquiry with no evaluated session gives the run `errored` with `insufficient_input`.
- **Template:** `seed:dev` publishes "Default IP address" in each environment. The type has no template settings of its own beyond the shared ones; it runs once (`report-config` one-off).
- **Events:** `report/ip-address.ready`, `.errored` and `.redacted`, the three the review model `none` derives.
- **The worker** answers from the network snapshots it holds in memory, loaded from the operator's syncs, and from the `ipReputation` adapter bound for the report's environment kind. It makes no request.

## What a result means

| Field | Meaning |
|---|---|
| `tor-exit-node` | `MATCHED` when the address is a listed exit. `CLEARED` only for a public IPv4 address checked against a fresh exit list. Otherwise `null`, listed in `unavailable-fields` with its reason: `ipv6_not_covered` (the published list has no IPv6 exits), `address_not_public`, `client_address_untrusted`, `list_stale` or `list_unavailable`. A stale or unavailable exit list ends the run `errored`; the report is never `ready` with Tor unchecked. |
| `datacenter-ip`, `service-type` | `true` and `DATACENTER` only when the address is in an enabled provider's published ranges; otherwise `null` with `not_in_known_ranges`, never `false`, because the lists are not exhaustive. A hosting-ASN hit never reaches these fields. |
| `vpn-detected` | H: `true` when the ASN is in the VPN seed or the overrides; otherwise `null`. Most VPNs rent general hosting, so most VPN exits are invisible to it. |
| `proxy-detected` | A: the `ipReputation` adapter's answer; `null` with `provider_not_configured` when none is bound, and `false` only when a bound adapter's file records a negative. |
| `isp`, `country-code`, `country-name` | From DB-IP's ASN and Country Lite files, approximate. |
| `city`, `region`, `latitude`, `longitude` | From DB-IP City Lite, only when the operator enables it; otherwise `null` with `list_unavailable`. |
| `mobile-ip` | Always `null` (`no_adapter`): no permissive source answers it. |
| `flagged`, `hosting-asn`, `client-address-source`, `field-details` | Ours: the union of the flags, the hosting-ASN flag with its confidence, how a completion report's session address was resolved, and each field's tier, confidence (H only) and reasons. |

Every network source read is in `sources`, with its sync id, publication time and SHA-256. Wherever a location from DB-IP is shown, the line "IP geolocation by DB-IP" links to `https://db-ip.com` (CC BY 4.0).

## Sources and freshness

The facts come from [the network data](../network/README.md) the operator syncs: DB-IP Country and ASN Lite (and City Lite when enabled), the Tor Project's exit list, the cloud providers' published ranges, and the pinned hosting and VPN ASN seeds (`python3 scripts/fetch_data.py`). Freshness counts from each source's last successful check:

- a stale or never-synced **exit list** ends the run `errored` with `list_stale` or `list_unavailable`, naming `tor-exit-addresses`, and keeps the other fields it found;
- any other stale or missing source leaves its fields `null`, listed in `unavailable-fields` with `list_stale` or `list_unavailable`;
- without the fetched ASN seeds, `vpn-detected` and `hosting-asn` are `null` with `list_unavailable`.

A production environment never reads the sandbox source. In a sandbox environment, the documentation ranges answer from it alone: [the sandbox addresses](../checks/sandbox-providers.md#sandbox-addresses) give one result each (`192.0.2.10` a Tor exit, `192.0.2.20` a provider range, `192.0.2.30` a VPN ASN, `192.0.2.40` a proxy through the sandbox adapter, `192.0.2.50` a hosting ASN only, `198.51.100.0/24` a residential network, `2001:db8::/48` IPv6), which `e2e/tests/ip-address-report.spec.ts` runs end to end.

## Limits

- **What it cannot see.** Residential proxies, most VPNs (they rent general hosting and change it), mobile carrier ranges, and any address without an adapter's reputation. `null` means "not in the lists we hold", never "clean"; the console words it so.
- **IPv6 and Tor.** The exit list has no IPv6 exits, so an IPv6 address is never `CLEARED`.
- **Locations are approximate.** DB-IP Lite publishes no accuracy radius; a city point is a coarse estimate (`IP_CITY_UNCERTAINTY_METERS`, 50,000 m, unmeasured and provisional), and a country is wrong for VPNs, roaming and corporate egress.
- **Non-public addresses.** Private, loopback, link-local, carrier-grade NAT and other non-global addresses give every field `null` with `address_not_public`; so do the documentation ranges in a production environment.
- **A client-chosen address.** Under `OPENVERIFY_TRUST_PROXY=true` (`trust-all`) in production, a completion report's session address could have been written by the client, so every field is `null` with `client_address_untrusted`.
- **No decision.** The report never passes, fails or declines anything (ADR 0006); an operator reads it with the inquiry.
