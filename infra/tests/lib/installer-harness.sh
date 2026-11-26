#!/usr/bin/env bash
# Shared harness for infra/tests/install-<tool>.test.sh (Workflow 11C scanners-11c; C258.2).
# Sourced, never run. It gives each installer test:
#   - ok / nok / skip / expect_match / finish, the counters every infra test prints;
#   - a fake `curl` first on PATH that serves a synthetic release from a directory, answering each
#     call from a plan file per requested file name (an HTTP status, or "net" for a connection
#     failure), then 200, as infra/tests/install-gitleaks.test.sh's does (KP10-2);
#   - a fake `uname` (an unsupported platform must fail closed before any download);
#   - a fake `cosign` that records its arguments and answers from a file, so a signature failure and
#     the identity and issuer the installer asks for are checked offline (the installer refuses a
#     cosign whose SHA-256 is not the pinned one, so the tests pass the fake's own through
#     COSIGN_BIN and COSIGN_BIN_SHA256);
#   - run_installer, which runs the installer under test in a fresh case directory and sets
#     case_dir, case_out, case_rc and case_calls.
# No test here touches the network except the "network" half of each installer test, which
# downloads only its pinned release from the tool's official origin (the plan's rule "No network
# in tests": an installer test is a local and CI check, never part of a Vitest or pytest suite).
set -uo pipefail

h_repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
h_scratch_root="${SCRATCH_ROOT:-${TMPDIR:-/tmp}}"
passed=0
failed=0
skipped=0
ok() { printf 'ok   - %s\n' "$1"; passed=$((passed + 1)); }
nok() { printf 'FAIL - %s%s\n' "$1" "${2:+ ($2)}"; failed=$((failed + 1)); }
skip() { printf 'skip - %s\n' "$1"; skipped=$((skipped + 1)); }
check() { # check <description> <command...>: ok when the command succeeds
  local desc=$1
  shift
  if "$@"; then ok "$desc"; else nok "$desc"; fi
}
expect_match() { # expect_match <description> <glob> <actual>
  # shellcheck disable=SC2254 # the glob is intentionally unquoted
  case "$3" in
    $2) ok "$1" ;;
    *) nok "$1" "expected match for '$2', got: $(printf '%s' "$3" | tail -n 4 | tr '\n' ' ')" ;;
  esac
}
expect_no_match() { # expect_no_match <description> <glob> <actual>
  # shellcheck disable=SC2254
  case "$3" in
    $2) nok "$1" "unexpected match for '$2'" ;;
    *) ok "$1" ;;
  esac
}
finish() {
  printf '\n# %d passed, %d failed, %d skipped\n' "$passed" "$failed" "$skipped"
  if [ "$failed" -eq 0 ]; then exit 0; else exit 1; fi
}

# h_init <installer path relative to the repository root>: sets installer and work (a private
# scratch directory removed on exit), and writes the fakes into $shim_bin.
h_init() {
  installer="$h_repo_root/$1"
  mkdir -p "$h_scratch_root"
  work=$(mktemp -d "$h_scratch_root/openverify-installer-test.XXXXXX")
  # shellcheck disable=SC2064 # expand now: the path is fixed
  trap "rm -rf '$work'" EXIT
  shim_bin="$work/shim-bin"
  uname_bin="$work/uname-bin"
  mkdir -p "$shim_bin" "$uname_bin"
  h_write_fake_curl "$shim_bin/curl"
  h_write_fake_cosign "$work/fake-cosign"
  fake_cosign="$work/fake-cosign"
  fake_cosign_sha256=$(sha256sum "$fake_cosign" | cut -d' ' -f1)
  printf '#!/bin/sh\ncase "$1" in -s) echo Darwin ;; -m) echo arm64 ;; *) echo "Darwin arm64" ;; esac\n' >"$uname_bin/uname"
  chmod 0755 "$uname_bin/uname"
  release="$work/release"
  mkdir -p "$release"
}

