"""C33: the Phase 3 libraries, pinned at the versions whose licences were checked.

``zxing-cpp`` (Apache-2.0, zint BSD-3) decodes PDF417 at runtime; ``pdf417gen`` (MIT) and
``iso3166`` (MIT) are dev-only, for the synthetic fixtures and the country table generator.
``pyclipper`` (Boost licence) and ``shapely`` (GEOS, LGPL-2.1) must stay out (C33).
"""

from __future__ import annotations

import importlib.util
import json
import tomllib
from pathlib import Path
from typing import Any

PYPROJECT = Path(__file__).resolve().parents[1] / "pyproject.toml"
LOCK = Path(__file__).resolve().parents[1] / "uv.lock"


def _pyproject() -> dict[str, Any]:
    return tomllib.loads(PYPROJECT.read_text(encoding="utf-8"))


def _locked_versions() -> dict[str, str]:
    lock = tomllib.loads(LOCK.read_text(encoding="utf-8"))
    return {package["name"]: package["version"] for package in lock["package"]}


def test_zxing_cpp_is_a_pinned_runtime_dependency() -> None:
    assert "zxing-cpp==3.1.1" in _pyproject()["project"]["dependencies"]
    assert _locked_versions()["zxing-cpp"] == "3.1.1"


def test_the_fixture_generators_get_pinned_dev_dependencies() -> None:
    dev = _pyproject()["dependency-groups"]["dev"]
    assert "pdf417gen==0.8.1" in dev
    assert "iso3166==3.0.0" in dev
    locked = _locked_versions()
    assert (locked["pdf417gen"], locked["iso3166"]) == ("0.8.1", "3.0.0")


def test_no_boost_or_lgpl_geometry_library_is_added() -> None:
    locked = _locked_versions()
    assert "pyclipper" not in locked
    assert "shapely" not in locked


def test_scikit_image_is_a_pinned_dev_only_test_oracle() -> None:
    # C41 (research §7): scikit-image's SSIM is the test oracle of our own OpenCV SSIM. It and
    # the two helpers it pulls are pinned at versions at least 14 days old, and never shipped.
    dev = _pyproject()["dependency-groups"]["dev"]
    for pin in ("scikit-image==0.26.0", "imageio==2.38.0", "tifffile==2026.9.20"):
        assert pin in dev
    runtime = " ".join(_pyproject()["project"]["dependencies"])
    assert "scikit-image" not in runtime
    assert "scipy" not in runtime
    locked = _locked_versions()
    assert (locked["scikit-image"], locked["imageio"], locked["tifffile"]) == (
        "0.26.0",
        "2.38.0",
        "2026.9.20",
    )


# --- C60.3 (Workflow 5B Stage 1): the PDF libraries ------------------------------------------

REPO_ROOT = Path(__file__).resolve().parents[3]
NOTICE = Path(__file__).resolve().parents[1] / "NOTICE"
THIRD_PARTY_LICENSES = REPO_ROOT / "THIRD_PARTY_LICENSES.md"

PDF_PINS = {"pypdfium2": "5.14.0", "pypdf": "6.21.4"}
"""C60.3: the researched pins (decision 30: a fixed build is adopted once it is 14 days old)."""

PDFIUM_BUILD = 8076
"""The PDFium build pypdfium2 5.14.0 bundles (pdfium-binaries chromium/8076, 156.0.8076.0)."""

BANNED_PDF_PACKAGES = frozenset(
    {
        # AGPL-3.0 (PyMuPDF and MuPDF), with PyMuPDF's old import name.
        "pymupdf",
        "pymupdfb",
        "pymupdf-fonts",
        "fitz",
        "mupdf",
        # MPL-2.0 at runtime, with GPL and OpenSSL texts in its wheel.
        "pikepdf",
        # poppler (GPL) and its wrappers.
        "python-poppler",
        "poppler-utils",
        "pdf2image",
        "pdftotext",
        # Ghostscript (AGPL) wrappers.
        "ghostscript",
        "python3-ghostscript",
        # pdf.js runs in a browser; its Python ports are not used either.
        "pdfjs",
        # reportlab ships the GPL DarkGarden font; fpdf2 is LGPL-3.0; borb is AGPL.
        "reportlab",
        "fpdf2",
        "fpdf",
        "borb",
        # The unrelated PyPI "qpdf" pulls PyMuPDF and pikepdf.
        "qpdf",
    }
)
"""C60.3: PDF libraries that must never be locked, at runtime or for development."""


