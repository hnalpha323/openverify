# Lists: the Workflow 11D calibration (owner decisions 3 and 4 after Workflow 7B)

This report holds Workflow 7B's two list calibrations, which owner decisions 3 and 4 after Workflow 7B
require before any provisional list constant changes: the fuzzy-name candidate cap, and the face and
background list thresholds with the cost of a cold face list. It is written by
`calibration-matcher-11d`, alone on the machine, with the tools `load-harness` builds
(`apps/api/scripts/lists-benchmark.ts` and `packages/checks/scripts/calibration-report.ts --face-list`,
run on the host, never in an image). **Status: published** (results below). The Method below was committed by
`contracts-11d` (the commit whose subject contains "Workflow 11D contracts-11d checkpoint method")
before any take and before any seed; a change made after it is listed under "Amendments" with its
reason. No threshold or cap is tuned on test data, and none changes without the rule below.

## Method

### Timing rule and configuration

As `docs/calibration/watchlist-phase11.md`: under `flock -E 75 -w 240 /tmp/openverify-e2e.lock`, one
step per lock hold, the load stack stopped and nothing else running; a timing counts only when the
1-minute load is at most 4 at its start and its end; three takes and the median, every take listed
with its loads. The Postgres is the benchmark's own Testcontainers one (`startIntegrationPostgres`,
the C73.8 flags). One fresh seed, drawn with `openssl rand -hex 16` after this method is committed.

### (h) The fuzzy-name candidate cap (owner decision 4 after 7B)

`fuzzy-name-candidate-cap` (`LIST_MATCH_CONSTANTS`, `packages/core/src/lists.ts:337`; 2,000,
provisional). A list probe whose candidates exceed the cap answers `unscreened` with
`limit_exceeded`, never "no match". 7B measured 117 of 300 probes over it on a synthetic
1,000,000-item list (probe p50 616 ms, p95 971 ms; `docs/tdd/phase7-api-lists.tdd.md:98`).

- **Lists:** name lists with `allow-fuzzy-name-first` of **100,000 and 1,000,000 items**, drawn from
  `@openverify/watchlist/testing`'s heavy-headed law (Zipf, exponent 1; never held-out data), with
  **150 planted namesakes** (probes whose listed item they should find) and **150 unlisted probes**.
- **Caps:** 2,000 (today), 5,000 and 10,000, three takes each at each size.
- **Per take:** the share of probes `limit_exceeded` (with a Wilson interval), the probe p50 and p95
  with the share spent unsealing items, the process's peak memory, the planted namesakes found, and
  the SHA-256 of the created matches of every probe screened under both caps compared (identical by
  construction, since the C78 scorer and threshold do not change; **a difference is a defect** for
  `fix-11d`, never a trade).
- **The rule that recommends a larger cap (fixed here):** the largest cap whose probe p95 at
  1,000,000 items is at most **1.5 times** the 2,000 cap's p95 in the same calibration, whose peak
  memory stays within **512 MiB** above the 2,000 cap's, and whose digests are identical. Basis: a
  list probe runs inside the asynchronous `list-screen` job, held by the per-environment queue cap
  (C251), so 50% more time a probe is absorbed by the queue without a user waiting on it, while
  512 MiB is half the API's and a third of the worker's chart memory limit; the ratio is relative to
  this machine's own figure, so it does not depend on its speed. **If no larger cap meets the rule, or
  the rule has no basis the figures support, 2,000 stays**, with the figures. A recommended cap
  changes only through `fix-11d` (or the owner), never by the calibration agent.

### (i) The face and background list thresholds and the cold list (owner decision 3 after 7B)

`face-list-threshold` 0.5 and the background thresholds (candidates 5, inliers 100, ratio 0.5,
coverage 0.25), all provisional in `LIST_MATCH_CONSTANTS`. A list-specific calibration gates general
availability.

