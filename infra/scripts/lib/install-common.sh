#!/usr/bin/env bash
# The install-gitleaks.sh pattern, shared by every infra/scripts/install-<tool>.sh of Workflow 11C
# (scanners-11c; C258.2, decision 42, rule 20). Sourced, never run. An installer:
#   1. refuses any platform but linux x86_64 (ov_platform) and a version given without its SHA-256
#      (ov_pin), exit 2, before anything is downloaded;
#   2. downloads into a fresh private temporary directory, removed on exit (ov_begin, ov_obtain):
#      HTTPS only, TLS 1.2 or later, a connect timeout and a time limit; a 5xx answer, a timeout or
#      a connection failure is retried, at most 5 attempts with a doubling delay; a 4xx fails at once;
#   3. verifies the asset twice, against the release's own checksum source (ov_release_sha,
#      ov_release_sha_only) and against the SHA-256 pinned in the repository (ov_check_asset): the
#      checksum file comes from the same origin as the asset, so the pin is what protects against a
#      swapped release asset;
#   4. verifies the signature with cosign where the project publishes one (ov_verify_bundle,
#      ov_verify_sigcert), and only with a cosign whose own SHA-256 is the one install-cosign.sh pins
#      (cosign itself is checked by SHA-256 only);
#   5. keeps the verified files in an optional cache directory, whose copy is verified again, all of
#      it, before use, and discarded and downloaded again when it fails;
#   6. installs only after every check passed (ov_install), so a failure writes nothing.
# Exit codes: 0 installed; 1 a download, checksum or signature failure; 2 usage (an unsupported
# platform, a version without its SHA-256, a missing prerequisite).
#
# Env read here: INSTALL_DIR (default ~/.local/bin); INSTALL_RETRY_DELAY_SECONDS (the first retry's
# delay, default 2; the tests use 0); COSIGN_BIN (the cosign to run; default INSTALL_DIR's, then
# PATH's); COSIGN_BIN_SHA256 (test-only: the SHA-256 the cosign must have, default the pin in
# install-cosign.sh). The caller sets ov_tool (the name in every message) before sourcing.

ov_lib_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ov_scripts_dir=$(cd "$ov_lib_dir/.." && pwd)
ov_install_dir="${INSTALL_DIR:-$HOME/.local/bin}"
ov_retry_delay="${INSTALL_RETRY_DELAY_SECONDS:-2}"
ov_attempts=5

ov_say() { printf 'install-%s: %s\n' "$ov_tool" "$*"; }
ov_err() { printf 'install-%s: %s\n' "$ov_tool" "$*" >&2; }

# ov_platform: only linux x86_64 is pinned.
ov_platform() {
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) ;;
    *)
      ov_err "only linux x86_64 is pinned; install $ov_tool by hand and verify it against the release's checksum file"
      exit 2
      ;;
  esac
}

# ov_sha256_ok <value>: a SHA-256 is 64 lower-case hex digits.
ov_sha256_ok() { [[ $1 =~ ^[0-9a-f]{64}$ ]]; }

# ov_pin <PREFIX>: resolves <PREFIX>_VERSION and <PREFIX>_SHA256 against the installer's
# <PREFIX>_VERSION_DEFAULT and <PREFIX>_SHA256_DEFAULT into ov_version and ov_sha256. A version other
# than the default needs its SHA-256 (exit 2).
ov_pin() {
  local prefix=$1 version_default_var="${1}_VERSION_DEFAULT" sha_default_var="${1}_SHA256_DEFAULT"
  local version_var="${1}_VERSION" sha_var="${1}_SHA256"
  ov_version="${!version_var:-${!version_default_var}}"
  ov_sha256="${!sha_var:-${!sha_default_var}}"
  if [ "$ov_version" != "${!version_default_var}" ] && [ -z "${!sha_var:-}" ]; then
    ov_err "${prefix}_VERSION=$ov_version needs a matching ${prefix}_SHA256"
    exit 2
  fi
  if ! ov_sha256_ok "$ov_sha256"; then
    ov_err "${prefix}_SHA256 must be 64 lower-case hex digits"
    exit 2
  fi
}

# ov_begin: the private temporary directory (downloads in $ov_dl, extracted files in $ov_x).
ov_begin() {
  ov_work=$(mktemp -d)
  chmod 0700 "$ov_work"
  # shellcheck disable=SC2064 # expand now: the path is fixed
  trap "rm -rf '$ov_work'" EXIT
  ov_dl="$ov_work/dl"
  ov_x="$ov_work/x"
  mkdir -p "$ov_dl" "$ov_x"
}

