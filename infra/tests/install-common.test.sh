#!/usr/bin/env bash
# Test for infra/scripts/lib/install-common.sh, the install-gitleaks.sh pattern every
# infra/scripts/install-<tool>.sh sources (Workflow 11C scanners-11c; C258.2, decision 42).
# Offline only: a synthetic installer in the scratch directory sources the library, and the fake
# curl of infra/tests/lib/installer-harness.sh serves its release. It holds what each installer
# test then takes for granted: retries on 5xx answers and connection failures (bounded, a 4xx never
# retried), HTTPS only with TLS 1.2 or later and time limits, a private temporary directory removed
# afterwards, a cache whose copy is verified again before use and replaced when it fails, the
# cosign check (its own SHA-256 first, then the signature), and nothing written on any failure.
#
# Usage: infra/tests/install-common.test.sh
set -uo pipefail
# shellcheck source=lib/installer-harness.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/installer-harness.sh"

lib="$h_repo_root/infra/scripts/lib/install-common.sh"
if [ -f "$lib" ]; then ok "infra/scripts/lib/install-common.sh exists"; else nok "infra/scripts/lib/install-common.sh exists"; fi

h_init infra/tests/install-common.test.sh
# A synthetic installer: release "demo" 0.0.1, a tarball holding `demo`, a checksum file, and a
# Sigstore bundle on the checksum file.
demo_installer="$work/install-demo.sh"
cat >"$demo_installer" <<EOF
#!/usr/bin/env bash
set -euo pipefail
DEMO_VERSION_DEFAULT="0.0.1"
DEMO_SHA256_DEFAULT="\${DEMO_TEST_PIN:?}"
ov_tool=demo
. "$lib"
ov_platform
ov_pin DEMO
ov_begin
asset="demo_\${ov_version}_linux_amd64.tar.gz"
sums="demo_\${ov_version}_checksums.txt"
base="https://example.invalid/demo/v\${ov_version}"
verify() {
  local release_sha
  release_sha=\$(ov_release_sha "\$ov_dl/\$sums" "\$asset") || return 1
  ov_check_asset "\$ov_dl/\$asset" "\$release_sha" "\$sums" || return 1
  ov_verify_bundle "\$ov_dl/\$sums" "\$ov_dl/\$sums.sigstore.json" "https://example.invalid/demo/release.yaml@refs/tags/v\${ov_version}" https://token.actions.githubusercontent.com
}
ov_obtain "\${DEMO_CACHE_DIR:-}" verify "\$asset" "\$base/\$asset" "\$sums" "\$base/\$sums" "\$sums.sigstore.json" "\$base/\$sums.sigstore.json"
ov_extract "\$ov_dl/\$asset" demo
ov_install "\$ov_x/demo" demo
ov_say "installed \$("\$ov_install_dir/demo" version) to \$ov_install_dir/demo"
EOF
installer="$demo_installer"
h_stub_binary "$work/build/demo" "demo 0.0.1"
tar -czf "$release/demo_0.0.1_linux_amd64.tar.gz" -C "$work/build" demo
demo_sha=$(h_sha256 "$release/demo_0.0.1_linux_amd64.tar.gz")
printf '%s  %s\n' "$demo_sha" demo_0.0.1_linux_amd64.tar.gz >"$release/demo_0.0.1_checksums.txt"
printf '{"synthetic":"bundle"}\n' >"$release/demo_0.0.1_checksums.txt.sigstore.json"
tarball=demo_0.0.1_linux_amd64.tar.gz
sums=demo_0.0.1_checksums.txt
pin=(DEMO_TEST_PIN="$demo_sha")

