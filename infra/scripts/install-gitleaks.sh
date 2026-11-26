#!/usr/bin/env bash
# Install a pinned gitleaks release binary (linux x64) after verifying it twice:
#   1. against the release's own checksums file, and
#   2. against the SHA-256 pinned below (the checksums file comes from the same origin as the
#      tarball, so the pin is what actually protects against a swapped release asset).
# Used by developers (pre-commit hook) and by CI (.github/workflows/ci.yml, job "secrets").
#
# Each download is retried on a 5xx answer, a timeout or a connection failure, at most 5 attempts
# with a doubling delay; a 4xx answer fails at once (KP10-2: one HTTP 504 from GitHub's release host
# failed CI). A cache directory (CI's actions/cache) holds the files of a verified install; a cached
# copy is verified again, both ways, before it is used, and one that fails is discarded.
#
# Usage: infra/scripts/install-gitleaks.sh
# Env:   INSTALL_DIR       target directory (default: ~/.local/bin)
#        GITLEAKS_VERSION  release to install (default: pinned below; change with GITLEAKS_SHA256)
#        GITLEAKS_SHA256   expected SHA-256 of gitleaks_<version>_linux_x64.tar.gz
#        GITLEAKS_CACHE_DIR  optional: where the verified tarball and checksums file are kept
#        GITLEAKS_RETRY_DELAY_SECONDS  the first retry's delay (default 2; the tests use 0)
# Bumping: update both defaults together; take the hash from the release checksums file and
# cross-check it with `gh api repos/gitleaks/gitleaks/releases/tags/v<version>` (asset digest).
set -euo pipefail

GITLEAKS_VERSION_DEFAULT="8.30.1"
GITLEAKS_SHA256_DEFAULT="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"

version="${GITLEAKS_VERSION:-$GITLEAKS_VERSION_DEFAULT}"
expected_sha256="${GITLEAKS_SHA256:-$GITLEAKS_SHA256_DEFAULT}"
install_dir="${INSTALL_DIR:-$HOME/.local/bin}"

if [ "$version" != "$GITLEAKS_VERSION_DEFAULT" ] && [ -z "${GITLEAKS_SHA256:-}" ]; then
  echo "install-gitleaks: GITLEAKS_VERSION=$version needs a matching GITLEAKS_SHA256" >&2
  exit 2
fi
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) ;;
  *)
    echo "install-gitleaks: only linux x86_64 is pinned; install gitleaks $version manually and verify it against the release checksums file" >&2
    exit 2
    ;;
esac

tarball="gitleaks_${version}_linux_x64.tar.gz"
checksums="gitleaks_${version}_checksums.txt"
base_url="https://github.com/gitleaks/gitleaks/releases/download/v${version}"

attempts=5
retry_delay="${GITLEAKS_RETRY_DELAY_SECONDS:-2}"
cache_dir="${GITLEAKS_CACHE_DIR:-}"

# Downloads are untrusted until verified: keep them in a fresh, private directory.
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# download <file>: fetches $base_url/<file> into $work, retrying what may pass on a later attempt.
download() {
  local file=$1 attempt=1 delay=$retry_delay status rc
  while :; do
    rc=0
    status=$(curl -sSL --proto '=https' --tlsv1.2 --connect-timeout 20 --max-time 60 \
      -o "$work/$file" -w '%{http_code}' "$base_url/$file") || rc=$?
    case "$rc:$status" in
      0:2??) return 0 ;;
      0:4??)
        echo "install-gitleaks: download failed: $file answered HTTP $status (not retried)" >&2
        return 1
        ;;
    esac
    if [ "$attempt" -ge "$attempts" ]; then
      echo "install-gitleaks: download failed: $file answered HTTP ${status:-000} (curl exit $rc) on all $attempts attempts" >&2
      return 1
    fi
    echo "install-gitleaks: $file answered HTTP ${status:-000} (curl exit $rc); attempt $((attempt + 1)) of $attempts in ${delay}s" >&2
    sleep "$delay"
    delay=$((delay * 2))
    attempt=$((attempt + 1))
  done
}

# verify: checks $work's tarball against the release checksums file and the pinned SHA-256.
verify() {
  local release_line
  release_line=$(grep -E "^[0-9a-f]{64}  ${tarball}\$" "$work/$checksums" || true)
  if [ -z "$release_line" ]; then
    echo "install-gitleaks: checksum failure: $tarball is not listed in $checksums" >&2
    return 1
  fi
  if ! (cd "$work" && printf '%s\n' "$release_line" | sha256sum -c --status -); then
    echo "install-gitleaks: checksum failure: $tarball does not match the release checksums file" >&2
    return 1
  fi
  echo "install-gitleaks: release checksums file: OK"
  if ! (cd "$work" && printf '%s  %s\n' "$expected_sha256" "$tarball" | sha256sum -c --status -); then
    echo "install-gitleaks: checksum failure: $tarball does not match the pinned SHA-256 $expected_sha256" >&2
    return 1
  fi
  echo "install-gitleaks: pinned SHA-256: OK ($expected_sha256)"
}

verified=false
if [ -n "$cache_dir" ] && [ -f "$cache_dir/$tarball" ] && [ -f "$cache_dir/$checksums" ]; then
  echo "install-gitleaks: verifying the cached copy in $cache_dir"
  cp "$cache_dir/$tarball" "$cache_dir/$checksums" "$work/"
  if verify; then
    verified=true
  else
    echo "install-gitleaks: the cached copy failed verification: discarded, downloading" >&2
    rm -f "$cache_dir/$tarball" "$cache_dir/$checksums" "$work/$tarball" "$work/$checksums"
  fi
fi
if ! $verified; then
  echo "install-gitleaks: downloading $tarball"
  download "$tarball"
  download "$checksums"
  verify
  if [ -n "$cache_dir" ]; then
    mkdir -p "$cache_dir"
    cp "$work/$tarball" "$work/$checksums" "$cache_dir/"
  fi
fi

mkdir -p "$work/extract"
tar -xzf "$work/$tarball" -C "$work/extract" gitleaks
mkdir -p "$install_dir"
install -m 0755 "$work/extract/gitleaks" "$install_dir/gitleaks"
echo "install-gitleaks: installed $("$install_dir/gitleaks" version) to $install_dir/gitleaks"
