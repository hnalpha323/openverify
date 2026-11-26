"""KP11-75 (Workflow 11F): ``android_document_guidance.py --write`` keeps the committed summary
block (C279.1) of ``docs/calibration/android-document-guidance.md``, which docs-catalog added in
Workflow 11E and the check catalog reads, byte for byte after the rendered report; a report that
has none gets none. Paths here are temporary; the committed report is never written by a test.
"""

from __future__ import annotations

from pathlib import Path
from typing import Final

from android_document_guidance import write_report

SUMMARY_SECTION: Final = "\n".join(
    [
        "",
        "## Summary block",
        "",
        "Added in Workflow 11E by `docs-catalog`: this report's own figures.",
        "",
        "<!-- openverify:calibration-summary:start -->",
        "```json",
        '{ "schema": "openverify/calibration-summary@1", "rows": [] }',
        "```",
        "<!-- openverify:calibration-summary:end -->",
        "",
    ]
)
RENDERED: Final = "# Android document guidance\n\nSynthetic renders only.\n"


def test_a_new_report_has_no_summary_block(tmp_path: Path) -> None:
    report = tmp_path / "docs" / "report.md"
    write_report(report, RENDERED)
    assert report.read_text(encoding="utf-8") == RENDERED


def test_a_rewrite_keeps_the_committed_summary_block(tmp_path: Path) -> None:
    report = tmp_path / "report.md"
    report.write_text("# An older render\n" + SUMMARY_SECTION, encoding="utf-8")
    write_report(report, RENDERED)
    assert report.read_text(encoding="utf-8") == RENDERED + SUMMARY_SECTION


def test_a_report_without_a_block_is_rewritten_whole(tmp_path: Path) -> None:
    report = tmp_path / "report.md"
    report.write_text("# An older render\n\n## Summary block\n\nno markers\n", encoding="utf-8")
    write_report(report, RENDERED)
    assert report.read_text(encoding="utf-8") == RENDERED
