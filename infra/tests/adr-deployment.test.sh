#!/usr/bin/env bash
# Contract test for ADR 0010's deployment half (Workflow 11C Stage 1a, contracts-11c; Phase 11
# decision 46): rules 4 and 5 are written, name what they bind (the owner's switches of C289, the
# pinned and checksummed tools, the per-process images on digest-pinned bases, the chart's
# restricted defaults, the SBOMs and their licence check), and claim nothing the release does not do
# (nothing is signed or attested in 11C; "self-assessed", never "certified" or "compliant").
#
# Usage: infra/tests/adr-deployment.test.sh
set -uo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
adr="$repo_root/docs/adr/0010-connect-release-hardening-and-deployment.md"
passed=0
failed=0
ok() { printf 'ok   - %s\n' "$1"; passed=$((passed + 1)); }
nok() { printf 'FAIL - %s%s\n' "$1" "${2:+ ($2)}"; failed=$((failed + 1)); }

if [ ! -f "$adr" ]; then
  nok "ADR 0010 exists"
  printf '\n# %d passed, %d failed\n' "$passed" "$failed"
  exit 1
fi

out=$(python3 -I - "$adr" <<'PY'
import re
import sys

text = open(sys.argv[1], encoding="utf-8").read()


def check(desc, cond, detail=""):
    print(("ok  " if cond else "FAIL") + " - " + desc + ("" if cond or not detail else f" ({detail})"))


def section(heading):
    match = re.search(r"^### " + re.escape(heading) + r"\n(.*?)(?=^### |^## )", text, re.S | re.M)
    return match.group(1) if match else ""


rule4 = section("4. Nothing published without the owner")
rule5 = section("5. Tools follow rule 4")
check("rule 4 is written, not a placeholder", len(rule4) > 400 and "To be written by `contracts-11c`" not in rule4)
check("rule 5 is written, not a placeholder", len(rule5) > 400 and "To be written by `contracts-11c`" not in rule5)
for needle, why in [
    ("OPENVERIFY_PUBLISH", "the repository variable that gates publication"),
    ("`release`", "the GitHub environment of the publish job"),
    ("Q1", "the owner's visibility question"),
    ("Q4", "the owner's npm question"),
    ("-noguidance", "the flow image's decline outcome (C289)"),
    ("pending-owner", "the label of an artifact a pending licence row ships in"),
    ("nothing is signed", "the honest state of this release"),
]:
    check(f"rule 4 names {why}", needle in rule4)
for needle, why in [
    ("SHA-256", "the checksum every binary is checked against"),
    ("cosign", "the signature check where a project publishes one"),
    ("CVE-2026-33634", "the Trivy compromise the rule answers"),
    ("by digest", "images pinned by digest"),
    ("14 days", "the release age"),
    ("yamllint", "the copyleft tooling left out"),
    ("security/allowlist.yaml", "the expiring allowlist"),
]:
    check(f"rule 5 names {why}", needle in rule5)
images = section("4a. Production images and the chart")
check("the deployment section is written", len(images) > 400)
for needle, why in [
    ("10001", "the non-root uid"),
    ("read-only", "the read-only root"),
    ("restricted", "the restricted Pod Security Standard"),
    ("default-deny", "the network policies"),
    ("_FILE", "secrets as files"),
    ("no egress", "vision and the code runner without egress"),
    ("check-sbom-licences.py", "the SBOMs' licence check"),
]:
    check(f"the deployment section names {why}", needle in images)
# A denial ("never certified", "not compliant") is the rule itself; an affirmation is refused.
claims = re.findall(r"(?i)\b(?:is|are|be|been|being)\s+(?:certified|compliant)\b|\bcomplies\b|\bsigned\s+and\s+attested\b", text)
check("the ADR claims no certification, compliance or signature", claims == [], ", ".join(claims))
check("the status no longer says rules 4 and 5 are headings only", "`contracts-11c` writes rules 4 and 5" not in text)
PY
)
while IFS= read -r line; do
  case "$line" in
    "ok   - "*) passed=$((passed + 1)); printf '%s\n' "$line" ;;
    "FAIL - "*) failed=$((failed + 1)); printf '%s\n' "$line" ;;
  esac
done <<<"$out"

printf '\n# %d passed, %d failed\n' "$passed" "$failed"
if [ "$failed" -eq 0 ]; then exit 0; else exit 1; fi
