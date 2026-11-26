"""Phase 12A V1: a bounded multi-pass PDF417 decode for phone captures of a licence's back.

The baseline (``docs/plans/phase-12a.plan.md`` section 2.1) read one zxing-cpp pass on the
upload and one on the rectified card, and lost the barcode to tilt, glare, motion and blur, and a
denser symbol to mild softness. :func:`barcode.recover_pdf417` runs when neither pass decoded a
PDF417: it crops the barcode region (a dense-texture region of the upload, and of the rectified
card when there is one), upscales it and tries a bounded sequence of enhancements, reporting a
symbol only when zxing-cpp decodes it whole. Captures come from ``tools/synthetic_quebec.py``.
"""

from __future__ import annotations

import base64
import math
import time
from typing import Final

import cv2
import numpy as np
import pytest
import zxingcpp

from openverify_vision import barcode
from openverify_vision.barcode import MAX_RECOVERY_PASSES, decode_side_barcodes, recover_pdf417
from openverify_vision.document import NOT_FOUND, DocumentResult, detect_document
from openverify_vision.schemas import Barcode
from quebec_captures import bgr, card_to_frame, photo, true_document
from synthetic_quebec import BACKS, CAPTURES, Capture, _glare, photograph, render_back

STANDARD_DECODED: Final = (
    "flat",
    "phone-1080",
    "phone-1080-soft",
    "phone-1080-tilt",
    "phone-1080-glare",
    "phone-1080-q75",
    "phone-full",
)
DENSE_DECODED: Final = ("flat", "phone-1080", "phone-1080-tilt", "phone-1080-q75", "phone-full")
UNDECODABLE: Final = ("phone-1080-blur", "phone-1080-motion")
"""May stay undecoded (plan V1), never with a wrong payload."""

NOTHING: Final = DocumentResult(detection=NOT_FOUND, rectified=None)


def pdf417s(found: list[Barcode]) -> list[bytes]:
    return [base64.b64decode(item.bytes_b64) for item in found if item.format == "PDF417"]


def side_barcodes(name: str, back: str) -> tuple[list[Barcode], bytes]:
    shot = photo("back", name, back)
    image = bgr(shot)
    assert shot.payload is not None
    return decode_side_barcodes(image, detect_document(image)), shot.payload.encode("ascii")


@pytest.mark.parametrize("name", STANDARD_DECODED)
def test_the_standard_back_decodes_to_exactly_its_payload(name: str) -> None:
    found, payload = side_barcodes(name, "standard")

    assert pdf417s(found) == [payload]


@pytest.mark.parametrize("name", DENSE_DECODED)
def test_the_dense_back_decodes_to_exactly_its_payload(name: str) -> None:
    found, payload = side_barcodes(name, "dense")

    assert pdf417s(found) == [payload]


@pytest.mark.parametrize("back", ["standard", "dense"])
@pytest.mark.parametrize("name", [*UNDECODABLE, "phone-1080-glare"])
def test_a_degraded_back_never_reports_a_wrong_payload(name: str, back: str) -> None:
    found, payload = side_barcodes(name, back)

    assert set(pdf417s(found)) <= {payload}