# A. The release installs: both checksums and the signature verified, the version reported.
run_installer good "${pin[@]}"
if [ "$case_rc" -eq 0 ] && [ -x "$case_dir/bin/demo" ]; then ok "the pinned synthetic release installs"; else nok "the pinned synthetic release installs" "exit $case_rc: $(tail -n 3 <<<"$case_out" | tr '\n' ' ')"; fi
expect_match "the release's checksum source is verified" "*release checksum file: OK*" "$case_out"
expect_match "the pinned SHA-256 is verified" "*pinned SHA-256: OK ($demo_sha)*" "$case_out"
expect_match "the signature is verified" "*signature: OK*" "$case_out"
expect_match "the installed version is reported" "*installed demo 0.0.1 to *" "$case_out"
if [ -z "$(find "$case_dir/home" -mindepth 1 2>/dev/null)" ]; then ok "nothing is written outside INSTALL_DIR"; else nok "nothing is written outside INSTALL_DIR"; fi

# B. 504s and a connection failure are retried; the download stops at the first 200.
run_installer transient "${pin[@]}" "plan.$tarball=504 net 502" "plan.$sums=504"
if [ "$case_rc" -eq 0 ] && [ "$(calls_for "$tarball")" = 4 ] && [ "$(calls_for "$sums")" = 2 ]; then
  ok "5xx answers and connection failures are retried until the first 200"
else
  nok "5xx answers and connection failures are retried until the first 200" "exit $case_rc, tarball $(calls_for "$tarball"), sums $(calls_for "$sums")"
fi

# C. An outage: five attempts, then a failure naming the status; nothing installed.
run_installer outage "${pin[@]}" "plan.$tarball=504 504 504 504 504 504 504"
if [ "$case_rc" -ne 0 ] && [ "$(calls_for "$tarball")" = 5 ] && nothing_installed; then
  ok "an outage fails after five attempts, nothing installed"
else
  nok "an outage fails after five attempts, nothing installed" "exit $case_rc, $(calls_for "$tarball") attempts"
fi
expect_match "the failure names the last status" "*download failed*504*" "$case_out"

# D. A 4xx is never retried.
run_installer not-found "${pin[@]}" "plan.$tarball=404"
if [ "$case_rc" -ne 0 ] && [ "$(calls_for "$tarball")" = 1 ] && nothing_installed; then
  ok "a 404 fails at once, without a retry, nothing installed"
else
  nok "a 404 fails at once, without a retry, nothing installed" "exit $case_rc, $(calls_for "$tarball") attempts"
fi

# E. Every download is HTTPS only, TLS 1.2 or later, with a connect timeout and a time limit.
run_installer flags "${pin[@]}"
flags_ok=1
while IFS= read -r line; do
  case "$line" in *"--proto =https"*"--tlsv1.2"*) ;; *) flags_ok=0 ;; esac
  case "$line" in *--connect-timeout*) ;; *) flags_ok=0 ;; esac
  case "$line" in *--max-time*) ;; *) flags_ok=0 ;; esac
done <<<"$case_calls"
if [ "$case_rc" -eq 0 ] && [ -n "$case_calls" ] && [ "$flags_ok" = 1 ]; then
  ok "every download is HTTPS only, TLS 1.2+, with a connect timeout and a time limit"
else
  nok "every download is HTTPS only, TLS 1.2+, with a connect timeout and a time limit" "$(tr '\n' ';' <<<"$case_calls")"
fi

# F. The private temporary directory is removed after a success and after a failure.
tmp_probe="$work/tmp-probe"
mkdir -p "$tmp_probe"
run_installer tmp-good "${pin[@]}" TMPDIR="$tmp_probe"
run_installer tmp-bad DEMO_TEST_PIN=0000000000000000000000000000000000000000000000000000000000000000 TMPDIR="$tmp_probe"
if [ -z "$(ls -A "$tmp_probe")" ]; then ok "the private temporary directory is removed after a success and a failure"; else nok "the private temporary directory is removed after a success and a failure" "$(ls "$tmp_probe")"; fi

