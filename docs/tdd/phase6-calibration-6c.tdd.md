# TDD record: calibration-6c (Phase 6, Workflow 6C Stage 2)

Owner decisions 1 to 5 after Workflow 6B, C78.4, C78.7 and C78.8. The calibration changes no code, constant, threshold, preset, cap, build script, benchmark script or generator: it runs them. The report is `docs/calibration/watchlist-phase6c.md`. This file records the commands actually run and their abbreviated output, in order. Every generated file stays under `/tmp/openverify-eval-6c/`, outside git.

## 1. Worktrees, before the method and the seed

Both trees are pinned to commits and prepared as the plan says. The main tree is never measured.

```text
$ flock /tmp/openverify-git.lock sh -c 'git worktree add --detach /tmp/cal-base 94ab63f92a0f527d723c313f0087bb7ba24d4406 && git worktree add --detach /tmp/cal-head e880a9fc'
HEAD is now at 94ab63f9 docs(progress): Phase 6, Workflow 6B done (...)
HEAD is now at e880a9fc docs(tdd): matcher-6c measurements at both scales, base and head, on the development tables
$ (cd /tmp/cal-base && pnpm install --frozen-lockfile --offline)   # base exit 0, done in 1.2s
$ (cd /tmp/cal-head && pnpm install --frozen-lockfile --offline)   # head exit 0, done in 860ms
$ find data -maxdepth 1 -type f ! -name variant-groups.json -exec cp {} /tmp/cal-<tree>/data/ \;   # 52 files each
$ sha256sum data/rigour-person_names.txt /tmp/cal-*/data/rigour-person_names.txt
be47a435969da3fa7311d8c682e462d6d20e6cf27cf90ad1473ce213c9a91c79  (all three)
$ cp /tmp/cal-head/packages/watchlist/scripts/benchmark-* /tmp/cal-base/packages/watchlist/scripts/
$ cp /tmp/cal-head/packages/watchlist/src/testing/held-out/* /tmp/cal-base/packages/watchlist/src/testing/held-out/
$ git -C /tmp/cal-base status --porcelain   # the overlay only: 8 modified, 15 new files under scripts/benchmark-* and src/testing/held-out/
$ (cd /tmp/cal-base/packages/watchlist && pnpm -s build:variant-groups)
{"sha256":"529216c9da43b57323b66b2b8ae98e7997e1b5972be34457f6042b0eb6f27324","heldOut":false,"inputGroups":157298,"keptGroups":156706,"keptForms":547306,...}
$ (cd /tmp/cal-head/packages/watchlist && pnpm -s build:variant-groups)
{"sha256":"29d0583854563f81084c05d78b5ea8805ca14630cbf655349cfa09fca84c3bfb","heldOut":false,"inputGroups":157298,"keptGroups":156706,"keptForms":547306,...}
$ cmp /tmp/cal-head/data/variant-groups.json data/variant-groups.json   # equal: the head's build is the main tree's
```

The shared fixture helpers (`packages/watchlist/src/testing/{random,names,records,normalised}.ts`) are byte-identical at base and head (`git diff --stat 94ab63f9 e880a9fc -- ...` prints nothing for them).

## 2. The method, committed before the seed

`docs/calibration/watchlist-phase6c.md`, sections "Method" and "Decision rules", committed before `openssl rand -hex 16` ran.

The method commit is `e0c7cebe` (2026-10-28T22:04:45-04:00, that is 02:04:45 UTC), and the gitleaks hook found no leaks.

## 3. The seed (V12)

Drawn only after the method commit:

```text
$ cd /tmp/openverify-eval-6c && test ! -e seed && openssl version && openssl rand -hex 16 > seed && date -u
OpenSSL 3.0.13 30 Jan 2024 (Library: OpenSSL 3.0.13 30 Jan 2024)
2026-10-29T02:04:51Z
e8223c34916200e2b8e51f0b47981804
$ git log --format=%h -1
e0c7cebe
```

## 4. No RED or GREEN step

The calibration changed no code: no constant, threshold, preset, cap, build script, benchmark script or generator. No benchmark step failed to run, so no defect fix was needed, and there is no test, stub, RED or GREEN commit. The benchmark gaps met on the way are follow-ups for fix-6c (report, "Findings" 8). The only files committed are this record and the report.

## 5. Every step, in order

