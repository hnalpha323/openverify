#!/usr/bin/env bash
# Test for .githooks/pre-commit (gitleaks on staged changes).
#
# Runs entirely inside a throwaway git repository under SCRATCH_ROOT (default $TMPDIR or /tmp)
# whose core.hooksPath points at this repo's .githooks. The fake AWS credentials are generated
# at runtime from /dev/urandom, so no secret-shaped literal ever exists in this repository.
#
# Cases:
#   1. a clean staged change commits,
#   2. a staged fake AWS key is blocked, HEAD does not move, and the secret is not echoed,
#   3. a secret that is only in the unstaged working tree does not block a clean staged change,
#   4. without a gitleaks binary the hook fails closed;
# and the second scan (C260.3, Workflow 11C sast-pii-11c), the PII-pattern configuration
# security/gitleaks-pii.toml through security/gitleaks-pii-filter.py on the staged changes, with
# its values assembled at run time like the keys above:
#   5. a staged real-looking address in a sample-data path is blocked, HEAD does not move, the
#      finding names the rule and the file and never the value,
#   6. a staged Luhn-valid card number in a test file is blocked; the same digits with a wrong
#      check digit commit (the filter's checksum),
#   7. synthetic values (example.com, 192.0.2.0/24, a 555-01xx number) in a sample-data path, and a
#      real-looking address outside the sample-data paths, commit,
#   8. without the PII configuration, or without python3, the hook fails closed.
set -uo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
hooks_dir="$repo_root/.githooks"
hook="$hooks_dir/pre-commit"
scratch_root="${SCRATCH_ROOT:-${TMPDIR:-/tmp}}"

passed=0
failed=0
ok() { printf 'ok   - %s\n' "$1"; passed=$((passed + 1)); }
nok() { printf 'FAIL - %s%s\n' "$1" "${2:+ ($2)}"; failed=$((failed + 1)); }
finish() {
  printf '\n# %d passed, %d failed\n' "$passed" "$failed"
  if [ "$failed" -eq 0 ]; then exit 0; else exit 1; fi
}

if [ -x "$hook" ]; then ok ".githooks/pre-commit exists and is executable"; else nok ".githooks/pre-commit exists and is executable"; fi

mkdir -p "$scratch_root"
scratch=$(mktemp -d "$scratch_root/openverify-hook-test.XXXXXX")
trap 'rm -rf "$scratch"' EXIT
repo="$scratch/repo"
git init -q -b main "$repo"
g() { git -C "$repo" "$@"; }
# Scratch-repo-local config only; the OpenVerify repository's config is never touched.
g config user.name "hook-test"
g config user.email "hook-test@example.invalid"
g config commit.gpgsign false
g config core.hooksPath "$hooks_dir"
if [ -f "$repo_root/.gitleaks.toml" ]; then cp "$repo_root/.gitleaks.toml" "$repo/.gitleaks.toml"; fi
# The PII-pattern scan's configuration, allowlist and filter, as the repository holds them.
mkdir -p "$repo/security"
for pii_file in gitleaks-pii.toml gitleaks-pii-allowlist.toml gitleaks-pii-filter.py; do
  if [ -f "$repo_root/security/$pii_file" ]; then cp "$repo_root/security/$pii_file" "$repo/security/$pii_file"; fi
done

echo "# scratch" >"$repo/README.md"
g add -A
g commit -q --no-verify -m "chore: seed"

# Fake credentials, generated now: 10 random bytes -> 16 base32 chars; 30 bytes -> 40 base64 chars.
key_id="AKIA$(head -c 10 /dev/urandom | base32)"
secret_key=$(head -c 30 /dev/urandom | base64)

head_before() { g rev-parse HEAD; }

# 1. Clean staged change commits.
echo "hello" >"$repo/clean.txt"
g add clean.txt
before=$(head_before)
if out=$(g commit -m "feat: clean change" 2>&1); then
  ok "a clean staged change is committed"
else
  nok "a clean staged change is committed" "$(tail -n 3 <<<"$out" | tr '\n' ' ')"
fi
if [ "$(head_before)" != "$before" ]; then ok "HEAD advances after a clean commit"; else nok "HEAD advances after a clean commit"; fi

