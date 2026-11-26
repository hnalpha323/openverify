#!/usr/bin/env bash
# Test for infra/scripts/check-connected-results.sh, which CI runs after connectedDebugAndroidTest.
# A green Gradle run is not enough: a test that skips itself (for example the CameraX test when
# the emulator has no camera) would pass silently. The checker must print a per-suite summary and
# fail when any test was skipped, failed or errored, or when no test ran at all.
# Uses only throwaway temp directories.
set -uo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
checker="$repo_root/infra/scripts/check-connected-results.sh"
scratch_root="${SCRATCH_ROOT:-${TMPDIR:-/tmp}}"

passed=0
failed=0
ok() { printf 'ok   - %s\n' "$1"; passed=$((passed + 1)); }
nok() { printf 'FAIL - %s%s\n' "$1" "${2:+ ($2)}"; failed=$((failed + 1)); }
expect_match() { # expect_match <description> <glob> <actual>
  # shellcheck disable=SC2254 # the glob is intentionally unquoted
  case "$3" in
    $2) ok "$1" ;;
    *) nok "$1" "expected match for '$2', got: $(printf '%s' "$3" | tail -n 3 | tr '\n' ' ')" ;;
  esac
}
finish() {
  printf '\n# %d passed, %d failed\n' "$passed" "$failed"
  if [ "$failed" -eq 0 ]; then exit 0; else exit 1; fi
}

if [ -x "$checker" ]; then ok "infra/scripts/check-connected-results.sh exists and is executable"; else nok "infra/scripts/check-connected-results.sh exists and is executable"; finish; fi

mkdir -p "$scratch_root"
work=$(mktemp -d "$scratch_root/openverify-connected-results.XXXXXX")
trap 'rm -rf "$work"' EXIT

# suite <root> <module> <tests> <failures> <errors> <skipped>: writes a JUnit XML file where AGP
# puts it, in AGP's shape (a <testsuites> root around one <testsuite>, as in CI run 39418338299).
suite() {
  local dir="$1/$2/build/outputs/androidTest-results/connected/debug"
  mkdir -p "$dir"
  cat >"$dir/TEST-test(AVD) - 14-_$2-.xml" <<XML
<?xml version='1.0' encoding='UTF-8' ?>
<testsuites tests="$3" failures="$4" errors="$5" skipped="$6" time="0.000" hostname="localhost">
  <testsuite name="dev.openverify.$2" tests="$3" failures="$4" errors="$5" skipped="$6" time="8.7" hostname="localhost">
  </testsuite>
</testsuites>
XML
}

# run <case> [<module>=<minimum>...]: runs the checker on $work/<case>, sets rc and out.
run() { local dir="$work/$1"; shift; out=$("$checker" "$dir" "$@" 2>&1); rc=$?; }

# 1. Every test ran and passed.
suite "$work/pass" openverify-sdk 1 0 0 0
run pass
if [ "$rc" -eq 0 ]; then ok "passing suites exit 0"; else nok "passing suites exit 0" "exit $rc: $out"; fi
expect_match "prints a per-suite summary" "*openverify-sdk*1 tests*0 failures*0 errors*0 skipped*" "$out"

# 2. A module without instrumented tests next to one with them.
suite "$work/mixed" openverify-sdk 1 0 0 0
suite "$work/mixed" demo-app 0 0 0 0
run mixed
if [ "$rc" -eq 0 ]; then ok "an empty suite next to a passing one exits 0"; else nok "an empty suite next to a passing one exits 0" "exit $rc: $out"; fi

# 3. A skipped test fails the check.
suite "$work/skipped" openverify-sdk 1 0 0 1
run skipped
if [ "$rc" -ne 0 ]; then ok "a skipped test fails the check"; else nok "a skipped test fails the check" "exit 0"; fi
expect_match "names the skip" "*skipped*" "$out"