def test_the_pdf_libraries_are_pinned_runtime_dependencies() -> None:
    runtime = _pyproject()["project"]["dependencies"]
    locked = _locked_versions()
    for name, version in PDF_PINS.items():
        assert f"{name}=={version}" in runtime, name
        assert locked.get(name) == version, name


def test_no_banned_pdf_library_is_locked() -> None:
    locked = {name.lower() for name in _locked_versions()}
    assert sorted(BANNED_PDF_PACKAGES & locked) == []


def test_the_installed_pdfium_is_the_build_the_cve_record_names() -> None:
    spec = importlib.util.find_spec("pypdfium2_raw")
    assert spec is not None
    assert spec.origin is not None
    version = json.loads((Path(spec.origin).parent / "version.json").read_text(encoding="utf-8"))
    assert (version["major"], version["build"]) == (156, PDFIUM_BUILD)
    record = THIRD_PARTY_LICENSES.read_text(encoding="utf-8")
    assert "CVE-2026-113022" in record
    assert f"PDFium build {PDFIUM_BUILD}" in record
    for needle in ("CVE-2026-110155", "CVE-2026-118345", "chromium/8125"):
        assert needle in record, needle


def test_the_notice_carries_the_credits_the_bundled_licences_ask_for() -> None:
    notice = NOTICE.read_text(encoding="utf-8")
    for needle in (
        # FTL §2: binary redistribution states it is based in part on the FreeType Team's work.
        "based in part on the work of the FreeType Team",
        "Portions of this software are copyright",
        "The FreeType Project (www.freetype.org)",
        # IJG: executable-only distribution names the Independent JPEG Group.
        "based in part on the work of the Independent JPEG Group",
        "UNICODE LICENSE V3",
        "Anti-Grain Geometry",
        "PNG Reference Library License version 2",
        "Apache License v2.0 with LLVM Exceptions",
        "zlib",
        # pypdf's Core-14 AFM metrics travel with Adobe's permission notice.
        "Adobe Systems Incorporated",
        "AFM",
        f"pypdfium2 {PDF_PINS['pypdfium2']}",
        f"pypdf {PDF_PINS['pypdf']}",
    ):
        assert needle in notice, needle


def test_third_party_licenses_lists_the_pdf_libraries_and_their_bundled_licences() -> None:
    record = THIRD_PARTY_LICENSES.read_text(encoding="utf-8")
    for needle in (
        "pypdfium2",
        "pypdf",
        "FTL",
        "Unicode-3.0",
        "IJG",
        "Zlib",
        "libpng-2.0",
        "AGG",
        "LLVM-exception",
        "Adobe",
        "PyMuPDF",
    ):
        assert needle in record, needle


# --- Phase 9 decision 62 (Workflow 9A Stage 1a): the 14-day release age ----------------------


def test_uv_holds_every_resolution_to_a_relative_14_day_release_age() -> None:
    # uv checks age only when it resolves, never at sync, so the rule lives in the project's
    # own configuration, and the lock proves it was resolved from there.
    uv = _pyproject()["tool"]["uv"]
    assert uv["exclude-newer"] == "14 days"
    assert "exclude-newer-package" not in uv
    options = tomllib.loads(LOCK.read_text(encoding="utf-8"))["options"]
    assert options["exclude-newer-span"] == "P14D"
    # A command line's --exclude-newer writes one absolute date that binds every later
    # resolution; only uv's own no-op value may appear in its place.
    assert options.get("exclude-newer", "0001-01-01T00:00:00Z") == "0001-01-01T00:00:00Z"
    assert "exclude-newer-package" not in options


# --- Workflow 11C (C259.2): the bumps the supply-chain checks asked for ------------------------


def test_fastapis_opentelemetry_api_is_the_patched_release() -> None:
    # pip-audit (scanners-11c) reported opentelemetry-api 1.45.1, which FastAPI pulls in; 1.45.2
    # (2026-10-29, Apache-2.0) is the fix, more than 14 days old when integration-11c adopted it.
    assert _locked_versions()["opentelemetry-api"] == "1.45.2"
