#!/usr/bin/env bash
# Test for .gitleaks.toml (C169.4, reviews F02 and P33; Workflow 9B Stage 1a, contracts-9b).
#
# The repository's own gitleaks configuration extends the default rules with one rule for
# OpenVerify's bearer tokens: API keys (ov_sbx_, ov_prod_) and the session, user-session,
# one-time-link, MFA, invitation and handoff tokens (ovs_, ovu_, ovo_, ovm_, ovi_, ovh_), each
# 43 base64url characters (packages/contracts/src/tokens.ts). Tests carry token-shaped values, so
# the rule allows a token that names itself "synthetic" and one under the entropy floor.
#
# Every token this test makes is generated now from /dev/urandom, in throwaway git repositories
# under SCRATCH_ROOT (default $TMPDIR or /tmp); none is ever written to this repository.
#
# Cases:
#   1. the configuration extends the defaults and holds the rule, its allowlist and its floor;
#   2. `gitleaks git` over this repository's history stays clean with it;
#   3. a random token of every prefix, committed in a scratch repository, is caught and redacted;
#   4. the default rules still run (a generated fake AWS key is caught);
#   5. a token carrying "synthetic", and a low-entropy one, are not reported;
#   6. every token-shaped value tracked in this repository carries "synthetic", except the
#      low-entropy values listed below, which fall under the floor.
#
# Usage: infra/tests/gitleaks-config.test.sh   (needs gitleaks >= 8.19 and python3)
set -uo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
config="$repo_root/.gitleaks.toml"
scratch_root="${SCRATCH_ROOT:-${TMPDIR:-/tmp}}"
rule_id="openverify-bearer-token"
# The tracked token-shaped values without "synthetic" (measured 2026-11-06): one repeated letter,
# Shannon entropy 0.30 and 0.59 bits per character, far under the floor.
low_entropy_allowed=(
  "ovo_ooooooooooooooooooooooooooooooooooooooooooo"
  "ovs_ttttttttttttttttttttttttttttttttttttttttttt"
)

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

# 1. The configuration's shape.
if [ -f "$config" ]; then
  ok ".gitleaks.toml exists at the repository root"
  shape=$(python3 - "$config" "$rule_id" <<'PY'
import sys, tomllib
with open(sys.argv[1], "rb") as handle:
    doc = tomllib.load(handle)
rule_id = sys.argv[2]
problems = []
if doc.get("extend", {}).get("useDefault") is not True:
    problems.append("[extend] useDefault = true")
rules = [rule for rule in doc.get("rules", []) if rule.get("id") == rule_id]
if len(rules) != 1:
    problems.append(f"one rule {rule_id}")
else:
    rule = rules[0]
    if not isinstance(rule.get("entropy"), (int, float)) or rule["entropy"] <= 1:
        problems.append("an entropy floor")
    allow = rule.get("allowlists", [])
    if not any("synthetic" in "".join(entry.get("regexes", [])).lower() for entry in allow):
        problems.append("an allowlist regex on synthetic")
print("; ".join(problems))
PY
  )
  if [ -z "$shape" ]; then
    ok "it extends the default rules and holds $rule_id with its allowlist and entropy floor"
  else
    nok "it extends the default rules and holds $rule_id with its allowlist and entropy floor" "missing: $shape"
  fi
else
  nok ".gitleaks.toml exists at the repository root"
fi

scan() { # scan <dir> <report>: gitleaks git over <dir>'s history with this repository's config.
  "$gitleaks_bin" git --config "$config" --redact --no-banner --no-color \
    --report-format json --report-path "$2" "$1" >/dev/null 2>&1
}

mkdir -p "$scratch_root"
scratch=$(mktemp -d "$scratch_root/openverify-gitleaks-test.XXXXXX")
trap 'rm -rf "$scratch"' EXIT

# 2. This repository's history stays clean (CI's secrets job scans the full history; a shallow
# checkout scans what it holds).
if [ -f "$config" ] && scan "$repo_root" "$scratch/history.json"; then
  ok "gitleaks git over this repository's history finds nothing with .gitleaks.toml"
else
  nok "gitleaks git over this repository's history finds nothing with .gitleaks.toml" \
    "$(python3 -c 'import json,sys; print(sorted({f["RuleID"] for f in json.load(open(sys.argv[1]))}))' "$scratch/history.json" 2>/dev/null)"
fi

