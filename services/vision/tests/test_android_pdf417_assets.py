"""The Android SDK's PDF417 device-test assets and the host calibration of its hint (C203, C219.5).

The device test (``ZxingCppBarcodeReaderDeviceTest``, in the SDK's ``androidDeviceTest``) decodes
synthetic AAMVA PDF417 images with zxing-cpp's Android library. The images are committed, so no
Android build needs Python or the vision environment (review F19); this test holds them equal to
``synthetic_aamva.py``'s output, at the generator's full size and downscaled to the document
analysis width of C201.2 (640 px), and holds ``index.json`` (each image's vector, size and payload
digest) to the vectors. It writes them only under ``UPDATE_CONTRACT_FIXTURES=1``.

The calibration (C203.3, review F11) runs here, on the host, with the vision service's pinned
zxing-cpp, whose C++ core is the Android AAR's (the same version, asserted below), and the options
the Android reader uses. It covers synthetic barcode-only renders and nothing about real camera
frames, lenses, focus, motion or lighting. Its record says how many pixels a module the decoder
needs, so how much of an analysis frame's width the symbol must span; it is a measurement, not a
tuned threshold, and the device's "barcode found" stays a hint, never an auto-capture gate, until
the CI device test confirms the host result on the emulator.
"""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

import numpy as np
import pytest
import zxingcpp
from PIL import Image

from synthetic_aamva import (
    AAMVA_VECTOR_DIR,
    MODULE_PX,
    QUIET_ZONE_PX,
    VECTOR_FILES,
    render_barcode,
)

REPO: Final = Path(__file__).resolve().parents[3]
ASSET_DIR: Final = (
    REPO / "android" / "openverify-sdk" / "src" / "androidDeviceTest" / "resources" / "capture"
) / "barcode"
INDEX_FILE: Final = "index.json"
VERSION_CATALOG: Final = REPO / "android" / "gradle" / "libs.versions.toml"
UPDATE: Final = os.environ.get("UPDATE_CONTRACT_FIXTURES") == "1"

ASSET_VECTORS: Final = ("dl-636014-real-id", "id-636020-not-real-id", "file-type-not-ansi")
"""A driver licence and an ID card, both AAMVA, and a PDF417 whose header is not AAMVA's (it
decodes, and the device must not say "barcode found")."""

ANALYSIS_WIDTH_PX: Final = 640
"""C201.2: the document analysis width. A side the server marks barcode-bearing is analysed at
1,280 px or more (C201.2), wider than the generator's image, so only 640 is a downscale."""

DOWNSCALE: Final = Image.Resampling.BOX
"""Area averaging, the way a camera's scaler bins pixels; the calibration also tries bilinear."""

MODULES_WIDE: Final = 290
"""The symbol's width in modules at 13 data columns: start 17, left row indicator 17, 13 x 17, right
row indicator 17, stop 18 (ISO/IEC 15438)."""

SWEEP_WIDTHS_PX: Final = (950, 896, 832, 768, 704, 640, 576, 544, 512, 480, 448, 416, 384, 352, 320)
"""The widths the calibration decodes at: the generator's 950 down to about one pixel a module."""

RECORDED_MIN_RELIABLE_WIDTH_PX: Final = 512
"""Measured (2026-11-09, zxing-cpp 3.1.1, pdf417gen 0.8.1, Pillow 13.0.0): the narrowest sweep width
at which every valid vector decodes to its exact payload under both resamplings, as does every wider
one. 3 x 512 / 950 = 1.62 pixels a module. Below it decoding is erratic (480 decodes after bilinear
scaling only; 320, about one pixel a module, decodes by aliasing luck)."""


@dataclass(frozen=True, slots=True)
class Vector:
    id: str
    payload: bytes
    aamva_header: bool


def vectors() -> dict[str, Vector]:
    """Every AAMVA vector; its header is AAMVA's unless the server refuses it as a header."""
    found: dict[str, Vector] = {}
    for name in VECTOR_FILES:
        document = json.loads((AAMVA_VECTOR_DIR / name).read_text(encoding="utf-8"))
        for vector in document["vectors"]:
            found[vector["id"]] = Vector(
                id=vector["id"],
                payload=vector["payload"].encode("ascii"),
                aamva_header=vector.get("error") != "aamva_header_invalid",
            )
    return found


def downscaled(image: Image.Image, width: int, resampling: Image.Resampling) -> Image.Image:
    if width == image.width:
        return image
    return image.resize((width, round(image.height * width / image.width)), resampling)


@dataclass(frozen=True, slots=True)
class Asset:
    file: str
    vector: Vector
    image: Image.Image
    scale: str


def expected_assets() -> list[Asset]:
    by_id = vectors()
    assets: list[Asset] = []
    for vector_id in ASSET_VECTORS:
        vector = by_id[vector_id]
        full = render_barcode(vector.payload.decode("ascii"))
        assets.append(Asset(f"{vector_id}-full.png", vector, full, "full"))
        analysis = downscaled(full, ANALYSIS_WIDTH_PX, DOWNSCALE)
        assets.append(Asset(f"{vector_id}-w{ANALYSIS_WIDTH_PX}.png", vector, analysis, "analysis"))
    return assets


def expected_index() -> dict[str, Any]:
    return {
        "format": 1,
        "description": (
            "C203, C219.5: synthetic AAMVA PDF417 images for the SDK's zxing-cpp device test, "
            "written by services/vision/tests/test_android_pdf417_assets.py from "
            "services/vision/tools/synthetic_aamva.py (ZC-marked synthetic data, never a real "
            "licence), at the generator's full size and downscaled (box) to the document analysis "
            "width of C201.2."
        ),
        "analysis-width-px": ANALYSIS_WIDTH_PX,
        "assets": [
            {
                "file": asset.file,
                "vector": asset.vector.id,
                "scale": asset.scale,
                "width": asset.image.width,
                "height": asset.image.height,
                "aamva-header": asset.vector.aamva_header,
                "payload-sha256": hashlib.sha256(asset.vector.payload).hexdigest(),
            }
            for asset in expected_assets()
        ],
    }