# G. A wrong pin, a tampered or missing checksum line, an unsupported platform, a version alone.
run_installer pin DEMO_TEST_PIN=0000000000000000000000000000000000000000000000000000000000000000
if [ "$case_rc" -eq 1 ] && nothing_installed; then ok "a wrong pin fails closed (exit 1), nothing installed"; else nok "a wrong pin fails closed (exit 1), nothing installed" "exit $case_rc"; fi
expect_match "a wrong pin names the pinned SHA-256" "*checksum failure*pinned SHA-256 0000*" "$case_out"
cp "$release/$sums" "$work/sums.saved"
printf '%s  %s\n' 1111111111111111111111111111111111111111111111111111111111111111 "$tarball" >"$release/$sums"
run_installer tampered "${pin[@]}"
if [ "$case_rc" -eq 1 ] && nothing_installed; then ok "a tampered checksum line fails closed, nothing installed"; else nok "a tampered checksum line fails closed, nothing installed" "exit $case_rc"; fi
expect_match "a tampered line is reported against the release checksum file" "*checksum failure*does not match the release checksum file*" "$case_out"
printf '%s  %s\n%s  %s\n' "$demo_sha" "$tarball" 1111111111111111111111111111111111111111111111111111111111111111 "$tarball" >"$release/$sums"
run_installer ambiguous "${pin[@]}"
if [ "$case_rc" -eq 1 ] && nothing_installed; then ok "two different release lines for one asset fail closed"; else nok "two different release lines for one asset fail closed" "exit $case_rc"; fi
printf '%s  %s\n' "$demo_sha" "other_${tarball}" >"$release/$sums"
run_installer unlisted "${pin[@]}"
if [ "$case_rc" -eq 1 ] && nothing_installed; then ok "a checksum file without the asset fails closed"; else nok "a checksum file without the asset fails closed" "exit $case_rc"; fi
expect_match "the missing line is reported as not listed" "*checksum failure*not listed*" "$case_out"
cp "$work/sums.saved" "$release/$sums"
run_installer platform uname=unsupported "${pin[@]}"
if [ "$case_rc" -eq 2 ] && [ -z "$case_calls" ] && nothing_installed; then ok "an unsupported platform exits 2 before any download"; else nok "an unsupported platform exits 2 before any download" "exit $case_rc"; fi
run_installer alone "${pin[@]}" DEMO_VERSION=0.0.2
if [ "$case_rc" -eq 2 ] && [ -z "$case_calls" ]; then ok "a version without its SHA-256 exits 2 before any download"; else nok "a version without its SHA-256 exits 2 before any download" "exit $case_rc"; fi
run_installer malformed "${pin[@]}" DEMO_VERSION=0.0.1 DEMO_SHA256=abc
if [ "$case_rc" -eq 2 ] && [ -z "$case_calls" ]; then ok "a SHA-256 that is not 64 hex digits exits 2"; else nok "a SHA-256 that is not 64 hex digits exits 2" "exit $case_rc"; fi

# H. The signature: a refusal, no cosign, a cosign that is not the pinned one, the identity asked.
run_installer sig-fail "${pin[@]}" cosign=fail
if [ "$case_rc" -eq 1 ] && nothing_installed; then ok "a signature failure fails closed, nothing installed"; else nok "a signature failure fails closed, nothing installed" "exit $case_rc"; fi
expect_match "it is reported as a signature failure" "*signature failure*" "$case_out"
run_installer sig-none "${pin[@]}" cosign=none
if [ "$case_rc" -ne 0 ] && nothing_installed; then ok "no cosign fails closed, nothing installed"; else nok "no cosign fails closed, nothing installed" "exit $case_rc"; fi
expect_match "the refusal names install-cosign.sh" "*install-cosign.sh*" "$case_out"
run_installer sig-wrong "${pin[@]}" COSIGN_BIN_SHA256=2222222222222222222222222222222222222222222222222222222222222222
if [ "$case_rc" -ne 0 ] && nothing_installed && [ -z "$case_cosign_calls" ]; then ok "a cosign that is not the pinned one is never run"; else nok "a cosign that is not the pinned one is never run" "exit $case_rc"; fi
expect_match "the refusal names cosign's pinned SHA-256" "*cosign*SHA-256*" "$case_out"
run_installer sig-default "${pin[@]}" COSIGN_BIN_SHA256=
expect_match "by default cosign must match install-cosign.sh's pin (the fake does not)" "*cosign*SHA-256*" "$case_out"
run_installer sig-args "${pin[@]}"
expect_match "cosign verifies the bundle with the identity and issuer given" \
  "verify-blob --bundle */$sums.sigstore.json --certificate-identity https://example.invalid/demo/release.yaml@refs/tags/v0.0.1 --certificate-oidc-issuer https://token.actions.githubusercontent.com */$sums" "$case_cosign_calls"
