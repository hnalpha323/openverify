#!/usr/bin/env bash
# Test for infra/scripts/install-gitleaks.sh.
#   - a tampered/mismatched SHA-256 pin must abort the install and leave nothing behind,
#   - the default (pinned) install must verify the release checksums file and the pin,
#     install an executable into INSTALL_DIR, and report the pinned version.
# Needs network access to github.com. Installs only into throwaway temp directories.
set -uo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
installer="$repo_root/infra/scripts/install-gitleaks.sh"
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

if [ -x "$installer" ]; then ok "infra/scripts/install-gitleaks.sh exists and is executable"; else nok "infra/scripts/install-gitleaks.sh exists and is executable"; finish; fi

mkdir -p "$scratch_root"
work=$(mktemp -d "$scratch_root/openverify-gitleaks-install.XXXXXX")
trap 'rm -rf "$work"' EXIT

# ---------------------------------------------------------------- offline ----
# KP10-2 (Workflow 10A): CI 42476248527's infra job failed on one HTTP 504 from GitHub's release
# host. These checks need no network: a fake `curl` first on PATH answers each call from a plan
# (an HTTP status, or "net" for a connection failure) and serves a synthetic release, a tarball
# holding a stand-in `gitleaks` script, with its own checksums file, through GITLEAKS_VERSION and
# GITLEAKS_SHA256. Like the real curl, it exits 22 on a status of 400 or more under -f/--fail, and
# answers the status for -w '%{http_code}'.
fake_version="0.0.1"
fake_tarball="gitleaks_${fake_version}_linux_x64.tar.gz"
fake_checksums="gitleaks_${fake_version}_checksums.txt"
release="$work/release"
mkdir -p "$release/build"
printf '#!/bin/sh\necho %s\n' "$fake_version" >"$release/build/gitleaks"
chmod 0755 "$release/build/gitleaks"
tar -czf "$release/$fake_tarball" -C "$release/build" gitleaks
fake_sha256=$(sha256sum "$release/$fake_tarball" | cut -d' ' -f1)
printf '%s  %s\n' "$fake_sha256" "$fake_tarball" >"$release/$fake_checksums"

shim_bin="$work/shim-bin"
mkdir -p "$shim_bin"
cat >"$shim_bin/curl" <<'SHIM'
#!/usr/bin/env bash
# Fake curl for install-gitleaks.test.sh: answers from "$FAKE_CURL_DIR/plan.<file>", one line per
# call (an HTTP status, or "net"), then 200; serves "$FAKE_CURL_DIR/serve/<file>".
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
chmod 0755 "$shim_bin/curl"

# offline_install <name> <tarball plan> <checksums plan> [env...]: runs the installer against the
# fake release in a fresh case directory; sets case_dir, case_out, case_rc and case_calls.
offline_install() {
  local name=$1 tarball_plan=$2 checksums_plan=$3
  shift 3
  case_dir="$work/case-$name"
  mkdir -p "$case_dir/fake"
  ln -s "$release" "$case_dir/fake/serve"
  printf '%s' "$tarball_plan" | tr ' ' '\n' | sed '/^$/d' >"$case_dir/fake/plan.$fake_tarball"
  printf '%s' "$checksums_plan" | tr ' ' '\n' | sed '/^$/d' >"$case_dir/fake/plan.$fake_checksums"
  : >"$case_dir/fake/calls"
  case_out=$(env PATH="$shim_bin:$PATH" FAKE_CURL_DIR="$case_dir/fake" INSTALL_DIR="$case_dir/bin" \
    GITLEAKS_VERSION="$fake_version" GITLEAKS_SHA256="$fake_sha256" GITLEAKS_RETRY_DELAY_SECONDS=0 \
    "$@" "$installer" 2>&1)
  case_rc=$?
  case_calls=$(cat "$case_dir/fake/calls")
}
calls_for() { grep -c -- "/$1\$" <<<"$case_calls"; }

# A. Two 504s for the tarball, one for the checksums file, then the release: it installs.
offline_install transient "504 504" "504"
if [ "$case_rc" -eq 0 ]; then ok "offline: the install survives HTTP 504s from the release host (KP10-2)"; else nok "offline: the install survives HTTP 504s from the release host (KP10-2)" "exit $case_rc: $(tail -n 2 <<<"$case_out" | tr '\n' ' ')"; fi
if [ "$(calls_for "$fake_tarball")" = 3 ] && [ "$(calls_for "$fake_checksums")" = 2 ]; then
  ok "offline: each 504 is retried, once per answer, and the download stops at the first 200"
