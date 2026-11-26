#!/usr/bin/env python3
"""C214.5: the consumer check's verification metadata trusts the staged OpenVerify group.

``android/consumer-check/`` is a build of its own, so it has its own
``gradle/verification-metadata.xml``. Gradle writes it (from a fresh ``GRADLE_USER_HOME``, in a scratch
worktree that holds a staged repository)::

    (cd android && ./gradlew -p consumer-check build --write-locks --write-verification-metadata sha256)
    python3 -I android/scripts/trust-staged-group.py

Gradle also writes checksums for the OpenVerify artifacts it found in the staged repository. Those are
built by the call before the consumer check and change with every commit, so a committed checksum
would fail the next build. This tool removes them and adds one ``<trust group="..."/>`` entry instead:
the staged group is the thing under test, and the settings file lets it come from the staged repository
only. Every other component keeps the checksum Gradle wrote.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ANDROID = Path(__file__).resolve().parent.parent
METADATA_PATH = ANDROID / "consumer-check/gradle/verification-metadata.xml"


def staged_group() -> str:
    for line in (ANDROID / "gradle.properties").read_text(encoding="utf-8").splitlines():
        if line.startswith("openverifyGroup="):
            return line.split("=", 1)[1].strip()
    raise ValueError("android/gradle.properties holds no openverifyGroup")


def trust_group(text: str, group: str) -> str:
    """The metadata without the group's components and with one trust entry for it."""
    if "</configuration>" not in text:
        raise ValueError("no <configuration> block: not a verification-metadata file")
    component = re.compile(rf'^[ \t]*<component group="{re.escape(group)}" .*?</component>[ \t]*\n', re.DOTALL | re.MULTILINE)
    text = component.sub("", text)
    trust = f'<trust group="{group}"/>'
    if trust in text:
        return text
    block = f"      <trusted-artifacts>\n         {trust}\n      </trusted-artifacts>\n"
    return text.replace("   </configuration>", block + "   </configuration>", 1)


def main() -> int:
    group = staged_group()
    before = METADATA_PATH.read_text(encoding="utf-8")
    after = trust_group(before, group)
    METADATA_PATH.write_text(after, encoding="utf-8")
    removed = before.count(f'<component group="{group}"')
    print(f"trust-staged-group: {METADATA_PATH.name} trusts {group}; {removed} component(s) of it removed, {after.count('<component ')} kept")
    return 0


if __name__ == "__main__":
    sys.exit(main())