Each step ran through a runner script (outside git, in the calibration's scratch directory). It takes `flock /tmp/openverify-e2e.lock` for one step, runs `pnpm -s <script> <args>` in `/tmp/cal-<tree>/packages/watchlist`, and logs:
- the start time (UTC);
- the tree;
- the 1-minute load at the start and the end;
- the duration and the exit code.

Before each timing it waited inside the lock for the load to fall below 2 to 2.5, for at most a few minutes. Exit 3 is a step's "incomplete, run again". `perf` and `qual` stand for `benchmark:performance` and `benchmark:quality`; `<seed>` is the seed above, and `<eval>` is `/tmp/openverify-eval-6c`.

```text
02:05:11 base load 0.95 -> 1.04    7s exit 0  build:variant-groups --hold-out <seed> --output <eval>/base/variant-groups.held-out.json
02:05:18 head load 1.04 -> 1.11    6s exit 0  build:variant-groups --hold-out <seed> --output <eval>/head/variant-groups.held-out.json
02:05:33 base load 1.02 -> 1.02    3s exit 0  perf --seed <seed> --out <eval>/base/performance --namespace cal6c-base --step machine
02:05:36 base load 1.02 -> 2.75   54s exit 0  perf --seed <seed> --out <eval>/base/performance --namespace cal6c-base --step 100k-import
02:06:30 head load 2.75 -> 2.75    3s exit 0  perf --seed <seed> --out <eval>/head/performance --namespace cal6c-head --step machine
02:06:33 head load 2.75 -> 2.84   74s exit 0  perf --seed <seed> --out <eval>/head/performance --namespace cal6c-head --step 100k-import
02:07:54 base load 2.40 -> 3.59   39s exit 3  perf --seed <seed> --out <eval>/base/performance --namespace cal6c-base --step 100k-measure --rounds 1
02:08:33 head load 3.59 -> 3.48   23s exit 3  perf --seed <seed> --out <eval>/head/performance --namespace cal6c-head --step 100k-measure --rounds 1
02:08:56 base load 3.48 -> 3.76   43s exit 3  perf --seed <seed> --out <eval>/base/performance --namespace cal6c-base --step 100k-measure --rounds 1
02:09:39 head load 3.76 -> 3.43   20s exit 3  perf --seed <seed> --out <eval>/head/performance --namespace cal6c-head --step 100k-measure --rounds 1
02:10:04 base load 3.35 -> 4.51   43s exit 0  perf --seed <seed> --out <eval>/base/performance --namespace cal6c-base --step 100k-measure --rounds 1
02:10:47 head load 4.51 -> 4.26   19s exit 0  perf --seed <seed> --out <eval>/head/performance --namespace cal6c-head --step 100k-measure --rounds 1
02:15:26 base load 4.71 -> 4.85   41s exit 0  perf --seed <seed> --out <eval>/base/performance --namespace cal6c-base --step 100k-measure --rounds 1
02:19:27 head load 2.27 -> 2.25   19s exit 0  perf --seed <seed> --out <eval>/head/performance --namespace cal6c-head --step 100k-measure --rounds 1
02:20:04 base load 2.28 -> 4.56   44s exit 0  perf --seed <seed> --out <eval>/base/performance --namespace cal6c-base --step 100k-measure --rounds 1
02:29:02 base load 2.37 -> 2.16   38s exit 0  perf --seed <seed> --out <eval>/base/performance --namespace cal6c-base --step 100k-measure --rounds 1
02:29:55 base load 1.81 -> 1.81    3s exit 0  perf --seed <seed> --out <eval>/base/performance --namespace cal6c-base --step 100k-unlisted
02:29:58 head load 1.81 -> 1.75    3s exit 0  perf --seed <seed> --out <eval>/head/performance --namespace cal6c-head --step 100k-unlisted
02:30:01 base load 1.75 -> 3.46  250s exit 0  perf --seed <seed> --out <eval>/base/performance --namespace cal6c-base --step rescreen-seed
02:34:11 head load 3.46 -> 3.62  262s exit 0  perf --seed <seed> --out <eval>/head/performance --namespace cal6c-head --step rescreen-seed
02:41:43 base load 1.81 -> 2.12   52s exit 0  perf --seed <seed> --out <eval>/base/performance --namespace cal6c-base --step rescreen-100
02:43:15 base load 1.79 -> 2.87   76s exit 0  perf --seed <seed> --out <eval>/base/performance --namespace cal6c-base --step rescreen-300
02:46:47 base load 1.96 -> 2.86  127s exit 0  perf --seed <seed> --out <eval>/base/performance --namespace cal6c-base --step rescreen-1000
02:50:32 base load 9.02 -> 1.96  288s exit 0  perf --seed <seed> --out <eval>/base/performance --namespace cal6c-base --step rescreen-3000
02:56:57 head load 1.76 -> 6.85   98s exit 0  perf --seed <seed> --out <eval>/head/performance --namespace cal6c-head --step rescreen-100
03:00:25 head load 1.98 -> 3.22   92s exit 0  perf --seed <seed> --out <eval>/head/performance --namespace cal6c-head --step rescreen-300
03:05:23 head load 2.15 -> 1.51  125s exit 0  perf --seed <seed> --out <eval>/head/performance --namespace cal6c-head --step rescreen-1000
04:02:12 head load 2.18 -> 2.24  238s exit 0  perf --seed <seed> --out <eval>/head/performance --namespace cal6c-head --step rescreen-3000
04:09:52 base load 2.41 -> 3.15   56s exit 0  perf --seed <seed> --out <eval>/base/performance --namespace cal6c-base --step 100k-compact
04:16:02 head load 1.97 -> 2.20   35s exit 0  perf --seed <seed> --out <eval>/head/performance --namespace cal6c-head --step 100k-compact
04:21:23 base load 3.70 -> 4.04    5s exit 0  perf --namespace cal6c-base --step 100k-teardown
04:21:28 head load 4.04 -> 3.80    4s exit 0  perf --namespace cal6c-head --step 100k-teardown
04:21:32 base load 3.80 -> 2.63   54s exit 0  perf --seed <seed> --out <eval>/base-r2/performance --namespace cal6c-base-r2 --step 100k-import
04:22:26 base load 2.63 -> 2.60  238s exit 0  perf --seed <seed> --out <eval>/base-r2/performance --namespace cal6c-base-r2 --step rescreen-seed
04:26:31 base load 2.20 -> 2.04   50s exit 0  perf --seed <seed> --out <eval>/base-r2/performance --namespace cal6c-base-r2 --step rescreen-100
04:27:21 base load 2.04 -> 2.06   68s exit 0  perf --seed <seed> --out <eval>/base-r2/performance --namespace cal6c-base-r2 --step rescreen-300
04:28:39 base load 1.75 -> 1.73  122s exit 0  perf --seed <seed> --out <eval>/base-r2/performance --namespace cal6c-base-r2 --step rescreen-1000
04:30:50 base load 1.59 -> 1.54    4s exit 0  perf --namespace cal6c-base-r2 --step 100k-teardown
04:30:54 head load 1.54 -> 1.95   69s exit 0  perf --seed <seed> --out <eval>/head-r2/performance --namespace cal6c-head-r2 --step 100k-import
04:32:03 head load 1.95 -> 3.76  249s exit 0  perf --seed <seed> --out <eval>/head-r2/performance --namespace cal6c-head-r2 --step rescreen-seed
04:36:19 head load 3.54 -> 2.13   82s exit 0  perf --seed <seed> --out <eval>/head-r2/performance --namespace cal6c-head-r2 --step rescreen-100
04:37:41 head load 2.13 -> 1.68   91s exit 0  perf --seed <seed> --out <eval>/head-r2/performance --namespace cal6c-head-r2 --step rescreen-300
04:39:12 head load 1.68 -> 1.61  126s exit 0  perf --seed <seed> --out <eval>/head-r2/performance --namespace cal6c-head-r2 --step rescreen-1000
04:41:31 head load 1.45 -> 1.45    4s exit 0  perf --namespace cal6c-head-r2 --step 100k-teardown
04:41:35 base load 1.45 -> 1.48   52s exit 0  perf --seed <seed> --out <eval>/base-r3/performance --namespace cal6c-base-r3 --step 100k-import
04:42:27 base load 1.48 -> 2.92  241s exit 0  perf --seed <seed> --out <eval>/base-r3/performance --namespace cal6c-base-r3 --step rescreen-seed
04:46:34 base load 2.77 -> 2.33   50s exit 0  perf --seed <seed> --out <eval>/base-r3/performance --namespace cal6c-base-r3 --step rescreen-100
04:47:24 base load 2.33 -> 1.83   66s exit 0  perf --seed <seed> --out <eval>/base-r3/performance --namespace cal6c-base-r3 --step rescreen-300
04:48:30 base load 1.83 -> 1.90  119s exit 0  perf --seed <seed> --out <eval>/base-r3/performance --namespace cal6c-base-r3 --step rescreen-1000
04:50:36 base load 1.75 -> 1.75    5s exit 0  perf --namespace cal6c-base-r3 --step 100k-teardown
04:50:41 head load 1.75 -> 1.54   75s exit 0  perf --seed <seed> --out <eval>/head-r3/performance --namespace cal6c-head-r3 --step 100k-import
04:51:56 head load 1.54 -> 2.01  251s exit 0  perf --seed <seed> --out <eval>/head-r3/performance --namespace cal6c-head-r3 --step rescreen-seed
04:56:14 head load 1.85 -> 2.21   81s exit 0  perf --seed <seed> --out <eval>/head-r3/performance --namespace cal6c-head-r3 --step rescreen-100
04:57:35 head load 2.21 -> 2.11   91s exit 0  perf --seed <seed> --out <eval>/head-r3/performance --namespace cal6c-head-r3 --step rescreen-300
04:59:16 head load 1.78 -> 1.80  121s exit 0  perf --seed <seed> --out <eval>/head-r3/performance --namespace cal6c-head-r3 --step rescreen-1000
05:01:35 head load 1.62 -> 1.65    4s exit 0  perf --namespace cal6c-head-r3 --step 100k-teardown
05:01:39 base load 1.65 -> 1.78   14s exit 0  qual --seed <seed> --build <eval>/base/variant-groups.held-out.json --out <eval>/base/quality --namespace cal6c-base --step prepare
05:01:53 head load 1.78 -> 1.68   14s exit 0  qual --seed <seed> --build <eval>/head/variant-groups.held-out.json --out <eval>/head/quality --namespace cal6c-head --step prepare
05:04:32 head load 1.25 -> 3.30   98s exit 0  C78.7 gate take 1
05:06:41 head load 1.84 -> 2.17   93s exit 0  C78.7 gate take 2
05:09:34 head load 1.72 -> 2.50   93s exit 0  C78.7 gate take 3
05:09:44 base load 2.11 -> 2.74  136s exit 0  qual --seed <seed> --build <eval>/base/variant-groups.held-out.json --out <eval>/base/quality --namespace cal6c-base --step screen
05:12:06 head load 2.52 -> 2.54  120s exit 0  qual --seed <seed> --build <eval>/head/variant-groups.held-out.json --out <eval>/head/quality --namespace cal6c-head --step screen
05:14:06 base load 2.54 -> 2.64   33s exit 0  qual --seed <seed> --build <eval>/base/variant-groups.held-out.json --out <eval>/base/quality --namespace cal6c-base --step report
05:14:39 base load 2.64 -> 2.63    8s exit 0  qual --seed <seed> --build <eval>/base/variant-groups.held-out.json --out <eval>/base/quality --namespace cal6c-base --step typo-kinds
05:14:47 base load 2.63 -> 2.63    5s exit 0  qual --namespace cal6c-base --step teardown
05:14:52 head load 2.63 -> 3.02   32s exit 0  qual --seed <seed> --build <eval>/head/variant-groups.held-out.json --out <eval>/head/quality --namespace cal6c-head --step report
05:15:24 head load 3.02 -> 2.71    8s exit 0  qual --seed <seed> --build <eval>/head/variant-groups.held-out.json --out <eval>/head/quality --namespace cal6c-head --step typo-kinds
05:15:32 head load 2.71 -> 2.71    4s exit 0  qual --namespace cal6c-head --step teardown
05:15:44 base load 2.69 -> 2.10   52s exit 0  qual --seed <seed> --out <eval>/base/quality --namespace cal6c-base --scale 100k --step scale-prepare
05:16:36 head load 2.10 -> 1.57   70s exit 0  qual --seed <seed> --out <eval>/head/quality --namespace cal6c-head --scale 100k --step scale-prepare
05:17:51 base load 1.44 -> 2.47  343s exit 0  qual --seed <seed> --out <eval>/base/quality --namespace cal6c-base --scale 100k --step scale-screen
05:23:35 head load 2.47 -> 2.32  129s exit 0  qual --seed <seed> --out <eval>/head/quality --namespace cal6c-head --scale 100k --step scale-screen
05:25:51 base load 2.22 -> 2.12    4s exit 0  qual --seed <seed> --out <eval>/base/quality --namespace cal6c-base --scale 100k --step scale-report
05:25:55 base load 2.12 -> 2.03    4s exit 0  qual --namespace cal6c-base --scale 100k --step scale-teardown
05:25:59 head load 2.03 -> 2.11    4s exit 0  qual --seed <seed> --out <eval>/head/quality --namespace cal6c-head --scale 100k --step scale-report
05:26:03 head load 2.11 -> 2.11    4s exit 0  qual --namespace cal6c-head --scale 100k --step scale-teardown
05:26:07 head load 2.11 -> 1.67   27s exit 0  qual --step compare --seed <seed> --base <eval>/base/quality --head <eval>/head/quality --out <eval>/compare
05:26:53 base load 1.39 -> 1.65   80s exit 0  perf --seed <seed> --out <eval>/base/performance --namespace cal6c-base --step 2m-import --part 1
05:28:13 base load 1.65 -> 1.77  103s exit 0  perf --seed <seed> --out <eval>/base/performance --namespace cal6c-base --step 2m-import --part 2
05:30:02 base load 1.62 -> 2.22  136s exit 0  perf --seed <seed> --out <eval>/base/performance --namespace cal6c-base --step 2m-import --part 3
05:32:18 base load 2.22 -> 2.07  159s exit 0  perf --seed <seed> --out <eval>/base/performance --namespace cal6c-base --step 2m-import --part 4
05:35:03 base load 1.90 -> 2.02  200s exit 0  perf --seed <seed> --out <eval>/base/performance --namespace cal6c-base --step 2m-import --part 5
05:38:23 base load 2.02 -> 2.08  229s exit 0  perf --seed <seed> --out <eval>/base/performance --namespace cal6c-base --step 2m-import --part 6
05:42:18 base load 1.91 -> 2.40  250s exit 0  perf --seed <seed> --out <eval>/base/performance --namespace cal6c-base --step 2m-import --part 7
05:46:34 base load 2.20 -> 1.85  283s exit 0  perf --seed <seed> --out <eval>/base/performance --namespace cal6c-base --step 2m-import --part 8
05:51:34 base load 1.89 -> 2.24  251s exit 3  perf --seed <seed> --out <eval>/base/performance --namespace cal6c-base --step 2m-measure --rounds 1
05:56:02 base load 1.88 -> 2.16  257s exit 3  perf --seed <seed> --out <eval>/base/performance --namespace cal6c-base --step 2m-measure --rounds 1
06:00:35 base load 1.82 -> 2.15  253s exit 0  perf --seed <seed> --out <eval>/base/performance --namespace cal6c-base --step 2m-measure --rounds 1
06:04:58 base load 1.89 -> 1.82    3s exit 0  perf --seed <seed> --out <eval>/base/performance --namespace cal6c-base --step 2m-unlisted
06:05:01 base load 1.82 -> 1.93  415s exit 0  perf --seed <seed> --out <eval>/base/performance --namespace cal6c-base --step 2m-compact
06:12:10 base load 1.58 -> 1.58    4s exit 0  perf --namespace cal6c-base --step 2m-teardown
06:12:14 head load 1.58 -> 1.77  122s exit 0  perf --seed <seed> --out <eval>/head/performance --namespace cal6c-head --step 2m-import --part 1
06:14:16 head load 1.77 -> 2.09  162s exit 0  perf --seed <seed> --out <eval>/head/performance --namespace cal6c-head --step 2m-import --part 2
06:17:04 head load 1.93 -> 2.10  221s exit 0  perf --seed <seed> --out <eval>/head/performance --namespace cal6c-head --step 2m-import --part 3
06:20:45 head load 2.10 -> 1.86  285s exit 0  perf --seed <seed> --out <eval>/head/performance --namespace cal6c-head --step 2m-import --part 4
06:25:37 head load 1.57 -> 3.03  342s exit 0  perf --seed <seed> --out <eval>/head/performance --namespace cal6c-head --step 2m-import --part 5
06:31:27 head load 2.64 -> 2.43  384s exit 0  perf --seed <seed> --out <eval>/head/performance --namespace cal6c-head --step 2m-import --part 6
06:37:58 head load 2.55 -> 2.06  432s exit 0  perf --seed <seed> --out <eval>/head/performance --namespace cal6c-head --step 2m-import --part 7
06:45:16 head load 1.98 -> 1.77  488s exit 0  perf --seed <seed> --out <eval>/head/performance --namespace cal6c-head --step 2m-import --part 8
06:53:33 head load 1.58 -> 2.50   47s exit 3  perf --seed <seed> --out <eval>/head/performance --namespace cal6c-head --step 2m-measure --rounds 1
06:54:50 head load 1.96 -> 1.45   45s exit 3  perf --seed <seed> --out <eval>/head/performance --namespace cal6c-head --step 2m-measure --rounds 1
06:55:35 head load 1.45 -> 1.40   47s exit 0  perf --seed <seed> --out <eval>/head/performance --namespace cal6c-head --step 2m-measure --rounds 1
06:56:32 head load 1.57 -> 1.57    3s exit 0  perf --seed <seed> --out <eval>/head/performance --namespace cal6c-head --step 2m-unlisted
06:56:35 head load 1.57 -> 2.29  297s exit 0  perf --seed <seed> --out <eval>/head/performance --namespace cal6c-head --step 2m-compact
07:01:32 head load 2.29 -> 2.19    5s exit 0  perf --namespace cal6c-head --step 2m-teardown
07:01:45 base load 2.18 -> 1.97   83s exit 0  qual --seed <seed> --out <eval>/base/quality --namespace cal6c-base --scale 2m --step scale-prepare --part 1
07:03:08 base load 1.97 -> 1.73  106s exit 0  qual --seed <seed> --out <eval>/base/quality --namespace cal6c-base --scale 2m --step scale-prepare --part 2
07:04:54 base load 1.73 -> 1.51  135s exit 0  qual --seed <seed> --out <eval>/base/quality --namespace cal6c-base --scale 2m --step scale-prepare --part 3
07:07:15 base load 1.39 -> 1.81  156s exit 0  qual --seed <seed> --out <eval>/base/quality --namespace cal6c-base --scale 2m --step scale-prepare --part 4
07:09:51 base load 1.81 -> 2.44  203s exit 0  qual --seed <seed> --out <eval>/base/quality --namespace cal6c-base --scale 2m --step scale-prepare --part 5
07:13:21 base load 2.33 -> 1.82  227s exit 0  qual --seed <seed> --out <eval>/base/quality --namespace cal6c-base --scale 2m --step scale-prepare --part 6
07:17:08 base load 1.82 -> 2.57  246s exit 0  qual --seed <seed> --out <eval>/base/quality --namespace cal6c-base --scale 2m --step scale-prepare --part 7
07:21:21 base load 2.37 -> 1.64  294s exit 0  qual --seed <seed> --out <eval>/base/quality --namespace cal6c-base --scale 2m --step scale-prepare --part 8
07:26:23 base load 1.71 -> 2.26  666s exit 3  qual --seed <seed> --out <eval>/base/quality --namespace cal6c-base --scale 2m --step scale-screen
07:37:52 base load 1.83 -> 1.76  646s exit 3  qual --seed <seed> --out <eval>/base/quality --namespace cal6c-base --scale 2m --step scale-screen
07:48:56 base load 1.42 -> 1.78  661s exit 3  qual --seed <seed> --out <eval>/base/quality --namespace cal6c-base --scale 2m --step scale-screen
08:00:03 base load 1.64 -> 2.21  507s exit 3  qual --seed <seed> --out <eval>/base/quality --namespace cal6c-base --scale 2m --step scale-screen
08:08:43 base load 1.87 -> 2.36  442s exit 0  qual --seed <seed> --out <eval>/base/quality --namespace cal6c-base --scale 2m --step scale-screen
08:16:14 base load 2.25 -> 2.23    4s exit 0  qual --seed <seed> --out <eval>/base/quality --namespace cal6c-base --scale 2m --step scale-report
08:16:18 base load 2.23 -> 2.21    6s exit 0  qual --namespace cal6c-base --scale 2m --step scale-teardown
08:16:24 head load 2.21 -> 2.00  139s exit 0  qual --seed <seed> --out <eval>/head/quality --namespace cal6c-head --scale 2m --step scale-prepare --part 1
08:18:43 head load 2.00 -> 1.99  166s exit 0  qual --seed <seed> --out <eval>/head/quality --namespace cal6c-head --scale 2m --step scale-prepare --part 2
08:21:38 head load 1.76 -> 1.61  233s exit 0  qual --seed <seed> --out <eval>/head/quality --namespace cal6c-head --scale 2m --step scale-prepare --part 3
08:25:31 head load 1.61 -> 2.35  281s exit 0  qual --seed <seed> --out <eval>/head/quality --namespace cal6c-head --scale 2m --step scale-prepare --part 4
08:30:19 head load 2.32 -> 3.08  325s exit 0  qual --seed <seed> --out <eval>/head/quality --namespace cal6c-head --scale 2m --step scale-prepare --part 5
08:35:50 head load 2.92 -> 1.96  385s exit 0  qual --seed <seed> --out <eval>/head/quality --namespace cal6c-head --scale 2m --step scale-prepare --part 6
08:42:21 head load 1.88 -> 2.05  449s exit 0  qual --seed <seed> --out <eval>/head/quality --namespace cal6c-head --scale 2m --step scale-prepare --part 7
08:49:57 head load 2.06 -> 2.52  543s exit 0  qual --seed <seed> --out <eval>/head/quality --namespace cal6c-head --scale 2m --step scale-prepare --part 8
08:59:08 head load 2.21 -> 1.57  452s exit 0  qual --seed <seed> --out <eval>/head/quality --namespace cal6c-head --scale 2m --step scale-screen
09:06:47 head load 1.33 -> 1.33    5s exit 0  qual --seed <seed> --out <eval>/head/quality --namespace cal6c-head --scale 2m --step scale-report
09:06:52 head load 1.33 -> 1.38    4s exit 0  qual --namespace cal6c-head --scale 2m --step scale-teardown
09:06:56 head load 1.38 -> 1.31   29s exit 0  qual --step compare --seed <seed> --base <eval>/base/quality --head <eval>/head/quality --out <eval>/compare
09:11:57 head load 1.56 -> 2.00   70s exit 0  qual --seed <seed> --out <eval>/final/head/quality --namespace cal6c-final --scale 100k --step scale-prepare
09:13:07 head load 2.00 -> 1.51  126s exit 0  qual --seed <seed> --out <eval>/final/head/quality --namespace cal6c-final --scale 100k --step scale-screen
09:15:21 head load 1.50 -> 1.86    4s exit 0  qual --seed <seed> --out <eval>/final/head/quality --namespace cal6c-final --scale 100k --step scale-report
09:15:25 head load 1.86 -> 1.79    4s exit 0  qual --namespace cal6c-final --scale 100k --step scale-teardown
09:15:29 head load 1.79 -> 1.79    3s exit 0  perf --seed <seed> --out <eval>/final/head/performance --namespace cal6c-final --step machine
09:15:32 head load 1.79 -> 2.17   66s exit 0  perf --seed <seed> --out <eval>/final/head/performance --namespace cal6c-final --step 100k-import
09:16:45 head load 2.00 -> 1.78   18s exit 3  perf --seed <seed> --out <eval>/final/head/performance --namespace cal6c-final --step 100k-measure --rounds 1
09:17:03 head load 1.78 -> 1.60   18s exit 3  perf --seed <seed> --out <eval>/final/head/performance --namespace cal6c-final --step 100k-measure --rounds 1
09:17:21 head load 1.60 -> 1.78   17s exit 0  perf --seed <seed> --out <eval>/final/head/performance --namespace cal6c-final --step 100k-measure --rounds 1
09:17:38 head load 1.78 -> 1.78    3s exit 0  perf --seed <seed> --out <eval>/final/head/performance --namespace cal6c-final --step 100k-unlisted
09:17:56 head load 1.52 -> 1.88  235s exit 0  perf --seed <seed> --out <eval>/final/head/performance --namespace cal6c-final --step rescreen-seed
09:21:51 head load 1.88 -> 1.44   81s exit 0  perf --seed <seed> --out <eval>/final/head/performance --namespace cal6c-final --step rescreen-100
09:23:19 head load 1.22 -> 1.43   90s exit 0  perf --seed <seed> --out <eval>/final/head/performance --namespace cal6c-final --step rescreen-300
09:24:49 head load 1.43 -> 1.56  123s exit 0  perf --seed <seed> --out <eval>/final/head/performance --namespace cal6c-final --step rescreen-1000
09:26:52 head load 1.56 -> 1.59    4s exit 0  perf --namespace cal6c-final --step 100k-teardown
```

Abbreviated outputs, by phase:

```text
# hold-out builds (both trees)
{"sha256":"66d58462…a691","heldOut":true,"inputGroups":157298,"keptGroups":140875,"keptForms":491873,"droppedOversize":4,"droppedHeldOut":15895,"droppedTooFewForms":524}   # base
{"sha256":"1f5b1b12…6d83","heldOut":true,"inputGroups":157298,"keptGroups":140875,"keptForms":491873,"droppedOversize":4,"droppedHeldOut":15895,"droppedTooFewForms":524}   # head
# 6B set, prepare (both trees)
{"independence":{"groupCases":1000,"groupIds":1811},"list":{"entries":3600,"sha256":"ba6e9ca9…0705"},"cases":3600,"customers":10000,"sync":"applied"}
# 6B set, screen: {"screened":16600,"done":16600,"of":16600,"seconds":133} (base), 117 s (head)
# 100,000-name import (both trees): {"file":{"entries":60694,"names":100000,"sha256":"96c149b3…781a"},"sync":{"outcome":"applied","added":60694}}
# 100,000-name measure summaries
base: p50 43.1, p95 280.5, roundP95 282.8/307.4/271.5, candidates 212/1452, capBinds 1, wouldError 0, listed 150/150
head: p50 21.1, p95 108.9, roundP95 115.2/109.5/98.0, candidates 99/630, capBinds 1, wouldError 0, listed 150/150
# 2,000,000-name import, part 8 (both trees): {"entries":412649,"names":2000001,"sha256":"0a29f3ce…7ea8","sync":{"outcome":"applied","entryCount":412649,"added":51562}}
# 2,000,000-name measure summaries
base: p50 492.5, p95 1541.0, roundP95 1529.9/1587.6/1483.6, candidates 1547/2000, capBinds 129, wouldError 19, listed 148/150, erroredRuns 57 (result_truncated)
head: p50 58.8, p95 393.1, roundP95 399.4/365.6/405.2, candidates 151/869, capBinds (the step counts truncated) 15, at the cap 6, wouldError 0, listed 148/150, erroredRuns 0
# unlisted (first round, tolerant): base 31/150 (171 matches) and 84/150 (3,541); head 27/150 (181) and 71/150 (2,904)
# compacted rounds: base p95 316.7 and 1535.4 ms; head 108.3 and 367.0 ms
# re-screen, 1,000 added (three takes each)
base: 100079 / 97689 / 94890 ms, runsInserted 11312
head:  95099 / 96276 / 92633 ms, runsInserted 2465, matched 2465, stale 0
# scale prepare, last part: 100k {"entries":62144,"sha256":"324d2602…6e91"}; 2m {"entries":414099,"sha256":"d4fee5b9…b499"}; indistinguishable 16 and 17
# scale screen: 3,450 queries per scale and tree (base 2m in five calls, 1.1 s a query at most)
# compare: {"written":"/tmp/openverify-eval-6c/compare/compare.json","sets":7}
```

## 6. Decision 3's no-miss check

The script (`check-rescreen.mjs`, outside git) and its wrapper ran three worker processes under one lock hold per call. It ran after the head's first 1,000-entry sync and before its 3,000-entry sync.

```text
$ check.sh summary            # dry run before any screening
{"syncId":4,"changedEntries":1000,"listUpdateRuns":2465,"subjectsScreened":0,...}
$ check.sh 3                  # five calls
{"worker":2,"workers":3,"screened":14500,"done":14500,"seconds":489}   ... (×3 workers)
{"worker":0,"workers":3,"screened":14500,"done":29000,"seconds":492}
...
{"worker":2,"workers":3,"screened":9166,"done":66666,"seconds":317}
[check] end load 4.45 03:56:12      200000 total
$ check.sh summary
{"syncId":4,"changedEntries":1000,"listUpdateRuns":2465,"subjectsScreened":200000,"erroredSubjects":783,
 "errorCodes":["result_truncated"],"fullScreeningMatchesChanged":2429,"ofThemWithRun":2429,"missed":0,
 "runsWithoutFullScreeningMatch":36,"matchesOnChangedEntries":3049}
```

## 7. The C78.7 gate

```text
$ cd /tmp/cal-head/apps/api && OPENVERIFY_C787_TIMING=assert pnpm exec vitest run --config vitest.integration.config.ts \
    src/watchlists/watchlists.integration.test.ts -t "finds every listed subject within the cap"      # under the lock, three takes
[gate] take 1 exit=0 98s load 1.25 -> 3.30 (waited 0s)
[C78.7 gate] case=shipped-variant-groups law=zipf-1 names=100001 entries=60685 p50=17.7ms p95=81.8ms p99=143.0ms round-p95s=90.2/68.0/81.8ms p95-state/retrieve/load/rest=4.8/18.7/19.7/40.8ms candidates-p50/p95=79/503 cap-binds=3/300 unreachable=2/300 would-error=1/300 listed-found=150/150 unlisted-alerted=24/150 timing=asserted
Tests  1 passed | 5 skipped (6)
[gate] take 2 exit=0 93s load 1.84 -> 2.17 (waited 30s)
[C78.7 gate] case=shipped-variant-groups law=zipf-1 names=100001 entries=60685 p50=17.2ms p95=75.4ms p99=164.0ms round-p95s=84.5/72.0/58.6ms p95-state/retrieve/load/rest=4.8/19.2/18.1/37.9ms candidates-p50/p95=79/503 cap-binds=3/300 unreachable=2/300 would-error=1/300 listed-found=150/150 unlisted-alerted=24/150 timing=asserted
Tests  1 passed | 5 skipped (6)
[gate] take 3 exit=0 93s load 1.72 -> 2.50 (waited 80s)
[C78.7 gate] case=shipped-variant-groups law=zipf-1 names=100001 entries=60685 p50=17.5ms p95=70.8ms p99=173.8ms round-p95s=83.3/66.9/65.2ms p95-state/retrieve/load/rest=4.8/17.9/18.7/36.5ms candidates-p50/p95=79/503 cap-binds=3/300 unreachable=2/300 would-error=1/300 listed-found=150/150 unlisted-alerted=24/150 timing=asserted
Tests  1 passed | 5 skipped (6)
$ cd /tmp/cal-base/apps/api && pnpm exec vitest run --config vitest.integration.config.ts \
    src/watchlists/watchlists.integration.test.ts -t "screens one subject in at most 100 ms"   # the base's own gate, once
[gate-base] exit=0 88s load 0.50 -> 2.05
[C78.7 gate] names=105517 entries=63954 p50=22.6ms p95=73.2ms candidates-p95=260 truncated=0 listed-found=150/150 round-p95s=75.0/79.0/73.2ms retrieve-p95=51.2ms load-p95=9.2ms score-p95=19.9ms
Tests  1 passed | 4 skipped (5)
```

## 8. Tables

```text
$ (cd /tmp/cal-head/packages/watchlist && pnpm -s benchmark:render --out /tmp/openverify-eval-6c/<base|head|compare>)
base exit 0 lines 218; head exit 0 lines 218; compare exit 0 lines 231
$ node tables.mjs > /tmp/openverify-eval-6c/decision-tables.md   # the decision tables, from compare.json and the performance files
$ node wilson.mjs   # Wilson intervals through benchmark-metrics.mjs' wilsonInterval
6/300 = 2.00% (Wilson 0.92–4.29%)   15/300 = 5.00% (3.05–8.08%)   129/300 = 43.00% (37.52–48.66%)   19/300 = 6.33% (4.09–9.68%)
0/300 = 0.00% (0.00–1.26%)   14/2549 = 0.55% (0.33–0.92%)   34/2549 = 1.33% (0.96–1.86%)   83/2549 = 3.26% (2.63–4.02%)
302/2549 = 11.85% (10.65–13.16%)   0/2429 = 0.00% (0.00–0.16%)
```

The round files were checked for the machine-independent counts: candidates at the cap, truncated and errored are identical in rounds 1, 2 and 3 at every tree and scale.

## 9. Final gates

**`pnpm format:check`** (the whole repository, from the main tree):

```text
$ pnpm format:check
$ prettier --check .
Checking formatting...
All matched files use Prettier code style!
real 0m51.704s   exit 0
```

**The head's 100,000-name quality and performance steps, again from an empty output directory** (`/tmp/openverify-eval-6c/final/head`, namespace `cal6c-final`; every step under the lock, from `/tmp/cal-head/packages/watchlist`):

```text
$ test ! -e /tmp/openverify-eval-6c/final/head && mkdir -p /tmp/openverify-eval-6c/final/head && ls -A … | wc -l
0
$ pnpm -s benchmark:quality --seed <seed> --out <final>/quality --namespace cal6c-final --scale 100k --step scale-prepare
[step] head exit=0 70s load 1.56 -> 2.00
{"names":100000,"population":{"entries":1450,"cases":1450,"customers":2000},"indistinguishable":16}
{"sha":"324d2602b7f2b961bdad43f7a1478224c9cafbf7f95479f39a97da2bda0e6e91","sync":"applied"}
$ pnpm -s benchmark:quality --seed <seed> --out <final>/quality --namespace cal6c-final --scale 100k --step scale-screen
{"scale":"100k","screened":3450,"done":3450,"of":3450,"seconds":123}
$ pnpm -s benchmark:quality --seed <seed> --out <final>/quality --namespace cal6c-final --scale 100k --step scale-report
$ pnpm -s benchmark:quality --namespace cal6c-final --scale 100k --step scale-teardown
$ cmp <final>/quality/scale-100k/results.json <eval>/head/quality/scale-100k/results.json
results.json identical to run 1
$ cmp <(sort <final>/…/observations.jsonl) <(sort <eval>/head/…/observations.jsonl)
observations identical (sorted)
$ pnpm -s benchmark:performance --seed <seed> --out <final>/performance --namespace cal6c-final --step machine
$ pnpm -s benchmark:performance --seed <seed> --out <final>/performance --namespace cal6c-final --step 100k-import
{"sha":"96c149b3eda6e9819d872676355416b9d48cebb1d53f1ce6ee28bf0cea64781a","sync":"applied","syncSeconds":55.1}
$ pnpm -s benchmark:performance --seed <seed> --out <final>/performance --namespace cal6c-final --step 100k-measure --rounds 1   # three times
{"round":1,"before":1.92,"after":1.78,"seconds":9.8}
{"round":2,"before":1.71,"after":1.6,"seconds":9.4}
{"round":3,"before":1.83,"after":1.78,"seconds":9.5}
{"p50":18.46,"p95":94.51,"roundP95":[99.22,92.99,92.01],"candidates":{"p50":99,"p95":630,"max":1689},"capBinds":1,"wouldError":0,"listedFound":{"found":150,"of":150}}
$ pnpm -s benchmark:performance --seed <seed> --out <final>/performance --namespace cal6c-final --step 100k-unlisted
{"scale":"100k","preset":"tolerant","round":1,"alerted":27,"of":150,"share":0.18,"interval":[0.1268,0.2492],"matches":181}
$ pnpm -s benchmark:performance … --step rescreen-seed; then rescreen-100, rescreen-300, rescreen-1000
{"added":100,"rescreenMs":53575,"runs":171,"load":[1.75,1.44]}
{"added":300,"rescreenMs":62041,"runs":2270,"matched":2270,"load":[1.65,1.43]}
{"added":1000,"rescreenMs":93617,"runs":2465,"matched":2465,"load":[1.49,1.56]}
$ pnpm -s benchmark:performance --namespace cal6c-final --step 100k-teardown
$ docker ps -a --filter label=openverify.benchmark   # prints nothing: no benchmark container is left
```

The data-determined numbers reproduce exactly. The timings move with the load: the median round p95 is 93.0 ms here (loads 1.6 to 1.9), against 109.5 ms in the first run (loads up to 3.8).

## 10. Clean-up

The two worktrees are removed with `git worktree remove --force` (their only changes are the uncommitted base overlay and the builds under `data/`, all generated). The outputs stay under `/tmp/openverify-eval-6c/`, outside git, and are never committed.