# ov_download <url> <name>: fetches <url> into $ov_dl/<name>, retrying what may pass later.
ov_download() {
  local url=$1 name=$2 attempt=1 delay=$ov_retry_delay status rc
  while :; do
    rc=0
    status=$(curl -sSL --proto '=https' --tlsv1.2 --connect-timeout 20 --max-time 300 \
      -o "$ov_dl/$name" -w '%{http_code}' "$url") || rc=$?
    case "$rc:$status" in
      0:2??) return 0 ;;
      0:4??)
        ov_err "download failed: $name answered HTTP $status (not retried)"
        return 1
        ;;
    esac
    if [ "$attempt" -ge "$ov_attempts" ]; then
      ov_err "download failed: $name answered HTTP ${status:-000} (curl exit $rc) on all $ov_attempts attempts"
      return 1
    fi
    ov_err "$name answered HTTP ${status:-000} (curl exit $rc); attempt $((attempt + 1)) of $ov_attempts in ${delay}s"
    sleep "$delay"
    delay=$((delay * 2))
    attempt=$((attempt + 1))
  done
}

# ov_obtain <cache dir or ""> <verify function> <name> <url> [<name> <url> ...]: puts every file in
# $ov_dl, verified by <verify function>, from the cache when its copy verifies, else downloaded;
# a verified download fills the cache. Exits 1 when the downloaded files do not verify.
ov_obtain() {
  local cache=$1 verify=$2 names=() urls=() all=1 i name
  shift 2
  while [ $# -gt 0 ]; do
    names+=("$1")
    urls+=("$2")
    shift 2
  done
  if [ -z "$cache" ]; then all=0; fi
  for name in "${names[@]}"; do
    if [ -n "$cache" ] && [ ! -f "$cache/$name" ]; then all=0; fi
  done
  if [ "$all" = 1 ]; then
    ov_say "verifying the cached copy in $cache"
    for name in "${names[@]}"; do cp "$cache/$name" "$ov_dl/$name"; done
    if "$verify"; then return 0; fi
    ov_err "the cached copy failed verification: discarded, downloading"
    for name in "${names[@]}"; do rm -f "$cache/$name" "$ov_dl/$name"; done
  fi
  ov_say "downloading ${names[0]}"
  for i in "${!names[@]}"; do
    ov_download "${urls[$i]}" "${names[$i]}" || exit 1
  done
  "$verify" || exit 1
  if [ -n "$cache" ]; then
    mkdir -p "$cache"
    for name in "${names[@]}"; do cp "$ov_dl/$name" "$cache/"; done
  fi
}

# ov_release_sha <checksum file> <asset>: prints the SHA-256 the release's checksum file gives the
# asset (a line "<sha>  <asset>", "<sha> *<asset>" or "<sha> *<dir>/<asset>"); fails when the
# asset is not listed, or listed with two different digests.
ov_release_sha() {
  local file=$1 asset=$2 found
  found=$(awk -v asset="$asset" '
    $1 ~ /^[0-9a-f]{64}$/ && NF == 2 {
      name = $2; sub(/^\*/, "", name)
      n = split(name, parts, "/")
      if (parts[n] == asset) print $1
    }' "$file" | sort -u)
  if [ -z "$found" ]; then
    ov_err "checksum failure: $asset is not listed in $(basename "$file")"
    return 1
  fi
  if [ "$(wc -l <<<"$found")" -ne 1 ]; then
    ov_err "checksum failure: $(basename "$file") lists $asset with two different digests"
    return 1
  fi
  printf '%s\n' "$found"
}

# ov_release_sha_only <checksum file> <asset>: the same for a file holding one bare SHA-256.
ov_release_sha_only() {
  local file=$1 asset=$2 content
  content=$(tr -d ' \t\r\n' <"$file")
  if ! ov_sha256_ok "$content"; then
    ov_err "checksum failure: $asset is not listed in $(basename "$file") (it holds no single SHA-256)"
    return 1
  fi
  printf '%s\n' "$content"
}

# ov_release_sha_api <releases API answer> <asset>: the same for an immutable GitHub release whose
# only checksum is the asset's `digest` ("sha256:<hex>") in the releases API's JSON answer; fails
# when the answer is not JSON, names no assets, or does not list the asset with one SHA-256.
ov_release_sha_api() {
  local file=$1 asset=$2 found
  if ! found=$(python3 -I - "$file" "$asset" <<'PY'
import json
import re
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as fh:
        answer = json.load(fh)
except (OSError, ValueError):
    sys.exit(1)
assets = answer.get("assets") if isinstance(answer, dict) else None
digests = {
    a.get("digest")
    for a in assets or []
    if isinstance(a, dict) and a.get("name") == sys.argv[2]
}
if len(digests) != 1:
    sys.exit(1)
digest = digests.pop()
match = re.fullmatch(r"sha256:([0-9a-f]{64})", digest or "")
if match is None:
    sys.exit(1)
print(match.group(1))
PY
  ); then
    ov_err "checksum failure: $asset is not listed in the releases API answer $(basename "$file") with one sha256 digest"
    return 1
  fi
  printf '%s\n' "$found"
}

# ov_check_asset <file> <release sha> <checksum source label> [<pinned sha>]: the file must match
# both the release's digest and the pin (default ov_sha256).
ov_check_asset() {
  local file=$1 release_sha=$2 label=$3 pinned=${4:-$ov_sha256} actual
  actual=$(sha256sum "$file" | cut -d' ' -f1)
  if [ "$actual" != "$release_sha" ]; then
    ov_err "checksum failure: $(basename "$file") does not match the release checksum file ($label)"
    return 1
  fi
  ov_say "$(basename "$file"): release checksum file: OK ($label)"
  if [ "$actual" != "$pinned" ]; then
    ov_err "checksum failure: $(basename "$file") does not match the pinned SHA-256 $pinned"
    return 1
  fi
  ov_say "$(basename "$file"): pinned SHA-256: OK ($pinned)"
}

# ov_check_pin_only <file> <pinned sha>: a file with no release checksum of its own (a script at a
# pinned commit) is held by its pin alone.
ov_check_pin_only() {
  local file=$1 pinned=$2 actual
  actual=$(sha256sum "$file" | cut -d' ' -f1)
  if [ "$actual" != "$pinned" ]; then
    ov_err "checksum failure: $(basename "$file") does not match the pinned SHA-256 $pinned"
    return 1
  fi
  ov_say "$(basename "$file"): pinned SHA-256: OK ($pinned)"
}

# ov_cosign: sets ov_cosign_bin to a cosign whose SHA-256 is install-cosign.sh's pin (or
# COSIGN_BIN_SHA256), or fails without running anything.
ov_cosign() {
  local pinned actual
  if [ -n "${COSIGN_BIN:-}" ]; then
    ov_cosign_bin=$COSIGN_BIN
  elif [ -x "$ov_install_dir/cosign" ]; then
    ov_cosign_bin="$ov_install_dir/cosign"
  else
    ov_cosign_bin=$(command -v cosign 2>/dev/null || true)
  fi
  if [ -z "$ov_cosign_bin" ] || [ ! -x "$ov_cosign_bin" ]; then
    ov_err "signature failure: cosign is needed to check $ov_tool's signature; run infra/scripts/install-cosign.sh first (or set COSIGN_BIN)"
    return 1
  fi
  pinned="${COSIGN_BIN_SHA256:-$(sed -n 's/^COSIGN_SHA256_DEFAULT="\(.*\)"$/\1/p' "$ov_scripts_dir/install-cosign.sh")}"
  actual=$(sha256sum "$ov_cosign_bin" | cut -d' ' -f1)
  if [ "$actual" != "$pinned" ]; then
    ov_err "signature failure: $ov_cosign_bin is not the pinned cosign (SHA-256 $actual, expected $pinned); run infra/scripts/install-cosign.sh"
    return 1
  fi
}

# ov_verify_bundle <blob> <Sigstore bundle> <certificate identity> <OIDC issuer>
ov_verify_bundle() {
  local blob=$1 bundle=$2 identity=$3 issuer=$4 out
  ov_cosign || return 1
  if ! out=$("$ov_cosign_bin" verify-blob --bundle "$bundle" --certificate-identity "$identity" \
    --certificate-oidc-issuer "$issuer" "$blob" 2>&1); then
    ov_err "signature failure: $(basename "$blob") is not signed by $identity ($issuer): $(tail -n 1 <<<"$out")"
    return 1
  fi
  ov_say "$(basename "$blob"): signature: OK ($identity)"
}

# ov_verify_sigcert <blob> <signature> <certificate> <certificate identity> <OIDC issuer>
ov_verify_sigcert() {
  local blob=$1 sig=$2 cert=$3 identity=$4 issuer=$5 out
  ov_cosign || return 1
  if ! out=$("$ov_cosign_bin" verify-blob --signature "$sig" --certificate "$cert" --certificate-identity "$identity" \
    --certificate-oidc-issuer "$issuer" "$blob" 2>&1); then
    ov_err "signature failure: $(basename "$blob") is not signed by $identity ($issuer): $(tail -n 1 <<<"$out")"
    return 1
  fi
  ov_say "$(basename "$blob"): signature: OK ($identity)"
}

# ov_extract <tarball> <member>...: extracts the named members into $ov_x.
ov_extract() {
  local tarball=$1
  shift
  tar -xzf "$tarball" -C "$ov_x" "$@"
}

# ov_install <file> <name> [mode]: installs <file> as INSTALL_DIR/<name> (default mode 0755).
ov_install() {
  mkdir -p "$ov_install_dir"
  install -m "${3:-0755}" "$1" "$ov_install_dir/$2"
}
