#!/usr/bin/env bash
# Test for the PII-pattern scan (C260.3, decision 16, review P29; Workflow 11C, sast-pii-11c):
# security/gitleaks-pii.toml, its reviewed allowlist security/gitleaks-pii-allowlist.toml and
# security/gitleaks-pii-filter.py, run with the real pinned gitleaks.
#
# Every value that should be caught is assembled here at run time from fragments (card and IBAN
# check digits computed), written only to throwaway directories under SCRATCH_ROOT (default
# $TMPDIR or /tmp), and never echoed: this file itself is in the scan's scope.
#
# Cases:
#   1. the configuration, the allowlist and the filter exist; the configuration loads;
#   2. each rule catches its positive value in a sample-data path, and the output names the rule
#      but never the value;
#   3. the allowed values (reserved names, documentation ranges, fictitious numbers, the
#      synthetic generators' names, test card numbers, checksum failures) are not reported;
#   4. a positive value outside the sample-data paths is not read, and the load seed's source is;
#   5. generated and installed files (node_modules, e2e/.artifacts, e2e/.env.e2e) are not read;
#   6. the committed tree (git archive HEAD) passes.
#
# Usage: infra/tests/gitleaks-pii.test.sh   (needs gitleaks >= 8.19, python3 and git)
set -uo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
config="$repo_root/security/gitleaks-pii.toml"
allowlist="$repo_root/security/gitleaks-pii-allowlist.toml"
filter="$repo_root/security/gitleaks-pii-filter.py"
scratch_root="${SCRATCH_ROOT:-${TMPDIR:-/tmp}}"

passed=0
failed=0
ok() { printf 'ok   - %s\n' "$1"; passed=$((passed + 1)); }
nok() { printf 'FAIL - %s%s\n' "$1" "${2:+ ($2)}"; failed=$((failed + 1)); }
finish() {
  printf '\n# %d passed, %d failed\n' "$passed" "$failed"
  if [ "$failed" -eq 0 ]; then exit 0; else exit 1; fi
}

gitleaks_bin=$(command -v gitleaks 2>/dev/null || true)
if [ -z "$gitleaks_bin" ] && [ -x "${HOME:-}/.local/bin/gitleaks" ]; then
  gitleaks_bin="$HOME/.local/bin/gitleaks"
fi
if [ -z "$gitleaks_bin" ]; then
  nok "gitleaks is installed (infra/scripts/install-gitleaks.sh)"
  finish
fi

# 1. The files.
for file in "$config" "$allowlist" "$filter"; do
  if [ -f "$file" ]; then ok "${file#"$repo_root"/} exists"; else nok "${file#"$repo_root"/} exists"; fi
done
if python3 -I - "$config" "$allowlist" <<'PY'
import sys, tomllib
for path in sys.argv[1:]:
    with open(path, "rb") as handle:
        tomllib.load(handle)
PY
then ok "both files are valid TOML"; else nok "both files are valid TOML"; fi

mkdir -p "$scratch_root"
scratch=$(mktemp -d "$scratch_root/openverify-pii-test.XXXXXX")
trap 'rm -rf "$scratch"' EXIT

# Runs the filter from the repository root (gitleaks resolves [extend] from the working
# directory) over one directory; sets $out and $status.
scan() {
  out=$(cd "$repo_root" && python3 -I security/gitleaks-pii-filter.py --gitleaks "$gitleaks_bin" dir "$1" 2>&1)
  status=$?
}

# The assembled values (never literals in this file).
values=$(python3 -I - <<'PY'
def luhn(body):
    total = 0
    for index, character in enumerate(reversed(body)):
        number = int(character)
        if index % 2 == 0:
            number = number * 2 - 9 if number * 2 > 9 else number * 2
        total += number
    return body + str((10 - total % 10) % 10)
def iban(country, bban):
    number = int("".join(str(int(c, 36)) for c in bban + country + "00"))
    return f"{country}{98 - number % 97:02d}{bban}"
card = luhn("4" + "53" + "9" * 4 + "1" * 5 + "07" + "8")
bad_card = card[:-1] + str((int(card[-1]) + 1) % 10)
account = iban("FR", "3" * 10 + "7" * 13)
bad_account = account[:2] + f"{(int(account[2:4]) + 1) % 100:02d}" + account[4:]
test_card = " ".join(["4" + "2" + "4" + "2"] * 4)
print("\n".join([card, bad_card, account, bad_account, test_card]))
PY
)
card=$(sed -n 1p <<<"$values")
bad_card=$(sed -n 2p <<<"$values")
account=$(sed -n 3p <<<"$values")
bad_account=$(sed -n 4p <<<"$values")
test_card=$(sed -n 5p <<<"$values")