h_write_fake_curl() {
  cat >"$1" <<'SHIM'
#!/usr/bin/env bash
# Fake curl: answers from "$FAKE_CURL_DIR/plan.<file>", one line per call (an HTTP status, or
# "net"), then 200; serves "$FAKE_CURL_DIR/serve/<file>", where <file> is the URL's last segment.
set -u
out='' format='' url='' fail=0 previous=''
for arg in "$@"; do
  case "$previous" in
    -o) out=$arg ;;
    -w) format=$arg ;;
  esac
  case "$arg" in
    --fail) fail=1 ;;
    --*) ;;
    -[a-zA-Z]*) case "$arg" in *f*) fail=1 ;; esac ;;
  esac
  previous=$arg
  url=$arg
done
file=${url##*/}
printf '%s\n' "$*" >>"$FAKE_CURL_DIR/calls"
plan="$FAKE_CURL_DIR/plan.$file"
answer=200
if [ -s "$plan" ]; then
  answer=$(head -n 1 "$plan")
  tail -n +2 "$plan" >"$plan.next" && mv "$plan.next" "$plan"
fi
if [ "$answer" = 200 ] && [ ! -f "$FAKE_CURL_DIR/serve/$file" ]; then
  answer=404
fi
if [ "$answer" = net ]; then
  [ "$format" = '%{http_code}' ] && printf '000'
  echo "curl: (7) Failed to connect to the release host" >&2
  exit 7
fi
if [ "$answer" = 200 ]; then
  cp "$FAKE_CURL_DIR/serve/$file" "$out"
else
  printf 'error %s\n' "$answer" >"$out"
fi
[ "$format" = '%{http_code}' ] && printf '%s' "$answer"
if [ "$answer" -ge 400 ] && [ "$fail" = 1 ]; then
  echo "curl: (22) The requested URL returned error: $answer" >&2
  exit 22
fi
exit 0
SHIM
  chmod 0755 "$1"
}

h_write_fake_cosign() {
  cat >"$1" <<'SHIM'
#!/usr/bin/env bash
# Fake cosign: records its arguments; `verify-blob` answers from "$FAKE_COSIGN_DIR/answer"
# (0 = Verified OK, anything else = a verification failure; absent = 0).
set -u
printf '%s\n' "$*" >>"$FAKE_COSIGN_DIR/calls"
answer=0
[ -s "$FAKE_COSIGN_DIR/answer" ] && answer=$(cat "$FAKE_COSIGN_DIR/answer")
if [ "${1:-}" = verify-blob ]; then
  if [ "$answer" = 0 ]; then
    echo "Verified OK" >&2
    exit 0
  fi
  echo "Error: none of the expected identities matched what was in the certificate" >&2
  exit 1
fi
echo "fake cosign: unexpected command $*" >&2
exit 2
SHIM
  chmod 0755 "$1"
}

# h_stub_binary <path> <version line>: a stand-in executable that prints its version line for any
# argument, the way each tool's own version command is read.
h_stub_binary() {
  mkdir -p "$(dirname "$1")"
  printf '#!/bin/sh\nprintf "%%s\\n" "%s"\n' "$2" >"$1"
  chmod 0755 "$1"
}

h_sha256() { sha256sum "$1" | cut -d' ' -f1; }

