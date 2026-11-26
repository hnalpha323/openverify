# TDD evidence: Workflow 7A Stage 2, `signal-logic` (Phase 7)

- **Slice owner:** the Workflow 7A Stage 2 `signal-logic` agent. It owns `packages/checks/src/signals/` only.
- **Date:** 2026-10-30.
- **Base:** `8b7182e2` (Stage 1a's final gates). This agent's commits run from `9c4c9560` to the commit that adds this file.
- **Input:** the plan's `signal-logic` bullet (C90.2, C90.4, C90.7's `on-null` defaults, C93.4, C94.5, C94.8, C95, C96.7), with the Stage 1a amendments 14-17 (constants in the core registry, the `signal-details` shape, the flow body as frozen).

Each change follows the same cycle:
1. A stub (`chore`), only where a test needs a name that does not exist yet, so the RED commit compiles and typechecks.
2. The test, run to see it fail for the intended reason (RED, `test` commit).
3. The smallest change that passes it (GREEN, `feat` commit), then a refactor with the suite green.

Every command ran after `source scripts/env.sh`, from `packages/checks` unless stated. Output is trimmed to the lines that matter. Every fact in these tests is synthetic: ASNs 64501 and 64502, the sandbox country `ZZ`, points in open ocean, the poles and the antimeridian, and no address (C111.1). The only real country codes (`FR`, `DE`, `JP`, `US`) appear in the time-zone tests, where the runtime's ICU data supplies the zones.

## 0. Stubs (`9c4c9560`, `34911856`, `d3398525`)

These commits hold the module surface with throwing bodies. Two pieces landed real, because the signatures need their types:
- **The reason mirrors** in `vocabulary.ts` (see slice C for the test that ties them to the contracts).
- **The input types** in `inputs.ts`.

`34911856` renamed the per-screen evidence group from `timing` to `screens`, and stubbed `IDENTITY_FIELD_STEP_TYPES` and `BehaviourRules.groups`, which the slice B tests name. `d3398525` stubbed `matchSignalReviewRules`. After each one, `pnpm exec tsc --noEmit` and `pnpm exec eslint src/signals` were clean.

## A. User agent, request facts and distances (C94.5, C94.8 V13, C95, C96.7)

RED `7bc82228`; GREEN `d575df5f`.

RED:
```
$ pnpm exec vitest run src/signals --coverage.enabled=false
     × maps bowser's platform types to the session device types
     × golden: Chrome on Windows · × golden: Safari on an iPhone · ... (7 goldens)
     × reads the SDK header exactly, with no library
     × keeps the Accept-Language tags in preference order, at most five
     × golden: one degree on the equator · ... (9 distance goldens)
     × refuses a coordinate outside its range or not finite
     × measures IP to IP and compares country and ASN
 Test Files  3 failed (3)
      Tests  33 failed | 1 passed (34)
  (17 × Error: not built; AssertionError: expected error to be instance of RangeError;
   AssertionError: expected {} to deeply equal { desktop: 'desktop', …(3) })
```

The one test that passed checks `EARTH_MEAN_RADIUS_METERS`, which the stub already declared.

**Golden values.** The distances were computed independently in Python (haversine, R1 = 6,371,008.8 m) before the implementation:
- one degree on the equator: 111,195 m;
- half the equator, and pole to pole: 20,015,114 m;
- across the antimeridian: 111,195 m;
- a grid step in the South Pacific: 139,689 m;
- two open-ocean points: 2,407,661 m.

**GREEN.** The first run had 13 failures for two reasons:
- The write of `user-agent.ts` had been refused because the file had changed on disk, so it still threw `not built`.
- One distance fixture was ambiguous. Two point pairs were equally far apart (mirror images across the equator), so "the farthest pair" had two answers. I moved one fixture point to (-12, -141); the Python check gives a single farthest pair, b-d, at 15,614,564 m.

After those fixes, the same command passed: `Tests 34 passed (34)`; `tsc --noEmit` and `eslint src/signals` were clean.

## B. Threat level, cross-layer rules, evidence, bot score and behaviour level (C93.4, C94.8, H04, H06, H24, P24)

RED `7626400e`; GREEN `55ca83a4`.