- **Face lists.** From Phase 4's pinned calibration set and measurements (`docs/calibration/selfie-phase4.md`;
  707 identities of studio portraits, public-domain faces through the existing manifests, never a
  customer's data), `calibration-report.ts --face-list` computes, at **gallery sizes 1,000 and
  10,000** (10,000 is a face list's item cap): the **false positive identification rate per search**
  (a non-mated search that returns any gallery item at or above the threshold) and the **false
  negative identification rate** (a mated search whose mate is not returned), each with a **95%
  bootstrap interval over identities** (1,000 replicates, the seed above), at **0.5** and at the
  threshold the rule picks.
- **The rule (fixed here):** 0.5 **stays** when the upper end of its FPIR interval at gallery 10,000
  is at most **1%**; otherwise the rule picks the lowest threshold whose FPIR upper end at 10,000 is at
  most 1%, reported with its FNIR, and recommended to `fix-11d` and the owner. Basis: a face-list hit
  routes a person to review; 1% of searches flagged at the largest gallery is the share a review team
  can absorb, and the interval's upper end (not the point) keeps the claim conservative. **The domain
  is stated**: studio portraits, not handheld selfies against a list photo; the figures say nothing
  about the latter.
- **Background lists: `not-calibrated`.** No public-domain, CC0 or CC-BY set of same-backdrop and
  different-backdrop pairs is pinned through a manifest (Stage 1a amendment 18), so the background
  thresholds are not calibrated in this release and stay provisional: an open line of the release
  checklist and of the release notes, never a silent pass.
- **The cold list:** a worker with an empty template cache opening a full **10,000-template face
  list** (809 B a template in the cache, at most 64 MB a worker): wall time, CPU time and peak memory,
  three takes, reported.

### (j) Not calibrated here, with the reason

- The address key's per-country handling of W, Ct and Pl: a recall gain only, which would change
  `LIST_KEYS_VERSION` and the graph's address key, and needs labelled pairs this Workflow does not
  have: **next release**.
- A parser-backed PDF page count for transaction files: Workflow 11B's (`ingestion-11b`), not 11D's.

## Seed, tools and machine

- **Seed** `eab27c87c9d0b1e0079eb4aaf2aabe76` (amendment 1), drawn at 2026-11-17T13:19:57Z after the
  method commit `ac3fc155`; the face-list bootstrap seed is `$((16#eab27c87))` = 3937565831.
- **Tools** from the head worktree at `2d3134755` (`apps/api/scripts/lists-benchmark.ts`,
  `packages/checks/scripts/calibration-report.ts --face-list`) and the scratch probe of amendment 3;
  the benchmark's own Testcontainers Postgres (`pgvector/pgvector:pg17@sha256:cf134a76…f8e6f`, the
  C73.8 flags), one container, the load stack down, nothing else running, every e2e-lock wait 0.0 s.
- **Machine:** as `watchlist-phase11.md` (Intel Xeon E5-1650 v3, 12 logical CPUs, 31.3 GiB, WSL2 on a
  SATA SSD, Node v22.22.1). Run 2026-11-17 20:41 to 21:28 UTC; outputs under
  `/tmp/openverify-eval-11d/lists/` and `log-lists.txt` (outside git).
- **Face measurements:** Phase 4's `fixtures/generated/calibration/selfie-measurements.json`
  (SHA-256 `22aba3b9fbf9f21d760560e6b56df6c31a6164aebe2378035dbc3f0868e6aa94`; 707 identities, public-domain
  studio portraits through the existing manifests), read as given; no held-out data was read.

## Verdicts

| Row | Rule | Figures | Verdict |
| --- | --- | --- | --- |
| `fuzzy-name-cap` | the largest cap within 1.5 × the 2,000 cap's p95 at 1,000,000 items, within +512 MiB, with identical digests, else 2,000 | at 1,000,000 items: p95 434.0 ms (2,000), 585.8 ms (5,000; 1.35 ×), 886.1 ms (10,000; 2.04 ×); peak RSS 577, 717 (+140 MiB) and 946 MiB; digests identical for every probe both caps screened | **5,000 recommended** (`limit_exceeded` 38.0% → 31.7% of probes; planted namesakes found 93 → 102 of 150); 2,000 stays in the code until `fix-11d` or the owner changes it |
| `face-list-threshold` | 0.5 stays while FPIR's upper end at gallery 10,000 is ≤ 1% | at 0.5: FPIR at 10,000 3.93% (0.00–21.40%), at 1,000 0.40% (0.00–2.38%), FNIR 0.95% (0.39–1.66%) | **0.5 does not meet the rule; 0.72 recommended**, with FNIR 25.3% (21.9–28.8%) and FPIR 0 (0–0) at both gallery sizes |
| `background-list-thresholds` | a licensed pair set through a pinned manifest | none pinned | **Not calibrated** (stays provisional; release checklist) |
| `cold-face-list` | reported | 10,000 templates: open 751.0 ms median (869.7 / 738.0 / 751.0), CPU 735.1 ms median, cache 8.12 MB, process peak RSS 336 to 386 MiB | **Reported** |