# run_installer <case name> [VAR=value ...]: runs $installer against $release (served by the fake
# curl) in a fresh case directory. Each "plan.<file>=<answers>" argument (space separated answers)
# sets a download plan; "uname=unsupported" puts the fake uname first on PATH; "cosign=fail" makes
# the fake cosign refuse; "cosign=none" passes no cosign at all. The other arguments are passed to
# the installer's environment. Sets case_dir, case_out, case_rc, case_calls, case_cosign_calls.
run_installer() {
  local name=$1 path_prefix="$shim_bin" cosign_mode=pass
  shift
  case_dir="$work/case-$name"
  mkdir -p "$case_dir/fake" "$case_dir/cosign"
  ln -s "$release" "$case_dir/fake/serve"
  : >"$case_dir/fake/calls"
  : >"$case_dir/cosign/calls"
  local env_args=() arg
  for arg in "$@"; do
    case "$arg" in
      plan.*=*)
        local file=${arg%%=*}
        file=${file#plan.}
        printf '%s' "${arg#*=}" | tr ' ' '\n' | sed '/^$/d' >"$case_dir/fake/plan.$file"
        ;;
      uname=unsupported) path_prefix="$uname_bin:$shim_bin" ;;
      cosign=fail) printf '1' >"$case_dir/cosign/answer" ;;
      cosign=none) cosign_mode=none ;;
      *) env_args+=("$arg") ;;
    esac
  done
  local cosign_env=(COSIGN_BIN="$fake_cosign" COSIGN_BIN_SHA256="$fake_cosign_sha256")
  if [ "$cosign_mode" = none ]; then
    cosign_env=(COSIGN_BIN="$case_dir/no-such-cosign")
  fi
  case_out=$(env PATH="$path_prefix:$PATH" FAKE_CURL_DIR="$case_dir/fake" FAKE_COSIGN_DIR="$case_dir/cosign" \
    INSTALL_DIR="$case_dir/bin" HOME="$case_dir/home" INSTALL_RETRY_DELAY_SECONDS=0 HELM_PLUGINS="$case_dir/plugins" \
    "${cosign_env[@]}" "${env_args[@]}" bash "$installer" 2>&1)
  case_rc=$?
  case_calls=$(cat "$case_dir/fake/calls")
  case_cosign_calls=$(cat "$case_dir/cosign/calls")
}
calls_for() { grep -c -- "/$1\$" <<<"$case_calls"; }
nothing_installed() {
  local d
  for d in "$case_dir/bin" "$case_dir/plugins"; do
    if [ -e "$d" ] && [ -n "$(ls -A "$d")" ]; then return 1; fi
  done
  return 0
}
# h_extra: extra installer environment every shared case passes (the second Helm's pins, for one).
h_extra=()

# The checks every installer shares, offline. Each test defines the release first (h_release_*),
# then calls these with the prefix, the synthetic version and SHA-256, the file name of its
# release checksum source and the line a tampered or missing checksum file has instead.
# fail_closed_cases <prefix> <version> <sha256> <checksum file> <tampered content> <missing content>
fail_closed_cases() {
  local prefix=$1 version=$2 sha=$3 sums=$4 tampered=$5 missing=$6 saved
  run_installer wrong-pin ${h_extra[@]+"${h_extra[@]}"} "${prefix}_VERSION=$version" "${prefix}_SHA256=0000000000000000000000000000000000000000000000000000000000000000"
  if [ "$case_rc" -ne 0 ] && nothing_installed; then ok "a wrong pin fails closed, nothing installed"; else nok "a wrong pin fails closed, nothing installed" "exit $case_rc"; fi
  expect_match "a wrong pin is reported as a checksum failure against the pinned SHA-256" "*checksum failure*pinned SHA-256*" "$case_out"

  saved="$work/saved-$sums"
  cp "$release/$sums" "$saved"
  printf '%s\n' "$tampered" >"$release/$sums"
  run_installer tampered ${h_extra[@]+"${h_extra[@]}"} "${prefix}_VERSION=$version" "${prefix}_SHA256=$sha"
  if [ "$case_rc" -ne 0 ] && nothing_installed; then ok "a tampered release checksum fails closed, nothing installed"; else nok "a tampered release checksum fails closed, nothing installed" "exit $case_rc"; fi
  expect_match "a tampered checksum is reported against the release's checksum source" "*checksum failure*does not match the release*" "$case_out"

  printf '%s\n' "$missing" >"$release/$sums"
  run_installer missing-line ${h_extra[@]+"${h_extra[@]}"} "${prefix}_VERSION=$version" "${prefix}_SHA256=$sha"
  if [ "$case_rc" -ne 0 ] && nothing_installed; then ok "a release checksum source without the asset's line fails closed, nothing installed"; else nok "a release checksum source without the asset's line fails closed, nothing installed" "exit $case_rc"; fi
  expect_match "a missing release line is reported as not listed" "*checksum failure*not listed*" "$case_out"
  cp "$saved" "$release/$sums"

  run_installer platform ${h_extra[@]+"${h_extra[@]}"} uname=unsupported "${prefix}_VERSION=$version" "${prefix}_SHA256=$sha"
  if [ "$case_rc" -eq 2 ] && nothing_installed && [ -z "$case_calls" ]; then
    ok "an unsupported platform fails closed with exit 2 before any download"
  else
    nok "an unsupported platform fails closed with exit 2 before any download" "exit $case_rc, calls: $(tr '\n' ';' <<<"$case_calls")"
  fi
  expect_match "the platform refusal names linux x86_64" "*only linux x86_64*" "$case_out"

  run_installer version-alone ${h_extra[@]+"${h_extra[@]}"} "${prefix}_VERSION=$version"
  if [ "$case_rc" -eq 2 ] && nothing_installed && [ -z "$case_calls" ]; then
    ok "a version without its SHA-256 is refused (exit 2) before any download"
  else
    nok "a version without its SHA-256 is refused (exit 2) before any download" "exit $case_rc"
  fi
  expect_match "the refusal names the missing variable" "*${prefix}_SHA256*" "$case_out"
}