else
  nok "offline: each 504 is retried, once per answer, and the download stops at the first 200" "tarball $(calls_for "$fake_tarball"), checksums $(calls_for "$fake_checksums")"
fi
expect_match "offline: the retried tarball still passes the release checksums file" "*release checksums file: OK*" "$case_out"
expect_match "offline: the retried tarball still passes the pinned SHA-256" "*pinned SHA-256: OK*" "$case_out"
if [ -x "$case_dir/bin/gitleaks" ]; then ok "offline: gitleaks is installed after the retries"; else nok "offline: gitleaks is installed after the retries"; fi

# B. A connection failure, then a 502 and a 500, then the release: it installs.
offline_install network "net 502 500" ""
if [ "$case_rc" -eq 0 ] && [ "$(calls_for "$fake_tarball")" = 4 ]; then
  ok "offline: a connection failure and other 5xx answers are retried too"
else
  nok "offline: a connection failure and other 5xx answers are retried too" "exit $case_rc, $(calls_for "$fake_tarball") tarball calls"
fi

# C. The host stays down: a bounded number of attempts, then a failure that names the status.
offline_install outage "504 504 504 504 504 504 504 504 504 504" ""
if [ "$case_rc" -ne 0 ]; then ok "offline: an outage that outlasts the retries fails the install"; else nok "offline: an outage that outlasts the retries fails the install" "exit 0"; fi
if [ "$(calls_for "$fake_tarball")" = 5 ]; then ok "offline: the retries are bounded (5 attempts)"; else nok "offline: the retries are bounded (5 attempts)" "$(calls_for "$fake_tarball") attempts"; fi
expect_match "offline: the failure names the last HTTP status" "*504*" "$case_out"
if [ ! -e "$case_dir/bin/gitleaks" ]; then ok "offline: nothing is installed after a failed download"; else nok "offline: nothing is installed after a failed download"; fi

# D. A 4xx is never retried into a pass.
offline_install missing "404" ""
if [ "$case_rc" -ne 0 ] && [ "$(calls_for "$fake_tarball")" = 1 ]; then
  ok "offline: a 404 fails at once and is not retried"
else
  nok "offline: a 404 fails at once and is not retried" "exit $case_rc, $(calls_for "$fake_tarball") attempts"
fi
if [ ! -e "$case_dir/bin/gitleaks" ]; then ok "offline: nothing is installed after a 404"; else nok "offline: nothing is installed after a 404"; fi

# E. Every download keeps HTTPS only, TLS 1.2 or later and bounded connect and transfer times.
offline_install flags "" ""
flags_ok=1
while IFS= read -r line; do
  case "$line" in
    *"--proto =https"*"--tlsv1.2"*) ;;
    *) flags_ok=0 ;;
  esac
  case "$line" in *--connect-timeout*) ;; *) flags_ok=0 ;; esac
  case "$line" in *--max-time*) ;; *) flags_ok=0 ;; esac
done <<<"$case_calls"
if [ "$case_rc" -eq 0 ] && [ -n "$case_calls" ] && [ "$flags_ok" = 1 ]; then
  ok "offline: every download is HTTPS only, TLS 1.2+, with a connect timeout and a time limit"
else
  nok "offline: every download is HTTPS only, TLS 1.2+, with a connect timeout and a time limit" "$(tr '\n' ';' <<<"$case_calls")"
fi

# F. A mismatched pin still fails closed after a retried download.
offline_install pin "504" "" GITLEAKS_SHA256=0000000000000000000000000000000000000000000000000000000000000000
if [ "$case_rc" -ne 0 ] && [ ! -e "$case_dir/bin/gitleaks" ]; then
  ok "offline: a mismatched pin fails closed after a retried download, nothing installed"
else
  nok "offline: a mismatched pin fails closed after a retried download, nothing installed" "exit $case_rc"
fi
expect_match "offline: the mismatch is reported as a checksum failure" "*checksum failure*pinned SHA-256*" "$case_out"