## Results

### (h) The fuzzy-name candidate cap

`lists-benchmark --measure --probes 300 --cap <n>` (300 probes from the law, the list's health ten
times first), three takes per cap and size, caps rotating. Every take met the timing rule.

| Items | Cap | Probe p95 (ms), takes 1 / 2 / 3 | Median p95 | Median p50 | Peak RSS (MiB) | Loads (start → end) | `limit_exceeded` (of 300) | Fuzzy matches |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 100,000 | 2,000 | 180.6 / 183.5 / 186.7 | 183.5 | 59.3 | 572 / 570 / 613 | 1.8 → 2.0; 1.8 → 1.8; 2.1 → 2.3 | 56 · 18.7% (14.7–23.5%) | 955 |
| 100,000 | 5,000 | 318.8 / 319.4 / 328.5 | 319.4 | 55.0 | 753 / 748 / 709 | 1.8 → 1.8; 1.9 → 1.7; 2.0 → 2.8 | 26 · 8.7% (6.0–12.4%) | 3,395 |
| 100,000 | 10,000 | 594.7 / 594.8 / 603.3 | 594.8 | 54.8 | 1,065 / 1,063 / 1,047 | 1.7 → 2.2; 1.7 → 2.6; 1.8 → 2.1 | 0 · 0% (0–1.3%) | 9,212 |
| 1,000,000 | 2,000 | 429.0 / 434.0 / 447.7 | **434.0** | 321.6 | 534 / 577 / 577 | 1.7 → 3.0; 1.9 → 3.2; 2.2 → 2.5 | 114 · 38.0% (32.7–43.6%) | 984 |
| 1,000,000 | 5,000 | 575.6 / 656.5 / 585.8 | **585.8** | 313.4 | 701 / 717 / 722 | 2.0 → 3.3; 1.9 → 2.8; 1.8 → 3.0 | 95 · 31.7% (26.7–37.1%) | 1,554 |
| 1,000,000 | 10,000 | 886.1 / 899.1 / 885.5 | **886.1** | 319.5 | 946 / 1,000 / 941 | 2.1 → 2.9; 1.7 → 3.1; 2.1 → 2.5 | 76 · 25.3% (20.7–30.5%) | 4,902 |

The planted probes, digests and unseal share (amendment 3; one run per cap and size; counts do not
depend on the machine):

| Items | Cap | Planted found (of 150) | Planted left `limit_exceeded` | Unlisted and planted `limit_exceeded` (of 300) | Unseal share of probe time | Probe p50 / p95 (ms) | Peak RSS (MiB) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 100,000 | 2,000 | 122 | 28 | 53 | 5.4% | 54.9 / 187.3 | 563 |
| 100,000 | 5,000 | 138 | 12 | 24 | 10.7% | 54.5 / 292.1 | 746 |
| 100,000 | 10,000 | 150 | 0 | 0 | 19.9% | 55.3 / 579.7 | 800 |
| 1,000,000 | 2,000 | 93 | 57 | 113 | 1.3% | 307.8 / 396.0 | 565 |
| 1,000,000 | 5,000 | 102 | 48 | 94 | 2.3% | 310.1 / 558.2 | 758 |
| 1,000,000 | 10,000 | 114 | 36 | 75 | 4.0% | 323.2 / 881.9 | 833 |