# signature_cases <prefix> <version> <sha256> <expected identity> <expected issuer>
signature_cases() {
  local prefix=$1 version=$2 sha=$3 identity=$4 issuer=$5
  run_installer sig-fail ${h_extra[@]+"${h_extra[@]}"} cosign=fail "${prefix}_VERSION=$version" "${prefix}_SHA256=$sha"
  if [ "$case_rc" -ne 0 ] && nothing_installed; then ok "a signature that does not verify fails closed, nothing installed"; else nok "a signature that does not verify fails closed, nothing installed" "exit $case_rc"; fi
  expect_match "the refusal is reported as a signature failure" "*signature failure*" "$case_out"
  run_installer sig-none ${h_extra[@]+"${h_extra[@]}"} cosign=none "${prefix}_VERSION=$version" "${prefix}_SHA256=$sha"
  if [ "$case_rc" -ne 0 ] && nothing_installed; then ok "no cosign to check the signature fails closed, nothing installed"; else nok "no cosign to check the signature fails closed, nothing installed" "exit $case_rc"; fi
  expect_match "the refusal says to install cosign first" "*install-cosign.sh*" "$case_out"
  run_installer sig-args ${h_extra[@]+"${h_extra[@]}"} "${prefix}_VERSION=$version" "${prefix}_SHA256=$sha"
  expect_match "cosign is asked for the release's certificate identity" "*--certificate-identity $identity *" "$case_cosign_calls"
  expect_match "cosign is asked for the release's OIDC issuer" "*--certificate-oidc-issuer $issuer *" "$case_cosign_calls"
  run_installer sig-wrong-cosign ${h_extra[@]+"${h_extra[@]}"} "${prefix}_VERSION=$version" "${prefix}_SHA256=$sha" COSIGN_BIN_SHA256=1111111111111111111111111111111111111111111111111111111111111111
  if [ "$case_rc" -ne 0 ] && nothing_installed && [ -z "$case_cosign_calls" ]; then
    ok "a cosign whose SHA-256 is not the pinned one is never run, nothing installed"
  else
    nok "a cosign whose SHA-256 is not the pinned one is never run, nothing installed" "exit $case_rc, cosign calls: $case_cosign_calls"
  fi
}

# network_cosign <dir>: installs the real pinned cosign into <dir> for a network case.
network_cosign() {
  INSTALL_DIR="$1" bash "$h_repo_root/infra/scripts/install-cosign.sh" >"$work/network-cosign.log" 2>&1
}

# offline_only: true when the test was asked to skip its network half (--offline-only).
offline_only=0
for h_arg in "$@"; do
  [ "$h_arg" = --offline-only ] && offline_only=1
done
unset h_arg