def test_the_dense_glare_erases_more_of_the_symbol_than_zxing_can_correct() -> None:
    """Why the dense back under the generator's glare is not in the decoded set: the clipped
    highlight leaves the symbol unreadable even printed perfectly (24 px/mm, no blur, noise or
    JPEG), while the standard symbol under the same glare still decodes."""
    for back, readable in (("standard", True), ("dense", False)):
        side = render_back(px_per_mm=24.0, back=back)
        assert side.barcode_box is not None
        assert side.payload is not None
        x, y, w, h = side.barcode_box
        pixels = np.asarray(side.image, dtype=np.float32)
        glared = _glare(pixels, (x + 0.68 * w, y + 0.45 * h), 0.16 * pixels.shape[1])
        grey = cv2.cvtColor(np.clip(glared, 0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY)
        decoded = zxingcpp.read_barcodes(grey, formats=zxingcpp.BarcodeFormat.PDF417)
        assert any(bytes(r.bytes) == side.payload.encode("ascii") for r in decoded) is readable
    assert BACKS["dense"].module_mm < BACKS["standard"].module_mm


@pytest.mark.parametrize("name", list(CAPTURES))
def test_a_front_never_yields_a_pdf417(name: str) -> None:
    image = bgr(photo("front", name))

    assert pdf417s(decode_side_barcodes(image, detect_document(image))) == []


def test_the_recovered_quad_outlines_the_symbol_in_upload_pixels() -> None:
    shot = photo("back", "phone-1080-tilt")
    side = render_back()
    assert side.barcode_box is not None
    x, y, w, h = side.barcode_box
    corners = np.array([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], dtype=np.float64)
    truth = cv2.perspectiveTransform(corners.reshape(-1, 1, 2), card_to_frame(shot)).reshape(-1, 2)

    recovered = recover_pdf417(bgr(shot), NOTHING)

    assert recovered is not None
    # zxing-cpp's corners are the symbol's own (start to stop pattern); the truth is the drawn
    # symbol: within two modules of each other.
    tolerance = 2 * (shot.module_px or 0.0) + 2.0
    for found_corner in recovered.quad:
        assert min(math.dist(found_corner, tuple(t)) for t in truth) <= tolerance


def test_the_rectified_card_gives_the_recovery_its_region_when_there_is_one() -> None:
    shot = photo("back", "phone-1080-tilt")
    assert shot.payload is not None

    recovered = recover_pdf417(bgr(shot), true_document(shot))

    assert recovered is not None
    assert base64.b64decode(recovered.bytes_b64) == shot.payload.encode("ascii")


@pytest.mark.parametrize("name", UNDECODABLE)
def test_the_recovery_is_bounded_in_passes(name: str, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[int] = []
    real = barcode._read_pdf417

    def counted(*args: object, **kwargs: object) -> list[zxingcpp.Barcode]:
        calls.append(1)
        return real(*args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(barcode, "_read_pdf417", counted)
    shot = photo("back", name)
    started = time.perf_counter()

    recover_pdf417(bgr(shot), true_document(shot))

    assert 0 < len(calls) <= MAX_RECOVERY_PASSES <= 24
    assert time.perf_counter() - started < 10.0


def test_a_pass_that_decodes_two_different_symbols_is_ambiguous_and_skipped(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    shot = photo("back", "phone-1080-tilt")
    real = barcode._read_pdf417

    def doubled(*args: object, **kwargs: object) -> list[zxingcpp.Barcode]:
        found = real(*args, **kwargs)  # type: ignore[arg-type]
        other = zxingcpp.read_barcodes(
            np.asarray(
                zxingcpp.create_barcode("OTHER", zxingcpp.BarcodeFormat.PDF417).to_image(scale=3)
            ),
            formats=zxingcpp.BarcodeFormat.PDF417,
        )
        return [*found, *other] if found else found

    monkeypatch.setattr(barcode, "_read_pdf417", doubled)

    assert recover_pdf417(bgr(shot), NOTHING) is None


def test_the_recovery_runs_only_when_no_pdf417_was_decoded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def never(*args: object) -> None:
        raise AssertionError("the first passes decoded the PDF417")

    monkeypatch.setattr(barcode, "recover_pdf417", never)
    found, payload = side_barcodes("phone-1080", "standard")

    assert pdf417s(found) == [payload]


def test_a_texture_free_upload_has_no_region_to_recover() -> None:
    blank = np.full((1920, 1080, 3), 128, dtype=np.uint8)

    assert recover_pdf417(blank, NOTHING) is None


GLARE_SEEDS: Final = range(17, 41)


def test_glare_at_any_noise_seed_decodes_right_or_not_at_all() -> None:
    """The generator's glare leaves the standard symbol near the edge of its error correction:
    across 24 noise seeds the recovery decodes most, and never a miscorrected payload (seeds 19
    and 38 give one such decode, which used all the correction and is never confirmed)."""
    decoded = 0
    for seed in GLARE_SEEDS:
        shot = photograph("back", Capture(f"glare-{seed}", glare=True, seed=seed))
        assert shot.payload is not None
        image = bgr(shot)
        found = pdf417s(decode_side_barcodes(image, detect_document(image)))
        assert set(found) <= {shot.payload.encode("ascii")}, seed
        decoded += len(found)
    assert decoded >= 18


def exhausted(monkeypatch: pytest.MonkeyPatch, *, decodes: int) -> list[int]:
    """Every decode reports all its error correction used; only the first ``decodes`` reads
    that decode anything return it. Returns the list the reads are counted in."""
    calls: list[int] = []
    real = barcode._read_pdf417

    def limited(*args: object, **kwargs: object) -> list[zxingcpp.Barcode]:
        found = real(*args, **kwargs)  # type: ignore[arg-type]
        if any(result.valid for result in found):
            calls.append(1)
            return found if len(calls) <= decodes else []
        return found

    monkeypatch.setattr(barcode, "_read_pdf417", limited)
    monkeypatch.setattr(barcode, "_correction_left", lambda result: False)
    return calls


def test_a_decode_that_used_all_its_correction_needs_a_second_pass_to_agree(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    shot = photo("back", "phone-1080-tilt")
    exhausted(monkeypatch, decodes=1)

    assert recover_pdf417(bgr(shot), NOTHING) is None


def test_two_passes_agreeing_confirm_it(monkeypatch: pytest.MonkeyPatch) -> None:
    shot = photo("back", "phone-1080-tilt")
    assert shot.payload is not None
    exhausted(monkeypatch, decodes=2)

    recovered = recover_pdf417(bgr(shot), NOTHING)

    assert recovered is not None
    assert base64.b64decode(recovered.bytes_b64) == shot.payload.encode("ascii")


def test_the_unused_correction_is_read_from_zxing_cpp() -> None:
    clean = render_back(px_per_mm=12.0)
    grey = cv2.cvtColor(np.asarray(clean.image), cv2.COLOR_RGB2GRAY)
    (result,) = barcode._read_pdf417(grey)

    assert barcode._correction_left(result)