def write_assets() -> None:
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    for asset in expected_assets():
        asset.image.save(ASSET_DIR / asset.file, format="PNG", optimize=True)
    text = json.dumps(expected_index(), indent=2, ensure_ascii=False) + "\n"
    (ASSET_DIR / INDEX_FILE).write_text(text, encoding="utf-8")


def android_read(image: Image.Image) -> list[bytes]:
    """zxing-cpp with the Android reader's options (``pdf417Options()``, the SDK's androidMain)."""
    results = zxingcpp.read_barcodes(
        image,
        formats=zxingcpp.BarcodeFormats(zxingcpp.BarcodeFormat.PDF417),
        try_rotate=True,
        try_downscale=True,
        try_invert=False,
        text_mode=zxingcpp.TextMode.Plain,
        binarizer=zxingcpp.Binarizer.LocalAverage,
        is_pure=False,
    )
    return [result.bytes for result in results]


@pytest.fixture(scope="module", autouse=True)
def _update() -> None:
    if UPDATE:
        write_assets()


def test_the_committed_images_equal_the_generators_output() -> None:
    for asset in expected_assets():
        path = ASSET_DIR / asset.file
        assert path.is_file(), f"{asset.file} is missing: run with UPDATE_CONTRACT_FIXTURES=1"
        with Image.open(path) as committed:
            assert committed.mode == asset.image.mode, asset.file
            assert committed.size == asset.image.size, asset.file
            assert np.array_equal(np.asarray(committed), np.asarray(asset.image)), asset.file


def test_the_folder_holds_the_images_and_their_index_only() -> None:
    expected = {asset.file for asset in expected_assets()} | {INDEX_FILE}
    assert {path.name for path in ASSET_DIR.iterdir()} == expected


def test_the_index_names_each_images_vector_size_and_payload_digest() -> None:
    committed = json.loads((ASSET_DIR / INDEX_FILE).read_text(encoding="utf-8"))
    assert committed == expected_index()


def test_each_image_is_a_few_kilobytes() -> None:
    for asset in expected_assets():
        assert (ASSET_DIR / asset.file).stat().st_size < 8 * 1024, asset.file


def test_the_host_decoder_is_the_android_aars_core() -> None:
    catalog = VERSION_CATALOG.read_text(encoding="utf-8")
    pinned = re.search(r'^zxingCpp\s*=\s*"([^"]+)"', catalog, re.MULTILINE)
    assert pinned is not None, "libs.versions.toml pins zxingCpp (zxing-cpp-android's version)"
    assert importlib.metadata.version("zxing-cpp") == pinned.group(1)


def test_each_image_decodes_to_its_exact_payload_with_the_android_options() -> None:
    for asset in expected_assets():
        with Image.open(ASSET_DIR / asset.file) as committed:
            assert android_read(committed) == [asset.vector.payload], asset.file


def calibration_sweep() -> dict[int, bool]:
    """Per width: whether every valid vector decodes to its exact payload, box and bilinear."""
    valid_ids = set(_valid_ids())
    valid = [vector for vector in vectors().values() if vector.id in valid_ids]
    sweep: dict[int, bool] = {}
    for width in SWEEP_WIDTHS_PX:
        sweep[width] = all(
            android_read(downscaled(render_barcode(v.payload.decode("ascii")), width, resampling))
            == [v.payload]
            for v in valid
            for resampling in (Image.Resampling.BOX, Image.Resampling.BILINEAR)
        )
    return sweep


def _valid_ids() -> list[str]:
    document = json.loads((AAMVA_VECTOR_DIR / "valid.json").read_text(encoding="utf-8"))
    return [vector["id"] for vector in document["vectors"]]


def min_reliable_width(sweep: dict[int, bool]) -> int:
    """The narrowest width that decodes, every wider one decoding too."""
    reliable = SWEEP_WIDTHS_PX[0]
    for width in SWEEP_WIDTHS_PX:
        if not sweep[width]:
            break
        reliable = width
    return reliable


def test_the_calibration_at_the_analysis_resolution() -> None:
    sweep = calibration_sweep()
    width = min_reliable_width(sweep)
    full_width = MODULES_WIDE * MODULE_PX + 2 * QUIET_ZONE_PX
    pixels_a_module = MODULE_PX * width / full_width
    shares = {analysis: round(width / analysis, 2) for analysis in (640, 1280)}
    print(  # the record, read with pytest -s
        f"\nPDF417 calibration: {sweep}\nnarrowest reliable width {width} px "
        f"({pixels_a_module:.2f} px a module); the share of the frame width the symbol must "
        f"span: {shares}"
    )
    assert full_width == SWEEP_WIDTHS_PX[0] == 950, "the generator's module and quiet-zone size"
    assert sweep[full_width], "every valid vector decodes at the generator's size"
    assert width == RECORDED_MIN_RELIABLE_WIDTH_PX, (
        "the measured calibration moved: re-measure, update RECORDED_MIN_RELIABLE_WIDTH_PX and the "
        "pdf417-guidance record, never the constant alone"
    )
    # At the document analysis width the symbol must span 80% of the frame, a card held close; at
    # C201.2's 1,280 px for a barcode-bearing side, 40%, which a card filling its guide gives.
    assert shares == {640: 0.8, 1280: 0.4}
