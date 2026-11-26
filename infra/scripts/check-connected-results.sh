#!/usr/bin/env bash
# Summarises the connected (instrumented) Android test results under a directory and fails unless
# at least one test ran and none was skipped, failed or errored. A green Gradle run alone does not
# show a test that skipped itself, for example the CameraX test on a device without a camera.
#
# With <module>=<minimum> arguments it also fails when a module's results hold fewer tests than its
# minimum (Workflow 10D review, A006): one passing test is not the suite, and a runner argument or
# a build change that leaves most device test classes out would otherwise stay green. A module is
# the directory that holds build/outputs/androidTest-results (openverify-sdk, demo-app).
#
# Usage: infra/scripts/check-connected-results.sh <android project dir> [<module>=<minimum>...]
set -euo pipefail

usage="usage: check-connected-results.sh <android project dir> [<module>=<minimum>...]"
root="${1:?$usage}"
shift
for minimum in "$@"; do
  if ! [[ "$minimum" =~ ^[A-Za-z0-9._-]+=[0-9]+$ ]]; then
    echo "$usage (not a module's minimum: '$minimum')" >&2
    exit 2
  fi
done

find "$root" -path '*/androidTest-results/connected/*' -name '*.xml' -print0 |
  python3 -I -c '
import sys
import xml.etree.ElementTree as ET

paths = [p for p in sys.stdin.read().split("\0") if p]
if not paths:
    print("no connected test results found under " + sys.argv[1])
    sys.exit(1)

minimums = dict((module, int(count)) for module, count in (arg.split("=") for arg in sys.argv[2:]))
ran = dict.fromkeys(minimums, 0)


def module_of(path):
    parts = path.replace("\\", "/").split("/")
    at = parts.index("androidTest-results") if "androidTest-results" in parts else 0
    return parts[at - 3] if at >= 3 and parts[at - 2:at] == ["build", "outputs"] else None


totals = {"tests": 0, "failures": 0, "errors": 0, "skipped": 0}
for path in sorted(paths):
    root = ET.parse(path).getroot()
    suites = [root] if root.tag == "testsuite" else list(root.iter("testsuite"))
    for suite in suites:
        counts = {key: int(suite.get(key) or 0) for key in totals}
        for key in totals:
            totals[key] += counts[key]
        if module_of(path) in ran:
            ran[module_of(path)] += counts["tests"]
        print("{}: {tests} tests, {failures} failures, {errors} errors, {skipped} skipped".format(
            suite.get("name") or path, **counts))

problems = []
if totals["tests"] == 0:
    problems.append("no connected test ran")
for key in ("failures", "errors", "skipped"):
    if totals[key]:
        problems.append("{} {}".format(totals[key], key))
for module in sorted(minimums):
    if ran[module] < minimums[module]:
        problems.append("{}: {} connected tests ran, at least {} expected".format(module, ran[module], minimums[module]))
if problems:
    print("connected tests did not all pass: " + ", ".join(problems))
    sys.exit(1)
print("connected tests: {tests} passed".format(**totals))
' "$root" "$@"