# 4. Failures and errors fail the check.
suite "$work/failure" openverify-sdk 1 1 0 0
run failure
if [ "$rc" -ne 0 ]; then ok "a failing test fails the check"; else nok "a failing test fails the check" "exit 0"; fi
suite "$work/error" openverify-sdk 1 0 1 0
run error
if [ "$rc" -ne 0 ]; then ok "an erroring test fails the check"; else nok "an erroring test fails the check" "exit 0"; fi

# 5. No test ran at all.
suite "$work/none" openverify-sdk 0 0 0 0
run none
if [ "$rc" -ne 0 ]; then ok "zero tests in total fails the check"; else nok "zero tests in total fails the check" "exit 0"; fi
mkdir -p "$work/missing"
run missing
if [ "$rc" -ne 0 ]; then ok "no result files fails the check"; else nok "no result files fails the check" "exit 0"; fi
expect_match "says no results were found" "*no connected test results*" "$out"

# 6. A minimum per module (Workflow 10D review, A006): one passing test is not the suite. With
# <module>=<minimum> arguments, a module whose results hold fewer tests than its minimum fails the
# check, so a device suite that lost most of its classes cannot stay green.
suite "$work/floor-met" openverify-sdk 14 0 0 0
suite "$work/floor-met" demo-app 2 0 0 0
run floor-met openverify-sdk=14 demo-app=2
if [ "$rc" -eq 0 ]; then ok "every module at its minimum exits 0"; else nok "every module at its minimum exits 0" "exit $rc: $out"; fi
suite "$work/floor-above" openverify-sdk 15 0 0 0
suite "$work/floor-above" demo-app 2 0 0 0
run floor-above openverify-sdk=14 demo-app=2
if [ "$rc" -eq 0 ]; then ok "a module above its minimum exits 0"; else nok "a module above its minimum exits 0" "exit $rc: $out"; fi
suite "$work/floor-shrunk" openverify-sdk 1 0 0 0
suite "$work/floor-shrunk" demo-app 2 0 0 0
run floor-shrunk openverify-sdk=14 demo-app=2
if [ "$rc" -ne 0 ]; then ok "a suite that shrank to one passing test fails the check"; else nok "a suite that shrank to one passing test fails the check" "exit 0: $out"; fi
expect_match "names the module, what ran and its minimum" "*openverify-sdk*1 *at least 14*" "$out"
suite "$work/floor-one-short" openverify-sdk 14 0 0 0
suite "$work/floor-one-short" demo-app 1 0 0 0
run floor-one-short openverify-sdk=14 demo-app=2
if [ "$rc" -ne 0 ]; then ok "one test fewer than a module's minimum fails the check"; else nok "one test fewer than a module's minimum fails the check" "exit 0: $out"; fi
suite "$work/floor-absent" openverify-sdk 14 0 0 0
run floor-absent openverify-sdk=14 demo-app=2
if [ "$rc" -ne 0 ]; then ok "a module with a minimum and no results fails the check"; else nok "a module with a minimum and no results fails the check" "exit 0: $out"; fi
expect_match "names the module without results" "*demo-app*0 *at least 2*" "$out"
# A module is matched by its directory, never by a longer name that ends the same way.
suite "$work/floor-name" not-openverify-sdk 14 0 0 0
suite "$work/floor-name" demo-app 2 0 0 0
run floor-name openverify-sdk=14 demo-app=2
if [ "$rc" -ne 0 ]; then ok "another module's results do not count towards a minimum"; else nok "another module's results do not count towards a minimum" "exit 0: $out"; fi
for bad in openverify-sdk openverify-sdk= openverify-sdk=many =3 openverify-sdk=-1; do
  run floor-met "$bad"
  if [ "$rc" -ne 0 ] && [ "${out#*usage}" != "$out" ]; then ok "the argument '$bad' is refused with the usage"; else nok "the argument '$bad' is refused with the usage" "exit $rc: $out"; fi
done
# Without minimums the check is what it was: at least one test, none skipped, failed or errored.
run floor-shrunk
if [ "$rc" -eq 0 ]; then ok "without minimums one passing test still exits 0"; else nok "without minimums one passing test still exits 0" "exit $rc: $out"; fi

finish