# G. A cache directory (CI's actions/cache): the first install fills it with the verified files;
# the next installs from it, verified again, with the host down; a tampered copy is never used.
cache="$work/cache"
offline_install cache-fill "" "" GITLEAKS_CACHE_DIR="$cache"
if [ "$case_rc" -eq 0 ] && [ -f "$cache/$fake_tarball" ] && [ -f "$cache/$fake_checksums" ]; then
  ok "offline: a verified download fills GITLEAKS_CACHE_DIR"
else
  nok "offline: a verified download fills GITLEAKS_CACHE_DIR" "exit $case_rc: $(ls "$cache" 2>&1 | tr '\n' ' ')"
fi
offline_install cache-hit "504 504 504 504 504" "504 504 504 504 504" GITLEAKS_CACHE_DIR="$cache"
if [ "$case_rc" -eq 0 ] && [ -z "$case_calls" ] && [ -x "$case_dir/bin/gitleaks" ]; then
  ok "offline: a cached release installs with the host down and no download"
else
  nok "offline: a cached release installs with the host down and no download" "exit $case_rc, calls: $(tr '\n' ';' <<<"$case_calls")"
fi
expect_match "offline: the cached tarball passes the release checksums file again" "*release checksums file: OK*" "$case_out"
expect_match "offline: the cached tarball passes the pinned SHA-256 again" "*pinned SHA-256: OK*" "$case_out"
printf 'tampered' >>"$cache/$fake_tarball"
offline_install cache-tampered "504 504 504 504 504" "" GITLEAKS_CACHE_DIR="$cache"
if [ "$case_rc" -ne 0 ] && [ ! -e "$case_dir/bin/gitleaks" ]; then
  ok "offline: a tampered cached tarball is not installed (and the host is down: nothing installed)"
else
  nok "offline: a tampered cached tarball is not installed (and the host is down: nothing installed)" "exit $case_rc"
fi
expect_match "offline: the tampered cached copy is reported" "*cached*checksum failure*" "$case_out"
offline_install cache-refetch "" "" GITLEAKS_CACHE_DIR="$cache"
if [ "$case_rc" -eq 0 ] && [ "$(calls_for "$fake_tarball")" = 1 ] \
  && [ "$(sha256sum "$cache/$fake_tarball" | cut -d' ' -f1)" = "$fake_sha256" ]; then
  ok "offline: a tampered cached copy is replaced by a verified download"
else
  nok "offline: a tampered cached copy is replaced by a verified download" "exit $case_rc"
fi

# ---------------------------------------------------------------- network ----

# 1. A wrong pin must fail closed.
bad_dir="$work/bad"
bad_out=$(INSTALL_DIR="$bad_dir" GITLEAKS_SHA256=0000000000000000000000000000000000000000000000000000000000000000 \
  "$installer" 2>&1)
bad_rc=$?
if [ "$bad_rc" -ne 0 ]; then ok "mismatched SHA-256 pin aborts the install"; else nok "mismatched SHA-256 pin aborts the install" "exit 0"; fi
expect_match "mismatch is reported as a checksum failure" "*checksum*" "$bad_out"
if [ ! -e "$bad_dir/gitleaks" ]; then ok "nothing is installed after a checksum failure"; else nok "nothing is installed after a checksum failure"; fi

# 2. The pinned install verifies both checksums and installs a working binary.
good_dir="$work/good"
good_out=$(INSTALL_DIR="$good_dir" "$installer" 2>&1)
good_rc=$?
if [ "$good_rc" -eq 0 ]; then ok "pinned install succeeds"; else nok "pinned install succeeds" "$(tail -n 3 <<<"$good_out" | tr '\n' ' ')"; fi
expect_match "release checksums file is verified" "*release checksums file: OK*" "$good_out"
expect_match "pinned SHA-256 is verified" "*pinned SHA-256: OK*" "$good_out"
if [ -x "$good_dir/gitleaks" ]; then ok "gitleaks is installed as an executable"; else nok "gitleaks is installed as an executable"; fi
pinned_version=$(sed -n 's/^GITLEAKS_VERSION_DEFAULT="\(.*\)"$/\1/p' "$installer")
installed_version=$("$good_dir/gitleaks" version 2>&1 | tr -d 'v\r')
if [ -n "$pinned_version" ] && [ "$installed_version" = "$pinned_version" ]; then
  ok "installed gitleaks reports the pinned version ($pinned_version)"
else
  nok "installed gitleaks reports the pinned version" "pinned '$pinned_version', installed '$installed_version'"
fi

finish