# 2. Staged fake AWS key is blocked.
printf '[default]\naws_access_key_id = %s\naws_secret_access_key = %s\n' "$key_id" "$secret_key" >"$repo/credentials.ini"
g add credentials.ini
before=$(head_before)
if out=$(g commit -m "feat: add credentials" 2>&1); then
  nok "a staged fake AWS key blocks the commit" "commit succeeded"
else
  ok "a staged fake AWS key blocks the commit"
fi
if [ "$(head_before)" = "$before" ]; then ok "HEAD does not move when the commit is blocked"; else nok "HEAD does not move when the commit is blocked"; fi
case "$out" in
  *aws-access-token*) ok "the finding names the aws-access-token rule" ;;
  *) nok "the finding names the aws-access-token rule" "$(tail -n 5 <<<"$out" | tr '\n' ' ')" ;;
esac
case "$out" in
  *"$key_id"* | *"$secret_key"*) nok "the hook output redacts the secret" ;;
  *) ok "the hook output redacts the secret" ;;
esac
g reset -q HEAD -- credentials.ini
rm -f "$repo/credentials.ini"

# 3. Only staged content is scanned: an unstaged secret does not block a clean staged change.
echo "staged and clean" >"$repo/staged.txt"
g add staged.txt
printf 'aws_access_key_id = %s\n' "$key_id" >"$repo/clean.txt" # modified, NOT staged
before=$(head_before)
if out=$(g commit -m "feat: staged clean change" 2>&1); then
  ok "an unstaged secret does not block a clean staged change"
else
  nok "an unstaged secret does not block a clean staged change" "$(tail -n 3 <<<"$out" | tr '\n' ' ')"
fi
g checkout -q -- clean.txt

# 5. The second scan: a real-looking address in a sample-data path is blocked.
pii_email="$(printf '%s@%s.%s' quill realmail net)"
mkdir -p "$repo/docs"
printf 'Write to %s for a copy.\n' "$pii_email" >"$repo/docs/sample.md"
g add docs/sample.md
before=$(head_before)
if out=$(g commit -m "docs: sample" 2>&1); then
  nok "a staged real-looking address in docs/ blocks the commit" "commit succeeded"
else
  ok "a staged real-looking address in docs/ blocks the commit"
fi
if [ "$(head_before)" = "$before" ]; then ok "HEAD does not move when the PII scan blocks"; else nok "HEAD does not move when the PII scan blocks"; fi
case "$out" in
  *"pii-email docs/sample.md:1"*) ok "the PII finding names the rule, the file and the line" ;;
  *) nok "the PII finding names the rule, the file and the line" "$(tail -n 5 <<<"$out" | tr '\n' ' ')" ;;
esac
case "$out" in
  *"$pii_email"*) nok "the PII finding never echoes the value" ;;
  *) ok "the PII finding never echoes the value" ;;
esac
g reset -q HEAD -- docs/sample.md
rm -f "$repo/docs/sample.md"

# 6. A Luhn-valid card number in a test file is blocked; a wrong check digit is not a card.
cards=$(python3 -I -c '
body = "4" + "53" + "9" * 4 + "1" * 5 + "07" + "8"
total = 0
for index, character in enumerate(reversed(body)):
    number = int(character)
    if index % 2 == 0:
        number = number * 2 - 9 if number * 2 > 9 else number * 2
    total += number
valid = body + str((10 - total % 10) % 10)
print(valid)
print(valid[:-1] + str((int(valid[-1]) + 1) % 10))
')
valid_card=$(sed -n 1p <<<"$cards")
invalid_card=$(sed -n 2p <<<"$cards")
mkdir -p "$repo/src"
printf "export const value = '%s';\n" "$valid_card" >"$repo/src/card.test.ts"
g add src/card.test.ts
before=$(head_before)
if out=$(g commit -m "test: card" 2>&1); then
  nok "a staged Luhn-valid card number in a test file blocks the commit" "commit succeeded"
else
  ok "a staged Luhn-valid card number in a test file blocks the commit"
fi
case "$out" in
  *"pii-card-number src/card.test.ts:1"*) ok "the card finding names its rule" ;;
  *) nok "the card finding names its rule" "$(tail -n 5 <<<"$out" | tr '\n' ' ')" ;;
esac
if [ "$(head_before)" = "$before" ]; then ok "HEAD does not move when a card number is staged"; else nok "HEAD does not move when a card number is staged"; fi
printf "export const value = '%s';\n" "$invalid_card" >"$repo/src/card.test.ts"
g add src/card.test.ts
if out=$(g commit -m "test: not a card" 2>&1); then
  ok "the same digits with a wrong check digit commit"