- **Digests:** for every probe that two caps both screened (neither left it `limit_exceeded`), the
  SHA-256 of its created matches and unscreened reasons is the same: 247 of 247 (2,000 against
  5,000 and 10,000) and 276 of 276 (5,000 against 10,000) at 100,000 items; 187 of 187 and 206 of 206
  at 1,000,000. A larger cap screens more probes and changes no screened probe's answer.
- **Every planted namesake that was screened was found**: each miss is a probe its cap left
  `limit_exceeded` (found + left over cap = 150 in every row), reported as unscreened, never as no
  match.
- **Reading the rule:** 5,000 is within 1.5 times the 2,000 cap's p95 (1.35 ×) and +140 MiB of peak
  memory; 10,000 is 2.04 times and fails. The p50 hardly moves (the list's health read and the
  candidate select dominate it at 1,000,000 items); the p95 grows with the candidates a probe
  scores. At 100,000 items 10,000 leaves no probe unscreened but costs 3.2 times the p95, which the
  rule does not judge. **Recommended: 5,000**, for `fix-11d` or the owner to change
  `fuzzy-name-candidate-cap` (`LIST_MATCH_CONSTANTS`, `packages/core/src/lists.ts`) with these figures;
  even then 31.7% of the probes on this 1,000,000-item heavy-headed list stay unscreened.

### (i) The face list threshold

`calibration-report.ts --face-list --seed 3937565831 --replicates 1000 --input <Phase 4's measurements>`
(47 s, load 1.3 → 1.2): 707 identities, 1,574 genuine and 249,571 impostor pairs; FPIR(N, t) =
1 − (1 − FAR(t))^N over independent non-mates; 95% bootstrap intervals over identities.

| Threshold | FAR | FNIR | FPIR, gallery 1,000 | FPIR, gallery 10,000 |
| --- | --- | --- | --- | --- |
| 0.5 (today) | 0.000004 | 0.95% (0.39–1.66%) | 0.40% (0.00–2.38%) | **3.93% (0.00–21.40%)** |
| 0.72 (the rule's pick) | 0 | **25.3% (21.9–28.8%)** | 0 (0–0) | 0 (0–0) |

- **0.5 does not meet the rule** (its upper end at 10,000 is 21.4%, above 1%), so the rule picks 0.72,
  the lowest grid threshold (0.30 to 0.95 by 0.01) whose upper end at 10,000 is at most 1%, at the
  cost of missing a quarter of mated searches.
- **What the set can resolve:** with 249,571 impostor pairs the smallest non-zero FAR is about 4 in
  a million, and at gallery 10,000 that alone is an FPIR of about 4%; 0.72's interval of 0 to 0 says
  no impostor pair reached it in any replicate, not that its rate is known below that resolution. A
  larger impostor set would be needed to place the threshold between 0.5 and 0.72 with this rule.
- **The domain:** studio portraits of Phase 4's public-domain set; nothing here describes handheld
  selfies matched against a list photo.
- **Recommended to `fix-11d` and the owner:** 0.72 by the rule, with its FNIR; 0.5 stays in the code
  until they decide (owner decision 3 after 7B).

### The cold face list

`lists-benchmark --cold-list --faces 10000` (the first call wrote 10,000 sealed synthetic templates
in one face list), three takes, each a worker opening the list on an empty cache:

| Take | Open (ms) | CPU (ms) | Cache bytes | Held | Process peak RSS (MiB) | Loads (start → end) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 (and the write) | 869.7 | 819.6 | 8,120,000 | yes | 386 | 1.9 → 1.9 |
| 2 | 738.0 | 718.3 | 8,120,000 | yes | 345 | 1.8 → 1.7 |
| 3 | 751.0 | 735.1 | 8,120,000 | yes | 336 | 1.7 → 1.7 |

A full face list fits the 64 MB cache (8.12 MB, 812 B a template) and opens in about 0.75 s of CPU,
nearly all unsealing and decoding.

## Findings

1. **The fuzzy-name cap: 5,000 recommended** (`fix-11d` or the owner): the rule's figures above; the
   change is a constant, the matches of every screened probe are unchanged. **Done by `fix-11d`**
   (`eeae81d9f`, test-first): `fuzzy-name-candidate-cap` 5,000, `calibrated` with this report's basis;
   `docs/lists/README.md` says so. No figure is retaken: the 5,000 cap's takes above are its figures.
2. **The face list threshold 0.5 fails its rule at gallery 10,000** (the owner, `fix-11d`): 0.72 by the
   rule, with a quarter of mated searches missed; the impostor set limits how finely the threshold
   can be placed. **Done by `fix-11d`** (`eeae81d9f`): `face-list-threshold` 0.72, `calibrated`, its
   source naming FNIR 25.3% and the set's resolution; `docs/lists/biometric.md` says so. The cost (a
   quarter of mated searches missed, on studio portraits) is a line of the release notes, and the
   owner may set it back to 0.5 by decision 3 after 7B; the rates at 0.72 are this report's.