The three rule-table digests were pinned in the RED test before any table was written: `1:5dab7aefa24189e9` (bot score), `1:f8b98aa6eb4139a8` (behaviour) and `1:0902dd0b3a363f89` (threat level). Each is computed by an independent Python script from the canonical JSON of the tables as designed (keys sorted, no spaces, as the core registry's golden test does), and is pinned beside the registry version. The golden confidences came from the same formula, written in Python from C43's `heuristicConfidence`:
- bot score: 0.6667 (90 against the 70 band), 1, 0.6429 (25), 0.1429 (voice control, 60) and 0.45 (keyboard only, 35, 4 of 5 groups);
- behaviour level: 0.6667 (untrusted input), 0.5834 (the same at 3 of 4 groups), 0.875 (voice control) and 0 (medium exactly at the cap).

While writing the tests, before the RED commit, I corrected three expectations that I had derived wrongly:
- a Linux headless user agent beside Windows hints also fires the hints rule, so the fixture became a Windows headless user agent;
- request headers make the cross-layer group count as collected even without an integrity member;
- the low band may reach 20 points from weak evidence (4 × 5), not under 10.

RED:
```
$ pnpm exec vitest run src/signals/threat-level.test.ts src/signals/consistency.test.ts src/signals/evidence.test.ts \
    src/signals/bot-score.test.ts src/signals/behaviour.test.ts src/signals/rules.test.ts --coverage.enabled=false
 Test Files  6 failed (6)
      Tests  72 failed | 1 passed (73)
     61 Error: not built
      AssertionError: expected '1:4f53cda18c2baa0c' to be '1:0902dd0b3a363f89'   (and the two other digests)
      AssertionError: expected [] to deeply equal [ 'strong:webdriver', …(17) ]  (and the other tables)
```

GREEN, in order:
- **Threat level:** 16 of 18 passed, and its digest matched the Python pin.
- **Cross-layer rules:** one RED case was wrong. The case paired an SDK user agent with both the page's and the headers' hints, and expected nothing to be compared. But comparing the two sets of hints with each other needs no user agent. I narrowed the case to one set of hints, which leaves nothing to compare (`consistency.test.ts`, changed in the GREEN commit). After that, 14 passed.
- **Evidence:** 5 passed.
- **Bot score:** 28 passed with the digest matching. `provisionalDefault` is not exported from the core entry, so `bot-score.ts` builds its two provisional constants the same way locally.
- **Behaviour level:** the digest matched.

```
$ pnpm exec vitest run src/signals --coverage.enabled=false
      Tests  107 passed (107)
```

## C. The inquiry signals from stored facts (C90.2-C90.5, C95.4, H05)

RED `cd69080d`; GREEN `c5c15834`; refactor `63b92b31`.

RED:
```
$ pnpm exec vitest run src/signals/compute.test.ts src/signals/vocabulary.test.ts --coverage.enabled=false
 Test Files  2 failed (2)
      Tests  39 failed | 1 passed (40)
     37 Error: not built
      AssertionError: expected [ 'signals_not_collected', …(18) ] to deeply equal [ 'signals_not_collected', …(17) ]
      AssertionError: expected [ 'address_not_public', …(17) ] to deeply equal [ 'address_not_public', …(18) ]
```

The two vocabulary failures were a bug in the test, not the intended RED. The parser's pattern `[a-z_]+` missed `ipv6_not_covered`, which has a digit. I fixed the pattern to `[a-z0-9_]+` before the commit, and then the three vocabulary tests passed.

The vocabulary tests pass at RED by construction: the mirrors landed with the stub because the signatures needed their types. These tests guard against drift; they are not a RED of their own. The committed RED therefore has the 37 `not built` failures of `compute.test.ts`.

The first GREEN run had all 147 tests passing but did not typecheck. The behaviour combiner's discriminated union needed explicit types (`LevelledBehaviour`, `SessionBotScore`), and lint asked for the unused set and a boolean comparison to go.

```
$ pnpm exec vitest run src/signals --coverage.enabled=false
      Tests  147 passed (147)
```

**Contract probe** (a scratch script outside git, removed afterwards). It imports `computeInquirySignals` and the real `signalDetailsSchema` and `signalAttributeIssues` from `packages/contracts/src/signals.ts`. Over 300 seeded random inquiries:
- 0 to 3 sessions each;
- consented or not;
- the tier on or off;
- clean, Tor, IPv6, VPN with a point, or adapter-negative networks with a provider range;
- human, automated or sandbox bodies;
- the sandbox or the production environment.

```
runs 300, contract violations 0
```

**Refactor `63b92b31`.** The first probe run failed with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`: Node's strip-only loader, which this package's own `calibration:report` script uses, refuses a constructor parameter property. `InquirySignals` now assigns a plain field instead. The suite stayed green at 147.

## D. The review-rule matcher with the `on-null` defaults (C90.7, H03, V01)

Stub `d3398525`; RED `536071a6`; GREEN `b611ee56`.

RED:
```
$ pnpm exec vitest run src/signals/review-rules.test.ts --coverage.enabled=false
      Tests  7 failed (7)
      7 Error: not built
```

The cases follow the plan's C90.7 list:
- a matching rule;
- a stale exit list with a Tor rule goes to review;
- an IPv6-only session with a Tor rule stays;
- a stale-list session beside an IPv6 session goes to review (derived);
- the rule's `on-null` overrides the default;
- the cause is recorded;
- an operand of the wrong type does not match.

At GREEN, lint flagged `byValue` as always falsy, because a `forEach` closure hides the assignment from TypeScript's narrowing. A `for … of` loop fixed it.

```
$ pnpm exec vitest run src/signals --coverage.enabled=false
      Tests  154 passed (154)
```

## Final gates (foreground)

```
$ cat /proc/loadavg            8.66 13.72 16.61
$ pnpm --filter @openverify/checks typecheck         real 0m17.9s   (pass)
$ pnpm --filter @openverify/checks lint              real 0m53.0s   (pass)
$ cat /proc/loadavg            7.05 12.28 15.90
$ pnpm --filter @openverify/checks test              real 0m30.7s
 Test Files  174 passed (174)
      Tests  3464 passed (3464)
All files          |   98.74 |    91.51 |   99.38 |   98.72 |
 src/signals       |   98.98 |    94.21 |     100 |   98.87 |
$ cat /proc/loadavg            11.35 12.82 15.97
$ pnpm typecheck               Tasks: 15 successful, 15 total   real 1m12.4s
$ pnpm lint                    Tasks: 15 successful, 15 total   real 2m08.6s   (load 10.30 12.11 15.44)
$ pnpm format:check            All matched files use Prettier code style!   real 0m54.4s
$ pnpm --filter @openverify/watchlist benchmark:typecheck   (pass, 25.4 s)
```

No file the watchlist benchmark imports was changed. I ran its typecheck anyway, because `@openverify/checks`' entry now re-exports the signal modules.