else
  nok "the same digits with a wrong check digit commit" "$(tail -n 3 <<<"$out" | tr '\n' ' ')"
fi

# 7. Synthetic values in a sample-data path, and a real-looking address outside them, commit.
printf 'Write to %s@%s from %s or call %s.\n' quinn example.com 192.0.2.10 "+1 202 555 0143" >"$repo/docs/synthetic.md"
printf "export const contact = '%s';\n" "$pii_email" >"$repo/src/config.ts"
g add docs/synthetic.md src/config.ts
before=$(head_before)
if out=$(g commit -m "docs: synthetic" 2>&1); then
  ok "synthetic values in docs/ and an address outside the sample-data paths commit"
else
  nok "synthetic values in docs/ and an address outside the sample-data paths commit" "$(tail -n 3 <<<"$out" | tr '\n' ' ')"
fi
if [ "$(head_before)" != "$before" ]; then ok "HEAD advances after the synthetic commit"; else nok "HEAD advances after the synthetic commit"; fi

# 8. Fail closed without the PII configuration, and without python3.
empty_home_np="$scratch/empty-home-no-python"
mkdir -p "$empty_home_np"
mv "$repo/security/gitleaks-pii.toml" "$scratch/gitleaks-pii.toml.away"
echo "again" >"$repo/again.txt"
g add again.txt
before=$(head_before)
if out=$(g commit -m "feat: again" 2>&1); then
  nok "the hook fails closed without the PII configuration" "commit succeeded"
else
  ok "the hook fails closed without the PII configuration"
fi
case "$out" in
  *gitleaks-pii.toml*) ok "the fail-closed message names the PII configuration" ;;
  *) nok "the fail-closed message names the PII configuration" "$(tail -n 3 <<<"$out" | tr '\n' ' ')" ;;
esac
if [ "$(head_before)" = "$before" ]; then ok "HEAD does not move without the PII configuration"; else nok "HEAD does not move without the PII configuration"; fi
mv "$scratch/gitleaks-pii.toml.away" "$repo/security/gitleaks-pii.toml"
no_python="$scratch/no-python-bin"
mkdir -p "$no_python"
ln -s "$(command -v git)" "$no_python/git"
gitleaks_found=$(command -v gitleaks 2>/dev/null || true)
if [ -z "$gitleaks_found" ] && [ -x "${HOME:-}/.local/bin/gitleaks" ]; then gitleaks_found="$HOME/.local/bin/gitleaks"; fi
if [ -n "$gitleaks_found" ]; then ln -s "$gitleaks_found" "$no_python/gitleaks"; fi
if out=$(env HOME="$empty_home_np" PATH="$no_python" git -C "$repo" commit -m "feat: again" 2>&1); then
  nok "the hook fails closed without python3" "commit succeeded"
else
  ok "the hook fails closed without python3"
fi
case "$out" in
  *python3*) ok "the fail-closed message names python3" ;;
  *) nok "the fail-closed message names python3" "$(tail -n 3 <<<"$out" | tr '\n' ' ')" ;;
esac
if [ "$(head_before)" = "$before" ]; then ok "HEAD does not move without python3"; else nok "HEAD does not move without python3"; fi
g reset -q HEAD -- again.txt
rm -f "$repo/again.txt"

# 4. Fail closed when gitleaks is unavailable (no gitleaks on PATH, empty HOME).
empty_home="$scratch/empty-home"
mkdir -p "$empty_home"
echo "more" >"$repo/more.txt"
g add more.txt
before=$(head_before)
if out=$(env HOME="$empty_home" PATH="/usr/bin:/bin" git -C "$repo" commit -m "feat: more" 2>&1); then
  nok "the hook fails closed without gitleaks" "commit succeeded"
else
  ok "the hook fails closed without gitleaks"
fi
case "$out" in
  *install-gitleaks.sh*) ok "the fail-closed message points to the installer" ;;
  *) nok "the fail-closed message points to the installer" "$(tail -n 3 <<<"$out" | tr '\n' ' ')" ;;
esac
if [ "$(head_before)" = "$before" ]; then ok "HEAD does not move when gitleaks is missing"; else nok "HEAD does not move when gitleaks is missing"; fi

finish