declare -A positive
positive[pii-email]="$(printf '%s@%s.%s' zed realmail net)"
positive[pii-ipv4]="$(printf '%s.%s.%s.%s' 81 23 45 67)"
positive[pii-ipv6]="$(printf '%s:%s:%s::%s' 2a01 4f8 c17 7)"
positive[pii-phone]="$(printf '+%s %s %s' 44 7911 604315)"
positive[pii-mrz-name]="$(printf 'P<UTO%s<<%s<<<<<<<' ZEPHYRINE OSWIN)"
positive[pii-card-number]="$card"
positive[pii-iban]="$account"
positive[pii-us-ssn]="$(printf '%s-%s-%s' 512 38 4096)"

# 2. Each rule catches its value, in a docs/ path and in a test file, without echoing it.
for rule in pii-email pii-ipv4 pii-ipv6 pii-phone pii-mrz-name pii-card-number pii-iban pii-us-ssn; do
  case_dir="$scratch/positive-$rule"
  mkdir -p "$case_dir/docs" "$case_dir/apps/api/src"
  printf 'A sample line: %s here.\n' "${positive[$rule]}" >"$case_dir/docs/sample.md"
  printf "export const value = '%s';\n" "${positive[$rule]}" >"$case_dir/apps/api/src/sample.test.ts"
  scan "$case_dir"
  if [ "$status" -eq 1 ] && grep -qF "$rule $case_dir/docs/sample.md:1" <<<"$out" &&
    grep -qF "$rule $case_dir/apps/api/src/sample.test.ts:1" <<<"$out"; then
    ok "$rule catches its value in docs/ and in a test file"
  else
    nok "$rule catches its value in docs/ and in a test file" "exit $status: $(tail -n 3 <<<"$out" | tr '\n' ' ')"
  fi
  case "$out" in
    *"${positive[$rule]}"*) nok "$rule's finding does not echo the value" ;;
    *) ok "$rule's finding does not echo the value" ;;
  esac
done

# 3. The allowed values.
allowed_dir="$scratch/allowed"
mkdir -p "$allowed_dir/e2e"
{
  printf 'mail %s@%s and %s@%s and %s@%s\n' quinn example.com ops mail.example.test a b.invalid
  printf 'hosts %s %s %s %s %s\n' 192.0.2.10 198.51.100.7 203.0.113.250 127.0.0.1 10.0.2.2
  printf 'private %s %s %s and networks %s %s\n' 10.0.0.5 169.254.169.254 100.64.0.1 "81.23.0.0/16" "2a01:4f8::/32"
  printf 'v6 %s %s %s\n' 2001:db8::5 ::1 fe80::1
  printf 'phones %s %s %s %s\n' "+1 202 555 0143" "+44 20 7946 0958" "+44 7700 900123" "+61 491 570 156"
  printf 'mrz %s\n' "P<UTO$(printf '%s<<%s<%s' ERIKSSON ANNA MARIA)<<<<<<<<<<<<<<<<<<<"
  printf 'cards %s %s\n' "$bad_card" "$test_card"
  printf 'iban %s\n' "$bad_account"
  printf 'ssn %s %s %s\n' "$(printf '%s-%s-%s' 000 12 3456)" "$(printf '%s-%s-%s' 912 34 5678)" "$(printf '%s-%s-%s' 512 00 4096)"
  printf 'versions Chrome/%s and section %s\n' 130.0.0.0 "§4.1.6.3"
} >"$allowed_dir/e2e/sample.spec.ts"
scan "$allowed_dir"
if [ "$status" -eq 0 ]; then
  ok "reserved, documentation, fictitious, synthetic and checksum-failing values are not reported"