3. **`lists-benchmark --measure` prints neither the planted namesakes, the digests, the unseal share
   nor the peak memory** the method asks for (`fix-11d`, `apps/api/scripts/lists-benchmark.ts`):
   this run took them with a scratch tool (amendment 3); the tool could print them itself.

## Reproduce

From `/tmp/cal11d-head/apps/api`, `source scripts/env.sh`, each call under `flock -E 75 -w 240
/tmp/openverify-e2e.lock`, `<seed>` the seed above:

```bash
pnpm exec tsx --conditions=@openverify/source scripts/lists-benchmark.ts --seed --items 100000 --table-seed <seed>
/usr/bin/time -v pnpm exec tsx --conditions=@openverify/source scripts/lists-benchmark.ts --measure --probes 300 --cap <2000|5000|10000> --table-seed <seed>   # three per cap, rotating
pnpm exec tsx --conditions=@openverify/source scripts/lists-benchmark.ts --seed --items 1000000 --table-seed <seed>   # again while incomplete
# the same --measure takes at 1,000,000 items; the scratch probe (amendment 3) once per cap and size
pnpm exec tsx --conditions=@openverify/source scripts/lists-benchmark.ts --cold-list --faces 10000 --table-seed <seed>   # three takes
pnpm exec tsx --conditions=@openverify/source scripts/lists-benchmark.ts --teardown
# from /tmp/cal11d-head/packages/checks:
node --experimental-transform-types --no-warnings --conditions=@openverify/source --import ./scripts/register-ts.mjs scripts/calibration-report.ts --face-list --seed 3937565831 --replicates 1000 --input <repo>/fixtures/generated/calibration/selfie-measurements.json --output <file>
```

## What this does not measure

- Real names, real faces, real lists: every value is synthetic or from Phase 4's public-domain set.
- Handheld selfies matched against list photos (the face domain above).
- Background matching at all (not calibrated).
- Other hardware, and behaviour under failure.

## Amendments

Made by `calibration-matcher-11d` after the method commit and before the first take each affects
(the first lists take follows this commit). None changes a rule, a cap, a threshold or the margin.

1. **The seed** is the one drawn for `watchlist-phase11.md` (`openssl rand -hex 16` at
   2026-11-17T13:19:57Z, after the method commit), passed to `lists-benchmark.ts` as `--table-seed`
   and to `calibration-report.ts --face-list` as `$((16#${SEED:0:8}))`. The tools run from the head
   worktree of `watchlist-phase11.md` (`2d3134755`).
2. **The two list sizes are one list grown**: `--seed --items 100000`, the 100,000-item takes, then
   `--seed --items 1000000` (it resumes from the 100,000 items the same law drew), then the
   1,000,000-item takes. The 100,000-item list is the first 100,000 items of the larger.
