# TDD record: network-data (Phase 7, Workflow 7A Stage 2)

Owner: `network-data`. Paths: `packages/signals/src/network/` and `packages/signals/src/testing/`.
Contracts: plan C92.3 (parsers, normalised snapshots, memory), C92.6 (ASN seeds), C93.1, C93.3,
C93.4 (lookups and the threat-level evaluation), C93.6 (sandbox values), C111.1 (synthetic data).
Base: `8b7182e2` (Stage 1a final gates). Every command ran after `source scripts/env.sh`, from
`packages/signals` unless stated.

Every address in this file and in the tests is from `192.0.2.0/24`, `198.51.100.0/24`,
`203.0.113.0/24` or `2001:db8::/32`, and every AS number from 64496-64511 or 65536-65551. Tests
that need an address outside them (the special-purpose blocks) derive it at run time from the
block table, and never type one.

## Slice A: addresses, address classes, interval sets (C92.3, C93.1)

- Stub `809de7a6`: `address.ts`, `address-class.ts`, `interval-set.ts`, `errors.ts`, `testing/random.ts`, each name throwing `not implemented`.
- RED: `random.test.ts`, `address.test.ts`, `address-class.test.ts`, `interval-set.test.ts`. They typecheck (`pnpm exec tsc --noEmit`, clean) and lint clean.