else
  nok "reserved, documentation, fictitious, synthetic and checksum-failing values are not reported" "$(tail -n 4 <<<"$out" | tr '\n' ' ')"
fi

# 4. Outside the sample-data paths nothing is read.
outside_dir="$scratch/outside"
mkdir -p "$outside_dir/apps/api/src"
printf "export const value = '%s';\n" "${positive[pii-email]}" >"$outside_dir/apps/api/src/config.ts"
scan "$outside_dir"
if [ "$status" -eq 0 ]; then ok "a source file outside the sample-data paths is not read"; else nok "a source file outside the sample-data paths is not read" "exit $status"; fi

# 4b. The load seed's source is read (Workflow 11D, KP11-35): seed:load lives in apps/api/scripts/.
seed_load_dir="$scratch/seed-load"
mkdir -p "$seed_load_dir/apps/api/scripts"
printf "export const value = '%s';\n" "${positive[pii-email]}" >"$seed_load_dir/apps/api/scripts/seed-load.ts"
scan "$seed_load_dir"
if [ "$status" -eq 1 ] && grep -qF "pii-email $seed_load_dir/apps/api/scripts/seed-load.ts:1" <<<"$out"; then
  ok "the load seed's source (apps/api/scripts/seed-load.ts) is read"
else
  nok "the load seed's source (apps/api/scripts/seed-load.ts) is read" "exit $status"
fi

# 5. Generated and installed files are not read (gitleaks dir does not read .gitignore).
generated_dir="$scratch/generated"
mkdir -p "$generated_dir/node_modules/pkg/test" "$generated_dir/e2e/.artifacts"
printf '%s\n' "${positive[pii-email]}" >"$generated_dir/node_modules/pkg/test/a.test.js"
printf '{"admin": "%s"}\n' "${positive[pii-email]}" >"$generated_dir/e2e/.artifacts/stack.json"
printf 'OPENVERIFY_E2E_ADMIN=%s\n' "${positive[pii-email]}" >"$generated_dir/e2e/.env.e2e"
printf '%s\n' "${positive[pii-email]}" >"$generated_dir/.gitignore"
scan "$generated_dir"
if [ "$status" -eq 0 ]; then
  ok "node_modules, e2e/.artifacts and e2e/.env.e2e are not read"
else
  nok "node_modules, e2e/.artifacts and e2e/.env.e2e are not read" "$(tail -n 3 <<<"$out" | tr '\n' ' ')"
fi

# 5b. Workflow 11D's results trees (load/results/, packages/watchlist/results/) are generated and
# gitignored like the trees above, so they are not read although load/ is in the rules' scope
# (fix-11d: the calibrations' raw takes there hold pg_stat_statements' query ids, which match the
# card-number pattern).
results_dir="$scratch/results"
mkdir -p "$results_dir/load/results/reference" "$results_dir/packages/watchlist/results/phase11-11d"
printf '{"admin": "%s"}\n' "${positive[pii-email]}" >"$results_dir/load/results/reference/a.statements.json"
printf '{"admin": "%s"}\n' "${positive[pii-email]}" >"$results_dir/packages/watchlist/results/phase11-11d/b.json"
scan "$results_dir"
if [ "$status" -eq 0 ]; then
  ok "load/results and packages/watchlist/results are not read"
else
  nok "load/results and packages/watchlist/results are not read" "$(tail -n 3 <<<"$out" | tr '\n' ' ')"
fi

# 6. The committed tree passes.
tree_dir="$scratch/tree"
mkdir -p "$tree_dir"
if git -C "$repo_root" archive HEAD | tar -x -C "$tree_dir"; then
  scan "$tree_dir"
  if [ "$status" -eq 0 ]; then
    ok "the committed tree (HEAD) passes the PII scan"
  else
    nok "the committed tree (HEAD) passes the PII scan" "$(tail -n 6 <<<"$out" | sed "s#$tree_dir/##" | tr '\n' ' ')"
  fi
else
  nok "the committed tree (HEAD) can be read with git archive"
fi

finish