3. **What `lists-benchmark --measure` does not print** (its 300 probes are all drawn from the law;
   it prints no planted namesake, no digest, no unseal share and no memory): (a) each timing take is
   `--measure --probes 300 --cap <n>` under `/usr/bin/time -v`, whose maximum resident set size is
   the take's peak memory; (b) once per cap and size, a scratch tool outside git
   (`cal11d-lists-probe.ts` in the head worktree, removed with it; it imports the benchmark's own
   `benchmarkState`, `nameLaw` and `quantile` and the API's `matchLists`) screens **150 planted
   probes** (the names of 150 items the seed picks, each found only if `matchLists` returns that
   item) and **150 unlisted probes** (the first 150 draws of the probes stream) at that cap, and
   writes each probe's SHA-256 of its created matches and unscreened reasons; the counts
   (`limit_exceeded`, planted found) and the digests come from it, and the unseal share is the time
   its replica of `findNameCandidates`' select spends opening the sealed values over the probes'
   whole time. Digests are compared per probe between caps for the probes neither cap left
   `limit_exceeded`.
4. **The cold list** is `--cold-list --faces 10000` (the face list's item cap), three takes on the
   one list the first call writes.
5. Timings keep the method's rule (load at most 4 at both ends), with the wait of
   `watchlist-phase11.md` amendment 8 (one benchmark container: below 2.0).

## Summary block

<!-- openverify:calibration-summary:start -->
```json
{
  "base": "d44e537dba0f84a4eafc45b313264de74c2b31a4",
  "head": "2d3134755c0fd4412b052faa0f2c357dfb729a4d",
  "machine": {
    "cpu": "Intel Xeon E5-1650 v3 @ 3.50GHz",
    "disk-class": "WSL2 virtual disk on a SATA SSD",
    "logical-cpus": 12,
    "memory-gib": 31.3
  },
  "method-commit": "ac3fc15583558d1ad256c44fb9e39eee7ebce871",
  "report": "docs/calibration/lists-phase11.md",
  "rows": [
    {
      "budget": null,
      "configuration": "cap 5000 at 1,000,000 items; shipped by fix-11d (eeae81d9f)",
      "contract": "owner decision 4 after 7B",
      "gap": null,
      "id": "fuzzy-name-cap",
      "median": 585.8,
      "owner": "calibration-matcher-11d",
      "takes": [
        {
          "load-end": 3.28,
          "load-start": 1.98,
          "status": "valid",
          "value": 575.6
        },
        {
          "load-end": 2.78,
          "load-start": 1.86,
          "status": "valid",
          "value": 656.5
        },
        {
          "load-end": 2.97,
          "load-start": 1.83,
          "status": "valid",
          "value": 585.8
        }
      ],
      "title": "Fuzzy-name candidate cap (5,000 recommended: p95 1.35 times the 2,000 cap's at 1,000,000 items, +140 MiB, digests identical)",
      "unit": "ms",
      "verdict": "reported"
    },
    {
      "budget": {
        "comparison": "<=",
        "metric": "ratio",
        "unit": "ratio",
        "value": 0.01
      },
      "configuration": "threshold 0.5; 0.72 shipped by fix-11d (eeae81d9f)",
      "contract": "owner decision 3 after 7B",
      "gap": 0.204,
      "id": "face-list-threshold",
      "median": 0.214,
      "owner": "calibration-matcher-11d",
      "takes": [],
      "title": "Face list threshold, FPIR upper end at gallery 10,000 (0.5 fails; 0.72 recommended, FNIR 25.3%)",
      "unit": "ratio",
      "verdict": "missed"
    },
    {
      "budget": null,
      "configuration": "default",
      "contract": "owner decision 3 after 7B",
      "gap": null,
      "id": "background-list-thresholds",
      "median": null,
      "owner": "calibration-matcher-11d",
      "takes": [],
      "title": "Background list thresholds",
      "unit": null,
      "verdict": "not-calibrated"
    },
    {
      "budget": null,
      "configuration": "default",
      "contract": "owner decision 3 after 7B",
      "gap": null,
      "id": "cold-face-list",
      "median": 0.751,
      "owner": "calibration-matcher-11d",
      "takes": [
        {
          "load-end": 1.85,
          "load-start": 1.85,
          "status": "valid",
          "value": 0.87
        },
        {
          "load-end": 1.72,
          "load-start": 1.78,
          "status": "valid",
          "value": 0.738
        },
        {
          "load-end": 1.66,
          "load-start": 1.72,
          "status": "valid",
          "value": 0.751
        }
      ],
      "title": "Opening a cold 10,000-template face list",
      "unit": "s",
      "verdict": "reported"
    }
  ],
  "schema": "openverify/calibration-summary@1",
  "status": "published",
  "workflow": "11D"
}
```
<!-- openverify:calibration-summary:end -->