```
$ pnpm exec vitest run --coverage.enabled=false src/network src/testing
 FAIL  src/network/interval-set.test.ts [ src/network/interval-set.test.ts ]
Error: not implemented
 FAIL  src/network/address-class.test.ts > classifyAddress (C93.1) > names the four documentation ranges, and only them, documentation
Error: not implemented
 FAIL  src/network/address.test.ts > parseAddress (C93.1: IPv4-mapped IPv6 folded to IPv4) > keys IPv4 in the IPv4-mapped space
Error: not implemented
 ... 17 failed (and the interval-set file, whose module-level setup calls the stub)
```
- GREEN: `seededRandom` (sfc32 from the seed's SHA-256, rejection sampling for ranges), `parseAddress`/`parseNetwork`/`formatKey` over `node:net` `isIP` (zone indexes refused, IPv4 keyed at `::ffff:a.b.c.d`, an IPv6 prefix over the IPv4-mapped space refused, RFC 5952 output), `classifyAddress` over `SPECIAL_BLOCKS` (28 blocks, each with its registry or RFC; IPv6 outside `2000::/3` never public), `IntervalSet` (a sweep over boundaries into disjoint sorted intervals, merged neighbours, interned answers, binary search; canonical JSON with 32-hex keys; `fromJSON` refuses any non-canonical form) and `compareIntervalSets`; `canonicalJson` added as the helper both use.

```
$ pnpm exec vitest run src/network src/testing src/index.test.ts
      Tests  30 passed (30)
 src/network       |   97.11 |    91.87 |   98.03 |   97.33 |
 src/testing       |   97.82 |     90.9 |     100 |   97.67 |
```

## Slice B: the TorDNSEL, range-file and ASN-seed parsers (C92.3, C92.6)

- Stub `1edad7e1`: `tor-exit-list.ts` (`TorExitSet`, `parseTorExitList`, `compareExitSets`), `range-files.ts` (seven parsers), `asn-seeds.ts` (`parseX4bnetAsnList`, `parseBadAsnList`, `buildAsnSets`).
- **The live TorDNSEL format (F27), confirmed from the research note** (`docs/research/phase7-network-data.md` §3.1-§3.2, read 2026-10-27 at `check.torproject.org/exit-addresses` and the CollecTor index; no request was made from this session): one record per relay, `ExitNode <40 hex>`, `Published <YYYY-MM-DD HH:MM:SS>`, `LastStatus <YYYY-MM-DD HH:MM:SS>`, then one or more `ExitAddress <address> <YYYY-MM-DD HH:MM:SS>`, all UTC; CollecTor's archived copies open with `@type tordnsel 1.0` and `Downloaded <time>`; every `LastStatus` read was the top-of-hour consensus (16:00:00) and the file was stamped 16:47; the bulk list held 1,226 IPv4 exits and no IPv6. So the publication time is the newest `LastStatus` (C92.2 step 6), else the newest sighting; an IPv6 `ExitAddress` is counted and not kept.
- RED: `tor-exit-list.test.ts`, `range-files.test.ts`, `asn-seeds.test.ts` (typecheck and lint clean):

```
$ pnpm exec vitest run --coverage.enabled=false src/network/tor-exit-list.test.ts src/network/range-files.test.ts src/network/asn-seeds.test.ts
      Tests  27 failed (27)
     27 x Error: not implemented
```
- GREEN: `text.ts` (strict UTF-8 with the BOM dropped, RFC 4180 fields on one line, the three timestamp forms, labels of printable ASCII), `parseTorExitList` and `TorExitSet` (sorted IPv4 keys, newest sighting per key, `listed(key, windowHours)` against the publication time, canonical JSON), the seven range parsers over one `RangeCollector` (family checked per member, host bits refused through `parseNetwork`, the shortest prefix per family counted for C92.2's `min_prefix`), `parseX4bnetAsnList`, `parseBadAsnList` and `buildAsnSets`.
- Two RED expectations were corrected before GREEN, each a decision now recorded: a range lookup returns its values in canonical JSON order (the Azure test expected insertion order); a geofeed's country and region codes are read case-insensitively and kept upper case (the test refused `zz`; RFC 8805 publishers vary, and a refused file would stop the sync for a cosmetic difference). The refusal case became `Z1`.
- The seed parsers over the pinned seeds fetched locally by `python3 scripts/fetch_data.py` (counts only, nothing printed or kept), matching the research's fact-check and Stage 1a amendment 23:

```
$ node --experimental-transform-types --import ../checks/scripts/register-ts.mjs <scratchpad>/seed-counts.mts
x4bnet-datacenter-ASN.txt entries 947 distinct 933 duplicates 14
x4bnet-vpn-ASN.txt entries 16 distinct 16 duplicates 0
bad-asn-list.csv entries 742 distinct 723 duplicates 19
```

```
$ pnpm exec vitest run src/network src/testing src/index.test.ts
      Tests  57 passed (57)
 src/network       |   95.96 |    89.29 |   99.13 |      96 |
```

## Slice C: the MMDB writer and MMDB access over mmdb-lib (C92.3, C93.5)

- Stub `9c8aacac`: `testing/mmdb-writer.ts` (`writeMmdb`, `mmdbValue`), `network/mmdb.ts` (`MmdbSnapshot`, the four lookups, `anonymousIpAnswer`).
- RED: `testing/mmdb-writer.test.ts` reads every file back with `mmdb-lib`'s own `Reader` (an independent check of the writer: both families, the metadata, more-specific-wins, record sizes 24/28/32, an IPv4-only tree, every data type with 300- and 70,000-byte strings and a 40-member map, identical bytes per spec); `network/mmdb.test.ts` (role checks on open, the separator, `verify`, the lookups, the anonymous-IP answer):

```
$ pnpm exec vitest run --coverage.enabled=false src/network/mmdb.test.ts src/testing/mmdb-writer.test.ts
 FAIL  src/network/mmdb.test.ts [ src/network/mmdb.test.ts ]
 FAIL  src/testing/mmdb-writer.test.ts > writeMmdb (C92.3: our own MMDB writer, read back by mmdb-lib) > writes IPv4 and IPv6 prefixes that the reader finds, with the prefix length
 ...
      Tests  7 failed (7)
      7 x Error: not implemented
```
- GREEN: `writeMmdb` (records deduplicated by their encoding; the tree built shortest prefix first so a longer one splits the record it lands in; nodes numbered breadth first; 24-, 28- and 32-bit records; every data type with the format's size extensions; the metadata map after the marker) and `MmdbSnapshot` (open: marker, `mmdb-lib` `Reader`, format 2, IP version, record size, node count, the database type against the role, the tree inside the file, the 16 zero separator bytes; `verify`: a walk of every node with a visited map, every data pointer inside the data section, each distinct record decoded once through the exact path text and checked against the role; lookups that throw `mmdb` for a record that breaks its role).
- One RED expectation corrected before GREEN: `mmdb-lib`'s `getWithPrefixLength` counts an IPv4 lookup's depth from the IPv4 subtree, so a `/24` reads 24, not 120. The test now also checks an IPv6 `/48`.

```
$ pnpm exec vitest run --coverage.enabled=false src/network src/testing
      Tests  73 passed (73)
```

## Slice D: the evaluation of C93.3 and C93.4, the snapshot pipeline and the sandbox bundle (C92.3, C93.1-C93.6)

- Stub `e72584db`: `lookup.ts` (`evaluateNetwork`, `evaluateClassified`, `networkLookupRules`, `sessionNetworkFacts`, `TOR_EXIT_WINDOW_HOURS`, the reason and field vocabularies), `snapshot.ts` (`NETWORK_PARSERS`, `normalisePublication`, `loadSnapshot`), `sandbox.ts` (`SandboxNetwork`, `isDocumentationAsn`), `testing/sandbox-network.ts` (`SANDBOX_NETWORK`, `sandboxNetworkBundle`), and `MmdbSnapshot.verify(visit)`. `testing/cpu.ts` adds `cpuMilliseconds` (the same measure as `@openverify/checks`', which this package cannot import).
- The public path is tested through `evaluateClassified(input, address, 'public')` with documentation addresses standing in for public ones, so no test names a real address; `evaluateNetwork` itself is tested for its gates (trust mode, address class, environment).
- RED: `lookup.test.ts` (a default install's `low` with capped confidence and its limits; each fact; every null with its reason; stale, missing and broken sources; IPv6; trust-all; every non-public block in both environments; the sandbox source never read in production; one golden per C93.6 address; the rules and the session mapping; a CPU budget of 2,000 evaluations under 2,000 ms), `snapshot.test.ts`, `sandbox.test.ts`, and the visitor case in `mmdb.test.ts`:

```
$ pnpm exec vitest run --coverage.enabled=false src/network src/testing
 FAIL  src/network/lookup.test.ts [ src/network/lookup.test.ts ]
 FAIL  src/network/sandbox.test.ts [ src/network/sandbox.test.ts ]
 FAIL  src/network/snapshot.test.ts > normalisePublication and loadSnapshot (C92.3) > stores a range file as the canonical JSON of its merged intervals, and loads it back
 FAIL  src/network/mmdb.test.ts > MmdbSnapshot.verify (C92.2 step 5: the strict parse of a whole file) > shows a visitor each prefix as a key range, IPv4 in the IPv4-mapped space, with its record
      Tests  7 failed | 74 passed (81)
      9 x Error: not implemented   (the two whole-file failures are module setup calling the stubs)
```
- GREEN:
  - `MmdbSnapshot.verify(visit)`: each prefix as a key range, IPv4 in the IPv4-mapped space, with its normalised record (decoded once per pointer).
  - `sandboxNetworkBundle` (canonical JSON; one exit at `192.0.2.10`, the `example-cloud` range at `192.0.2.20/32`, VPN AS64500 at `192.0.2.30`, a public proxy at `192.0.2.40`, hosting AS64503 at `192.0.2.50`, AS64501 "Example Residential" over `198.51.100.0/24`, AS64502 over `203.0.113.0/24` with two fictional ocean points, AS64504 over the rest of `192.0.2.0/24`, country `ZZ` everywhere including `2001:db8::/48`) and `SandboxNetwork.parse`, which refuses (`sandbox`) any exit, range, proxy or MMDB prefix outside the documentation ranges and any ASN outside 64496-64511 and 65536-65551.
  - `normalisePublication` and `loadSnapshot`: MMDBs stored as published after `verify`; ranges as `{format: openverify-network-ranges, version: 1, published-at, ranges}` canonical JSON; exits as `TorExitSet` canonical JSON; the sandbox bundle as published. `loadSnapshot` refuses a stored JSON object unless its bytes are its canonical form.
  - `evaluateNetwork`/`evaluateClassified`: the gates (production `trust-all`: `client_address_untrusted`; non-public, or documentation in production: `address_not_public`), the public context (every non-sandbox source by role; `list_stale` when a source of the role is stale, else `list_unavailable`) and the sandbox context (the sandbox source alone, never stale), each fact as C93.3 states it, and the threat level exactly as `@openverify/checks`' `sessionThreatLevel` (signal-logic, `55ca83a4`) computes it from the same facts: the same order, confidences (Tor, proxy and provider range 1; VPN ASN and hosting ASN their constants), reasons, evaluated-when-null rule and gap-first null reason.
- Found while going GREEN: `IntervalSet.fromJSON` kept each value as its parser returned it, so a loaded set wrote its members in another order than the built one; it now keeps the canonical form, as `build` does (the round-trip test caught it).

```
$ pnpm exec vitest run src/network src/testing src/index.test.ts
      Tests  112 passed (112)
 src/network       |   94.52 |    88.18 |   99.55 |   94.43 |
  lookup.ts        |   98.78 |    94.04 |     100 |    98.7 |
 src/testing       |   98.18 |       95 |     100 |   98.12 |
```

## Slice E: the synthetic publisher files (C92.3, C111.1)

- Stub `9fe77155`: `testing/publisher-files.ts`, one generator per format.
- RED: `testing/publisher-files.test.ts` runs every generator's output through its own parser (both families, documentation ranges only, documentation ASNs only, repeats dropped, deterministic per seed):

```
$ pnpm exec vitest run --coverage.enabled=false src/testing/publisher-files.test.ts
      Tests  6 failed (6)
      6 x Error: not implemented
```
- GREEN: one seeded generator per format. IPv4 prefixes are drawn inside the three documentation `/24`s, IPv6 inside `2001:db8::/32`; exits are drawn without replacement from the 768 documentation IPv4 addresses (so at most 384 relays), one sighting in five 30 to 72 hours old; AWS service ranges each sit inside a broader `AMAZON` range; ASN seeds draw from the 32 documentation ASNs with chosen repeats; countries are ISO 3166-1 user-assigned codes (`ZZ`, `XA`, `XB`, `QM`), points open ocean in the South Pacific (20-40 S, 120-150 W).
- One RED expectation corrected before GREEN: the country check expected `Z?` codes; only `ZZ` among them is user-assigned, so the generators use the user-assigned set and the test checks for it.

```
$ pnpm exec vitest run src/network src/testing src/index.test.ts
      Tests  118 passed (118)
 src/testing       |   98.61 |       92 |     100 |   98.53 |
```

## Slice F: the steady-state and peak-swap memory measurement (C92.3)

- Stub `12335935`: `testing/memory-measurement.ts` (`MEASURED_SOURCES`, `writeMemoryFiles`, `measureScenario`).
- RED: `testing/memory-measurement.test.ts` at a scale of 0.001 (files padded to the measured sizes and opening for their roles, range and exit snapshots with the measured counts, a report per scenario):

```
$ pnpm exec vitest run --coverage.enabled=false src/testing/memory-measurement.test.ts
 FAIL  src/testing/memory-measurement.test.ts [ src/testing/memory-measurement.test.ts ]
Error: not implemented
```
- GREEN: `writeMemoryFiles` (Country and ASN MMDBs padded to 8,348,509 and 9,566,363 B, City Lite to 121.1 MB with 28-bit records, a second copy of the ASN and City files for the swap; range snapshots with the measured prefix counts as distinct `/64`s inside `2001:db8::/32`, stored as `normalisePublication` stores them; the 768 documentation IPv4 exits), `measureScenario` (baseline after a double collection, every snapshot read, its SHA-256 taken and loaded as `loadSnapshot` loads it, the steady state, then the swapping source loaded beside the current one, swapped and released), and the command line that writes the files in one child and measures each scenario in a fresh child.
- Found while measuring: a child forked from the large parent reported the parent's size as its own peak (Linux carries `ru_maxrss` across `fork` and `exec`): every scenario read 428 MB before its swap. The parent now writes nothing itself. And a released buffer stayed in the RSS until a second collection a turn later, so the measurement collects twice.

### The memory measurement (C92.3), two takes, at loads 2.0 to 2.7

Command, from `packages/signals`: `node --expose-gc --experimental-transform-types --no-warnings --conditions=@openverify/source --import ../checks/scripts/register-ts.mjs src/testing/memory-measurement.ts <empty dir>` (48 s). RSS of a Node 22 process; the baseline (about 96 MiB) is the process with this package's modules loaded through the TypeScript hook, before any snapshot.

| Scenario | Snapshot bytes | Steady over baseline | of which MMDB buffers | Peak over steady during the swap | Peak RSS |
|---|---|---|---|---|---|
| Default sources (Country, ASN, Tor, six range files), ASN swaps, one read | 19.1 MiB | 52.9 / 45.8 MiB | 17.1 MiB | 9.1 / 9.1 MiB | 157.7 / 150.1 MiB |
| the same, read as streamed chunks and `Buffer.concat` | 19.1 MiB | 54.1 / 54.1 MiB | 17.1 MiB | 15.0 / 15.0 MiB | 164.8 / 164.8 MiB |
| City Lite enabled, City swaps, one read | 134.6 MiB | 168.0 / 168.8 MiB | 132.6 MiB | 115.5 / 115.5 MiB | 379.2 / 380.6 MiB |
| the same, streamed | 134.6 MiB | 239.1 / 240.5 MiB | 132.6 MiB | 155.0 / 154.8 MiB | 489.9 / 491.1 MiB |

(Take 1, `memory-run-3`, in bytes: steady deltas 55,492,608 / 56,692,736 / 176,185,344 / 250,728,448; swap peaks 9,568,256 / 15,728,640 / 121,110,528 / 162,557,952; peak RSS 165,404,672 / 172,814,336 / 397,660,160 / 513,687,552. Take 2, `memory-run-4`, is the second figure of each pair above.)

What the figures say:
- The research's "about 18 MB" for the two default MMDBs holds: 17.1 MiB of buffers. The process holds about 46 to 53 MiB over its baseline for every default source, because the JS heap of the range sets and the parsing leaves its own share (16.6 MiB heap in use).
- A swap adds one copy of the swapping file while both are held, and returns to the steady state after: City Lite needs about 115 MiB more at its swap (the research's "roughly double" of its 121 MB at rest is the peak: 169 MiB at rest plus 116 MiB at the swap, 285 MiB over the baseline).
- Reading an object as streamed chunks joined with `Buffer.concat` costs about 70 MiB more at rest with City Lite and about 40 MiB more at its swap, because the chunks' memory stays in the process. The loader should read a snapshot into one buffer of its known length (`api-network`'s choice; recorded in the handoff).

```
$ pnpm exec vitest run src/network src/testing src/index.test.ts
      Tests  121 passed (121)
```

## Coverage pass

Tests of behaviour already built (they passed when written, so they carry no RED): `canonical.test.ts`, and in `mmdb.test.ts` the 28- and 32-bit trees, an IPv4-only tree's visitor, twelve role refusals (names, lengths, control characters, points, subdivisions, flags), a city record with empty parts, a marker without metadata and a record pointing past the data section.

```
$ pnpm exec vitest run src/network src/testing src/index.test.ts
      Tests  127 passed (127)
 src/network       |   96.15 |    91.02 |     100 |   96.04 |
  mmdb.ts          |    93.5 |    91.92 |     100 |   93.26 |
```

## Timings (under `/tmp/openverify-e2e.lock`, one hold, load 1.86 at the start and 1.81 at the end)

A scratch script (not committed; its body is the loops below) over this package's sources:
- `evaluateClassified` over the sandbox snapshots in every role, four addresses in turn (IPv4 listed and unlisted, a city point, IPv6), after 2,000 warm-up calls: **100,000 calls in 1,839 ms of CPU, 18.4 us per call** (C93.2's budget is 1 ms).
- `writeMmdb` of 710,834 prefixes (DB-IP Country Lite's record count, as consecutive `/64`s inside `2001:db8::/32`): 4,265,655 bytes in 17,924 ms of CPU (a test-data tool; the sync never writes an MMDB).
- `MmdbSnapshot.verify` of that file: 710,887 nodes, 710,834 prefixes, 2 distinct records, **186 ms of CPU**. The real file has more distinct records (country by country), each decoded once, so a sync's strict parse of Country Lite stays well under a second on this machine; City Lite's 7.8 million records were not measured.

## Final gates (foreground, load 1.77 to 2.35)

```
$ pnpm --filter @openverify/signals typecheck
$ tsc --noEmit                                   (clean)
$ pnpm --filter @openverify/signals lint
$ eslint .                                       (clean)
$ pnpm --filter @openverify/signals test
 Test Files  23 passed (23)
      Tests  184 passed (184)                    (the whole package, client-collector's browser tests included)
All files          |   96.31 |    91.07 |   98.68 |   96.18 |
$ pnpm typecheck
 Tasks:    15 successful, 15 total               (44.9 s)
$ pnpm lint
 Tasks:    15 successful, 15 total               (2 min 11 s)
$ pnpm format:check
All matched files use Prettier code style!
```

The vocabularies of `lookup.ts` were also checked against the contracts once, by a throwaway test in `apps/api` (created and deleted in the same command, never committed): `NETWORK_NULL_REASONS` and `NETWORK_EVIDENCE_REASONS` are subsets of `SIGNAL_NULL_REASONS` and `SIGNAL_EVIDENCE_REASONS`, and `NETWORK_FACT_FIELDS` equals the contracts' `NETWORK_FACT_FIELDS`. This package cannot import `@openverify/contracts`, so that check belongs in `apps/api` (see the handoff).
