"""ZAP packaged-scan hooks of security/zap/run.sh (Phase 11, Workflow 11F, dast-11f; C283.1).

ZAP's own Python runs this file inside its container (`--hook /zap/wrk/zap-hooks.py`); it uses only
the standard library and the `zap` client ZAP hands each hook. Everything comes from environment
variables run.sh passes by name, so no credential is ever on a command line:

  OPENVERIFY_ZAP_HEADER_NAME / _VALUE / _SCOPE  one replacer rule adding that request header (the API
      key, a session token, or the console's session cookie) to requests whose URL matches _SCOPE, a
      regular expression of the run's loopback origin only (C283.1: the console session through a
      replacer rule, so MFA is not scripted);
  OPENVERIFY_ZAP_EXCLUDE    regular expressions, one per line, the spider and the active scan skip;
  OPENVERIFY_ZAP_SEED_URLS  URLs, one per line, ZAP requests once before it spiders (entries no link
      reaches, such as the flow's preview and embed pages);
  OPENVERIFY_ZAP_ATTACK_STRENGTH  the API scan policy's attack strength for every rule (LOW, so
      the whole policy fits one call at the request rate the API's per-key limit allows);
  OPENVERIFY_ZAP_SCAN       the scan's name: before ZAP stops, every request it sent and answered is
      written to /zap/wrk/<scan>-messages.json as [method, url, status] (never a header or a body),
      and whether an active scan ended before it finished to /zap/wrk/<scan>-capped.txt.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

WORK = "/zap/wrk"
PAGE = 500
# The API scan's policy: given a config file (-c rules.tsv), zap-api-scan.py runs ZAP's
# "Default Policy" with every active rule enabled, minus the config's IGNOREs.
POLICY = "Default Policy"


def _lines(name: str) -> list[str]:
    return [
        line.strip() for line in os.environ.get(name, "").splitlines() if line.strip()
    ]


def zap_started(zap: Any, target: str) -> None:
    name = os.environ.get("OPENVERIFY_ZAP_HEADER_NAME", "")
    value = os.environ.get("OPENVERIFY_ZAP_HEADER_VALUE", "")
    scope = os.environ.get("OPENVERIFY_ZAP_HEADER_SCOPE", "")
    if name and value:
        if not scope:
            raise RuntimeError(
                "a credential header needs its scope (OPENVERIFY_ZAP_HEADER_SCOPE)"
            )
        zap.replacer.add_rule(
            description="openverify-dast-credential",
            enabled="true",
            matchtype="REQ_HEADER",
            matchregex="false",
            matchstring=name,
            replacement=value,
            initiators="",
            url=scope,
        )
    for pattern in _lines("OPENVERIFY_ZAP_EXCLUDE"):
        zap.spider.exclude_from_scan(pattern)
        zap.ascan.exclude_from_scan(pattern)
    for url in _lines("OPENVERIFY_ZAP_SEED_URLS"):
        zap.core.access_url(url=url, followredirects="false")
    strength = os.environ.get("OPENVERIFY_ZAP_ATTACK_STRENGTH", "")
    if strength in ("LOW", "MEDIUM", "HIGH", "INSANE"):
        for scanner in zap.ascan.scanners(scanpolicyname=POLICY):
            zap.ascan.set_scanner_attack_strength(
                id=scanner["id"], attackstrength=strength, scanpolicyname=POLICY
            )


def _first_line(text: Any) -> str:
    return str(text or "").split("\r\n", 1)[0].split("\n", 1)[0]


def message_row(message: Any) -> list[Any] | None:
    """[method, url, status] of one ZAP message; the rest of the message is dropped."""
    request = _first_line(message.get("requestHeader")).split(" ")
    status = re.match(r"HTTP/\S+\s+(\d{3})", _first_line(message.get("responseHeader")))
    if len(request) < 2:
        return None
    url = request[1].split("#", 1)[0].split("?", 1)[0]
    return [request[0], url, int(status.group(1)) if status else 0]


def zap_pre_shutdown(zap: Any) -> None:
    scan = os.environ.get("OPENVERIFY_ZAP_SCAN", "")
    if not re.fullmatch(r"[a-z0-9-]{1,48}", scan):
        return
    rows: list[list[Any]] = []
    total = int(zap.core.number_of_messages())
    for start in range(1, total + 1, PAGE):
        for message in zap.core.messages(start=str(start), count=str(PAGE)):
            row = message_row(message)
            if row is not None:
                rows.append(row)
    with open(
        os.path.join(WORK, f"{scan}-messages.json"), "w", encoding="utf-8"
    ) as handle:
        json.dump(rows, handle)
    scans = zap.ascan.scans  # a property of ZAP's client, not a method
    capped = "n/a"
    if scans:
        capped = (
            "yes" if any(int(s.get("progress", 100)) < 100 for s in scans) else "no"
        )
        progress: list[list[Any]] = []
        for scan_record in scans:
            for host in zap.ascan.scan_progress(scanid=scan_record["id"]):
                if not isinstance(host, dict):
                    continue
                for plugins in host.values():
                    for plugin in plugins if isinstance(plugins, list) else []:
                        rows_of = (
                            plugin.get("Plugin", []) if isinstance(plugin, dict) else []
                        )
                        if len(rows_of) >= 4:
                            progress.append([rows_of[1], rows_of[0], rows_of[3]])
        with open(
            os.path.join(WORK, f"{scan}-progress.json"), "w", encoding="utf-8"
        ) as handle:
            json.dump(progress, handle)
    with open(
        os.path.join(WORK, f"{scan}-capped.txt"), "w", encoding="utf-8"
    ) as handle:
        handle.write(capped + "\n")
