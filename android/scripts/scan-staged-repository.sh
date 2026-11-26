#!/usr/bin/env bash
# C217.4 (review P25): scan the staged Maven repository for secrets before it leaves the machine.
#
# The staged repository holds archives (AARs, sources jars, javadoc jars), and gitleaks reads files,
# not archives. So every archive is unpacked next to a copy of the repository's plain files (POMs,
# Gradle metadata, checksums), and `gitleaks dir` scans the lot with the repository's own rules
# (.gitleaks.toml). A finding, a missing repository or a missing gitleaks fails the scan.
#
# Usage: android/scripts/scan-staged-repository.sh [<staged repository>]
#        (default: android/build/staging-repo, after ./gradlew publishAllPublicationsToStagingRepository)
set -euo pipefail

scripts_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$scripts_dir/../.." && pwd)
staged=${1:-"$repo_root/android/build/staging-repo"}

if [ ! -d "$staged" ]; then
  echo "scan-staged-repository: $staged is missing: run ./gradlew publishAllPublicationsToStagingRepository first" >&2
  exit 1
fi
if ! command -v gitleaks >/dev/null 2>&1; then
  echo "scan-staged-repository: gitleaks is not installed (infra/scripts/install-gitleaks.sh)" >&2
  exit 1
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Unpack with Python's zipfile, which refuses entries that would leave the target directory.
python3 -I - "$staged" "$work/unpacked" <<'PY'
import shutil
import sys
import zipfile
from pathlib import Path

staged, out = Path(sys.argv[1]), Path(sys.argv[2])
archives = plain = 0
for path in sorted(staged.rglob("*")):
    if not path.is_file():
        continue
    target = out / path.relative_to(staged)
    if path.suffix in (".aar", ".jar"):
        with zipfile.ZipFile(path) as archive:
            archive.extractall(target.with_name(target.name + ".unpacked"))
            # classes.jar inside an AAR is an archive too.
            for inner in archive.namelist():
                if inner.endswith(".jar"):
                    nested = target.with_name(target.name + ".unpacked") / inner
                    with zipfile.ZipFile(nested) as jar:
                        jar.extractall(nested.with_name(nested.name + ".unpacked"))
        archives += 1
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)
        plain += 1
if archives + plain == 0:
    sys.exit("scan-staged-repository: the staged repository is empty")
print(f"scan-staged-repository: unpacked {archives} archives and copied {plain} other files")
PY

gitleaks dir --config "$repo_root/.gitleaks.toml" --redact --no-banner --no-color "$work/unpacked"
echo "scan-staged-repository: no secret found in $(basename "$staged")"
