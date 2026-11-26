# Network data

The network facts of a session (Tor, provider ranges, VPN and hosting networks, country, region and network) and the [`ip-address` report](../reports/ip-address.md) come from public data that the operator syncs into their own install. Nothing from DB-IP, the Tor Project or a cloud provider is committed to this repository or baked into an image (ADR 0006): the operator's sync verifies each publication, records it, and stores it in the database and the object store. Only the hosting and VPN ASN seeds are pinned, through `python3 scripts/fetch_data.py`, like every other static data file.

## Sources

The manifest is `network/sources.json`; its schema test refuses an `http:` URL and the hosts whose terms our licence rule excludes (MaxMind GeoLite, IPinfo Lite, IP2Location LITE, Nominatim, iptoasn, RouteViews). Intervals are provisional, from the research's cadence notes.

| Source | Role | Default | Refresh · stale after | Notes |
|---|---|---|---|---|
| `dbip-country-lite` | country | on | 24 h · 45 days | DB-IP Lite, CC BY 4.0: attribution and a link back (below) |
| `dbip-asn-lite` | ASN and network name | on | 24 h · 45 days | as above |
| `dbip-city-lite` | region and a coarse city point | **off** | 24 h · 45 days | about 60 MB compressed; turning it on fills region, latitude and longitude, distances and the handoff distance |
| `tor-exit-addresses` | Tor exits | on | 1 h · 6 h | the Tor Project's TorDNSEL list, CC0; IPv4 only, as published; an exit counts when seen within 24 h of the list's time |
| `aws-ip-ranges`, `gcp-cloud` | provider ranges | on | 6 h · 7 days | no licence stated; facts published for programmatic use; never redistributed |
| `oracle-public-ip-ranges`, `cloudflare-ips`, `digitalocean-geofeed`, `linode-geofeed` | provider ranges | on | 24 h · 14 days | as above |
| `azure-service-tags` | provider ranges | **off**, import only | none · 21 days | Microsoft's default site terms are personal and non-commercial, and the file name changes weekly; import it only after reading its terms |
| `apple-private-relay` | privacy relay | **off** | 24 h · 7 days | sets the network's `privacy-relay` only; never raises a threat level |
| `openverify-sandbox-network` | sandbox | sandbox only | imported by `seed:dev` · never stale | synthetic: documentation ranges and fictional ASNs ([the sandbox addresses](../checks/sandbox-providers.md#sandbox-addresses)) |

- **Switching sources.** `OPENVERIFY_NETWORK_SOURCES_DISABLED` turns manifest sources off (comma-separated ids, for example `gcp-cloud,aws-ip-ranges`); `OPENVERIFY_NETWORK_SOURCES_ENABLED` turns on the ones the manifest leaves off (`dbip-city-lite`, `azure-service-tags`, `apple-private-relay`). The API, the worker, `seed:dev` and the CLI read both the same way, and reconcile the source rows at startup.
- **The ASN seeds.** X4BNet `lists_vpn` (`input/datacenter/ASN.txt` for hosting, `input/vpn/ASN.txt` for VPNs) and `brianhama/bad-asn-list` (hosting), each pinned by commit and SHA-256 in `data/manifest.json` (MIT). `network/asn-overrides.json` (committed, empty by default) adds or removes ASNs, each with an evidence note. Without the fetched seeds, `is-vpn` and `hosting-asn` are `null` with `list_unavailable`, and `seed:dev` warns, naming `fetch_data.py`. The apps image carries the seeds, each checked against its pin.

## Syncing

```bash
pnpm --filter @openverify/api network:sync                       # every enabled source that is due
pnpm --filter @openverify/api network:sync --source tor-exit-addresses
pnpm --filter @openverify/api network:sync --import <file> --source azure-service-tags   # no request
pnpm --filter @openverify/api network:sync --json                # one JSON line per source
```

Overrides, each recorded on the sync: `--allow-mass-removal`, `--allow-mass-addition`, `--accept-older-publication`. With `OPENVERIFY_NETWORK_REFRESH=true`, the worker runs the same code every 15 minutes (`network-refresh`); it is off by default and never on in CI.

One sync, under a per-source advisory lock (`busy` when another holds it):

1. download into a private directory under the source's byte caps and deadline, following at most one redirect on the request's own scheme, host and port, and inflate under the inflated cap;
2. check the publisher's digest where one exists, then our SHA-256: an unchanged publication is `unchanged`;
3. parse strictly into the normalised snapshot: an MMDB as published, a range or exit list as canonical JSON of sorted, merged intervals; a parse failure is `refused_schema`;
4. under the lock, refuse a publication older than the applied one (`refused_rollback`), more than a quarter of a range or exit set gone or an MMDB under half its applied size (`refused_mass_removal`), or more than a quarter more covered addresses or a prefix shorter than the source's `min_prefix` (`refused_mass_addition`); an empty publication is refused unless `--allow-mass-removal`;
5. write the snapshot object (`network/<source>/<sha256>`) and the `network_syncs` row.

An import makes no request and is recorded with `origin: import`. A failed check backs off from 15 minutes, doubling, up to the source's refresh interval. Snapshot objects other than each source's current and previous one are deleted 7 days after they are superseded. The snapshots are public publications, so they are not envelope-encrypted; every load re-checks the SHA-256 on the sync row.

**Freshness** counts from the last successful check. The Tor exit list also counts from its own publication time, because it alone answers `false`: a publisher that keeps serving a frozen file passes every check, and the list then says nothing about the exits since. A publication with no time of its own (Cloudflare's API, Azure, a geofeed without a stamp) is dated by when it was applied, so it is still read.

A stale, never-checked or unloadable source makes the facts it feeds `null` with `list_stale` or `list_unavailable`, also when another source of its role is fresh: the fresh source's hit is read, but its silence is not, so a fact never reads as "not listed" while a list it depends on was not read. The threat level then stays `null` unless a hit raises it. The console's network sources page (`GET /api/v1/dashboard/network-sources`, `settings:read`) shows each source's state, staleness, last refusal, attribution and terms, the newest syncs, and the pinned seeds with their commits and counts.

## Attribution

DB-IP's CC BY 4.0 terms ask that pages showing its results link back. The line "IP geolocation by DB-IP", linking `https://db-ip.com`, goes wherever an IP location or a distance computed from one is shown: the phone's handoff context screen carries it when it shows the issuing country, the console's session and network views carry it (Workflow 7C builds them, with a component test), and each network's `sources` names the source and its sync. The attribution of every source is in its manifest entry and in `THIRD_PARTY_LICENSES.md`.

## The client address and the trust-proxy setting

The facts describe `request.ip` as Fastify resolves it under `OPENVERIFY_TRUST_PROXY` (C93.1), recorded on each network as `client-address-source`:

- `false` (`socket`): the socket peer. Behind a proxy this is the proxy's address, so every session is evaluated as the proxy. When production sessions keep arriving from private addresses, the API logs a warning saying so.
- a list of addresses or CIDR ranges (`trusted-list`): the address the trusted proxies forwarded. **Prefer this.**
- a hop count (`hop-count`): the API trusts that many proxies, whatever their addresses; it logs a warning at startup, because a client that reaches the API directly can then choose its own address.
- `true` (`trust-all`): the left-most `X-Forwarded-For` entry, which the client writes. In a production environment every network fact is then `null` with `client_address_untrusted`, because the client could choose the address it is judged by.

Private, loopback, link-local and carrier-grade NAT addresses give every fact `null` with `address_not_public`; the documentation ranges answer only in sandbox environments, from the sandbox source.

## IP reputation (`ipReputation`)

The proxy flag comes only from an adapter (C93.5). OpenVerify ships no vendor client: the `mmdb-file` adapter reads an anonymous-IP MMDB the operator licenses, at `OPENVERIFY_IP_REPUTATION_MMDB_PATH` (an absolute path; compose mounts `data/ip-reputation/` read-only at `/var/lib/openverify/ip-reputation` in the API and the worker). It answers locally and sends nothing. It answers `true` when the file flags the address, `false` only when the file positively records a negative, and otherwise `null` with `not_in_provider_data`. Bind it with `OPENVERIFY_PROVIDER_IP_REPUTATION_PRODUCTION=mmdb-file`; the sandbox adapter is refused in production.

## Memory

The API and the worker each keep the current snapshot of every enabled source in memory, re-check the source rows every 60 seconds, and swap one source at a time on a new SHA-256, releasing the old snapshot after the swap. Measured by `network-data` on synthetic files of the live sizes (a Node 22 process, about 96 MiB at rest before any snapshot; `docs/tdd/phase7-network-data.tdd.md`):

| Sources | At rest, over the baseline | Of which MMDB buffers | Extra at a swap |
|---|---|---|---|
| The defaults (Country and ASN Lite, Tor, the six range files) | about 46 to 53 MiB | 17.1 MiB | about 9 MiB (the ASN file) |
| With City Lite | about 168 MiB | 132.6 MiB | about 116 MiB (the City file) |

Each snapshot object is read into one buffer of its known length: joining streamed chunks costs about 70 MiB more at rest with City Lite. Size a host for the steady state plus the largest file's swap.

## What it cannot see

Residential proxies, most VPNs (they rent general hosting and move), mobile carrier ranges, and any address without an adapter's reputation. A hosting-ASN hit is ours and heuristic: it never reaches the public datacenter fields, which come from provider ranges only. A threat level of `low` means "no listed risk found", with a capped confidence and the reason `vpn_list_not_exhaustive` (and `proxy_not_evaluated` without an adapter). See [signals](../checks/signals.md) for how these facts become inquiry signals.