new_repo() {
  local repo="$scratch/$1"
  git init -q -b main "$repo"
  git -C "$repo" config user.name "gitleaks-test"
  git -C "$repo" config user.email "gitleaks-test@example.invalid"
  git -C "$repo" config commit.gpgsign false
  printf '%s\n' "$repo"
}
commit_file() { # commit_file <repo> <name> <content>
  printf '%s\n' "$3" >"$1/$2"
  git -C "$1" add "$2"
  git -C "$1" commit -q --no-verify -m "test: $2"
}
random_body() { head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n'; }
rules_of() { python3 -c 'import json,sys; print(" ".join(sorted({f["RuleID"] for f in json.load(open(sys.argv[1]))})))' "$1" 2>/dev/null; }
# The number of findings of rule <2> in report <1>, or "no-report" when the scan wrote none.
count_of() { python3 -c 'import json,sys; print(sum(1 for f in json.load(open(sys.argv[1])) if f["RuleID"] == sys.argv[2]))' "$1" "$2" 2>/dev/null || echo no-report; }

# 3. A random token of every prefix is caught, and the report never holds it.
repo=$(new_repo tokens)
prefixes=(ov_sbx_ ov_prod_ ovs_ ovu_ ovo_ ovm_ ovi_ ovh_)
tokens=()
content=""
for prefix in "${prefixes[@]}"; do
  token="$prefix$(random_body)"
  tokens+=("$token")
  content+="const token = '$token';"$'\n'
done
commit_file "$repo" "client.ts" "$content"
scan "$repo" "$scratch/tokens.json"
found=$(count_of "$scratch/tokens.json" "$rule_id")
if [ "$found" = "${#prefixes[@]}" ]; then
  ok "a random token of each of the ${#prefixes[@]} prefixes is caught by $rule_id"
else
  nok "a random token of each of the ${#prefixes[@]} prefixes is caught by $rule_id" "found $found"
fi
leaked=0
[ -f "$scratch/tokens.json" ] || leaked=1
for token in "${tokens[@]}"; do
  if grep -qF "$token" "$scratch/tokens.json" 2>/dev/null; then leaked=1; fi
done
if [ "$leaked" -eq 0 ]; then ok "the report redacts every token"; else nok "the report redacts every token"; fi

# A token inside a longer word is not one of ours (the rule is bounded on both sides).
repo=$(new_repo bounded)
commit_file "$repo" "notes.txt" "xov_sbx_$(random_body)yy"
scan "$repo" "$scratch/bounded.json"
if [ "$(count_of "$scratch/bounded.json" "$rule_id")" = "0" ]; then
  ok "a token-shaped run inside a longer word is not reported"
else
  nok "a token-shaped run inside a longer word is not reported"
fi

# 4. The default rules still run.
repo=$(new_repo defaults)
key_id="AKIA$(head -c 10 /dev/urandom | base32)"
secret_key=$(head -c 30 /dev/urandom | base64)
commit_file "$repo" "credentials.ini" "$(printf '[default]\naws_access_key_id = %s\naws_secret_access_key = %s' "$key_id" "$secret_key")"
scan "$repo" "$scratch/defaults.json"
case " $(rules_of "$scratch/defaults.json") " in
  *" aws-access-token "*) ok "the default rules still run (a fake AWS key is caught)" ;;
  *) nok "the default rules still run (a fake AWS key is caught)" "$(rules_of "$scratch/defaults.json")" ;;
esac

# 5. The allowlist and the floor.
repo=$(new_repo allowed)
body=$(random_body)
commit_file "$repo" "fixture.ts" "const a = 'ovs_Synthetic${body:9}';"$'\n'"const b = 'ov_sbx_SYNTHETIC${body:9}';"
scan "$repo" "$scratch/allowed.json"
if [ "$(count_of "$scratch/allowed.json" "$rule_id")" = "0" ]; then
  ok "a token carrying \"synthetic\" (any case) is allowed"
else
  nok "a token carrying \"synthetic\" (any case) is allowed"
fi
repo=$(new_repo floor)
commit_file "$repo" "fixture.ts" "const a = 'ovm_$(printf 'q%.0s' $(seq 1 43))';"
scan "$repo" "$scratch/floor.json"
if [ "$(count_of "$scratch/floor.json" "$rule_id")" = "0" ]; then
  ok "a low-entropy token (one repeated letter) falls under the floor"
else
  nok "a low-entropy token (one repeated letter) falls under the floor"
fi

# 6. Every tracked token-shaped value carries "synthetic", or is a listed low-entropy value.
pattern='(ov_(sbx|prod)|ov[suomih])_[A-Za-z0-9_-]{43}'
unnamed=()
while IFS= read -r value; do
  [ -z "$value" ] && continue
  case "${value,,}" in *synthetic*) continue ;; esac
  allowed=0
  for low in "${low_entropy_allowed[@]}"; do [ "$value" = "$low" ] && allowed=1; done
  [ "$allowed" -eq 0 ] && unnamed+=("${value:0:8}...")
done < <(git -C "$repo_root" grep -I -h -o -E "$pattern" -- . ':!infra/tests/gitleaks-config.test.sh' | sort -u)
if [ "${#unnamed[@]}" -eq 0 ]; then
  ok "every token-shaped value tracked in the repository carries \"synthetic\" (or is a listed low-entropy value)"
else
  nok "every token-shaped value tracked in the repository carries \"synthetic\" (or is a listed low-entropy value)" "${unnamed[*]}"
fi

finish