# A cosign found in INSTALL_DIR is used when COSIGN_BIN is not set.
mkdir -p "$work/case-indir-pre"
cp "$fake_cosign" "$work/case-indir-pre/cosign"
run_installer indir "${pin[@]}" COSIGN_BIN= COSIGN_BIN_SHA256="$fake_cosign_sha256" INSTALL_DIR="$work/case-indir-pre"
if [ "$case_rc" -eq 0 ] && [ -n "$case_cosign_calls" ]; then ok "the cosign in INSTALL_DIR is used when COSIGN_BIN is unset"; else nok "the cosign in INSTALL_DIR is used when COSIGN_BIN is unset" "exit $case_rc"; fi

# I. The cache: filled by a verified download; used, verified again, with the host down; a tampered
# copy is discarded and replaced by a verified download; never filled by a failed one.
cache="$work/cache"
run_installer cache-fill "${pin[@]}" DEMO_CACHE_DIR="$cache"
if [ "$case_rc" -eq 0 ] && [ -f "$cache/$tarball" ] && [ -f "$cache/$sums" ] && [ -f "$cache/$sums.sigstore.json" ]; then
  ok "a verified download fills the cache directory"
else
  nok "a verified download fills the cache directory" "exit $case_rc"
fi
run_installer cache-hit "${pin[@]}" DEMO_CACHE_DIR="$cache" "plan.$tarball=504 504 504 504 504" "plan.$sums=504 504 504 504 504"
if [ "$case_rc" -eq 0 ] && [ -z "$case_calls" ] && [ -x "$case_dir/bin/demo" ]; then
  ok "a cached release installs with the host down and no download"
else
  nok "a cached release installs with the host down and no download" "exit $case_rc"
fi
expect_match "the cached copy is verified again (checksums)" "*cached*release checksum file: OK*pinned SHA-256: OK*" "$case_out"
expect_match "the cached copy is verified again (signature)" "*signature: OK*" "$case_out"
printf 'tampered' >>"$cache/$tarball"
run_installer cache-tampered "${pin[@]}" DEMO_CACHE_DIR="$cache" "plan.$tarball=504 504 504 504 504"
if [ "$case_rc" -ne 0 ] && nothing_installed; then ok "a tampered cached copy is never installed"; else nok "a tampered cached copy is never installed" "exit $case_rc"; fi
expect_match "the tampered cached copy is reported and discarded" "*cached copy failed verification*" "$case_out"
run_installer cache-refetch "${pin[@]}" DEMO_CACHE_DIR="$cache"
if [ "$case_rc" -eq 0 ] && [ "$(h_sha256 "$cache/$tarball")" = "$demo_sha" ]; then ok "a discarded cached copy is replaced by a verified download"; else nok "a discarded cached copy is replaced by a verified download" "exit $case_rc"; fi
bad_cache="$work/bad-cache"
run_installer cache-never DEMO_TEST_PIN=0000000000000000000000000000000000000000000000000000000000000000 DEMO_CACHE_DIR="$bad_cache"
if [ ! -e "$bad_cache" ]; then ok "a failed verification never fills the cache"; else nok "a failed verification never fills the cache"; fi

# J. INSTALL_DIR defaults to ~/.local/bin.
run_installer default-dir "${pin[@]}" INSTALL_DIR=
if [ "$case_rc" -eq 0 ] && [ -x "$case_dir/home/.local/bin/demo" ]; then ok "INSTALL_DIR defaults to ~/.local/bin"; else nok "INSTALL_DIR defaults to ~/.local/bin" "exit $case_rc"; fi

finish
