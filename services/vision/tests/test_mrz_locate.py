"""``mrz_locate.py``: the machine-readable zone (C32.1 ``mrz``) without the text models.

Localisation is classical (morphological blackhat, horizontal gradient, closing and contours on
the lower part of the document) and is tested here on rendered zones; the line reader is a fake
engine. The real recognizer reads the ICAO examples in ``test_mrz_locate_models.py``.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import pytest

from openverify_vision.imaging import ImageArray
from openverify_vision.mrz_locate import MRZ_ALPHABET, find_mrz_lines, guess_format, locate_mrz
from openverify_vision.ocr import OcrEngine
from openverify_vision.ocr.recognition import Reading
from openverify_vision.schemas import MAX_MRZ_LINE_LENGTH, MrzFormat
from openverify_vision.settings import Settings
from text_images import PX_PER_MM, Placed, render_lines, render_mrz_document

VECTORS = Path(__file__).resolve().parents[3] / "contracts" / "fixtures" / "mrz"


def icao_lines(file: str) -> list[str]:
    vectors: list[dict[str, Any]] = json.loads((VECTORS / file).read_text())["vectors"]
    lines: list[str] = vectors[0]["lines"]
    return lines


TD1 = icao_lines("icao-td1.json")
TD2 = icao_lines("icao-td2.json")
TD3 = icao_lines("icao-td3.json")
VIZ = [Placed("UTOPIA", 36, 19, size=46), Placed("ERIKSSON", 372, 156)]

NOT_FOUND: dict[str, Any] = {
    "found": False,
    "format_guess": None,
    "lines": [],
    "line_confidences": [],
    "box": None,
}


# --- localisation ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("lines", "count"), [(TD1, 3), (TD2, 2), (TD3, 2)], ids=["TD1", "TD2", "TD3"]
)
def test_finds_each_line_of_the_zone_top_to_bottom(lines: list[str], count: int) -> None:
    document = render_mrz_document(lines, viz=VIZ)
    height, width = document.shape[:2]

    regions = find_mrz_lines(document)

    assert len(regions) == count
    tops = [region.box[1] for region in regions]
    assert tops == sorted(tops)
    for region in regions:
        _, y, w, h = region.box
        assert y >= height / 2  # the lower part of the document
        assert w >= 0.8 * width  # an MRZ line spans about 88% of the width
        assert 10 <= h <= 60


@pytest.mark.parametrize("scale", [0.6, 1.56])
def test_finds_the_zone_at_other_resolutions(scale: float) -> None:
    document = render_mrz_document(TD1, viz=VIZ)
    resized = cv2.resize(document, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)

    assert len(find_mrz_lines(np.asarray(resized, dtype=np.uint8))) == 3


def test_finds_a_slightly_skewed_zone() -> None:
    document = render_mrz_document(TD3, viz=VIZ)
    height, width = document.shape[:2]
    turn = cv2.getRotationMatrix2D((width / 2, height / 2), 2.0, 1.0)
    skewed = cv2.warpAffine(document, turn, (width, height), borderMode=cv2.BORDER_REPLICATE)

    regions = find_mrz_lines(np.asarray(skewed, dtype=np.uint8))

    assert len(regions) == 2
    for region in regions:  # each crop follows its line's slope
        top_left, top_right = region.quad[0], region.quad[1]
        slope = (top_right[1] - top_left[1]) / (top_right[0] - top_left[0])
        assert slope == pytest.approx(-np.tan(np.radians(2.0)), abs=0.01)


def test_the_zone_is_the_lowest_three_of_four_stacked_lines() -> None:
    four = render_mrz_document([*TD1, TD1[2]], first_line_mm=21.0)
    height = four.shape[0]

    regions = find_mrz_lines(four)

    # Line tops at 21, 16.4, 11.8 and 7.2 mm from the bottom edge; the zone keeps the last three.
    assert len(regions) == 3
    from_bottom_mm = [(height - region.box[1]) / PX_PER_MM for region in regions]
    assert from_bottom_mm == pytest.approx([16.4, 11.8, 7.2], abs=1.0)


def test_a_long_visual_line_far_above_the_zone_is_left_out() -> None:
    document = render_mrz_document(TD3, viz=[Placed("X" * 50, 100, 560)])

    regions = find_mrz_lines(document)

    assert len(regions) == 2
    assert all(region.box[1] > 800 for region in regions)


def test_a_document_without_a_zone_has_no_lines() -> None:
    visual_only = render_lines(
        [Placed("Surname", 372, 132, size=20), Placed("ERIKSSON", 372, 156)]
        + [Placed("1 HARBOUR LANE, UTOPIA CITY", 40, 450 + 50 * i) for i in range(3)]
    )

    assert find_mrz_lines(visual_only) == []


def test_a_single_long_line_is_not_a_zone() -> None:
    banner = render_mrz_document([TD1[0]])

    assert find_mrz_lines(banner) == []


def test_a_blank_image_has_no_lines() -> None:
    assert find_mrz_lines(np.full((648, 1027, 3), 230, dtype=np.uint8)) == []


# --- format_guess ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("lines", "expected"),
    [
        (TD1, "TD1"),
        (TD2, "TD2"),
        (TD3, "TD3"),
        (["V" + TD3[0][1:], TD3[1]], "MRVA"),
        (["V" + TD2[0][1:], TD2[1]], "MRVB"),
        ([TD1[0][:-2], TD1[1], TD1[2] + "<<"], "TD1"),  # within two characters
        ([TD3[0][:-3], TD3[1]], None),
        ([TD3[0][:40], TD3[1][:40]], None),
        (TD1[:2], None),
        ([*TD3, TD3[1]], None),
        ([], None),
    ],
    ids=[
        "td1",
        "td2",
        "td3",
        "mrv-a",
        "mrv-b",
        "td1-misread-length",
        "too-short",
        "between-layouts",
        "td1-missing-a-line",
        "too-many-lines",
        "none",
    ],
)
def test_the_format_follows_the_line_count_length_and_document_code(
    lines: list[str], expected: MrzFormat | None
) -> None:
    assert guess_format(lines) == expected


# --- locate_mrz, with a fake line reader ----------------------------------------------------


class FakeReader(OcrEngine):
    """An engine whose line reader returns the given readings, recording what it was asked."""

    def __init__(self, readings: Sequence[Reading], *, available: bool = True) -> None:
        super().__init__(_Unused(), _Unused(), _Unused())
        self.readings = list(readings)
        self.available = available
        self.calls: list[tuple[int, str | None]] = []

    def load(self) -> bool:
        return self.available

    def recognize(
        self, images: Sequence[ImageArray], *, alphabet: str | None = None
    ) -> list[Reading]:
        self.calls.append((len(images), alphabet))
        assert all(image.ndim == 3 and image.shape[0] > 0 for image in images)
        return self.readings[: len(images)]


class _Unused:
    def load(self) -> Any:
        raise AssertionError("not used")

    def run(self, batch: Any) -> Any:
        raise AssertionError("not used")


def test_without_the_text_models_no_zone_is_reported(tmp_path: Path) -> None:
    settings = Settings.model_validate({"service_token": "s" * 40, "models_dir": tmp_path})

    reading = locate_mrz(render_mrz_document(TD1), OcrEngine.from_settings(settings))

    assert reading.model_dump(mode="json") == NOT_FOUND


def test_reads_each_line_with_the_mrz_alphabet() -> None:
    document = render_mrz_document(TD1, viz=VIZ)
    reader = FakeReader([Reading(line, 0.97) for line in TD1])

    reading = locate_mrz(document, reader)

    assert reader.calls == [(3, MRZ_ALPHABET)]
    assert reading.found is True
    assert reading.lines == TD1
    assert reading.line_confidences == [0.97, 0.97, 0.97]
    assert reading.format_guess == "TD1"
    regions = find_mrz_lines(document)
    x, y, w, h = reading.box or (0.0, 0.0, 0.0, 0.0)
    assert x == min(region.box[0] for region in regions)
    assert y == regions[0].box[1]
    assert y + h == pytest.approx(regions[-1].box[1] + regions[-1].box[3])
    assert w >= max(region.box[2] for region in regions)


def test_a_line_read_as_nothing_is_left_out() -> None:
    reader = FakeReader([Reading(TD1[0], 0.9), Reading("", 0.0), Reading(TD1[2], 0.8)])

    reading = locate_mrz(render_mrz_document(TD1), reader)

    assert reading.found is True
    assert reading.lines == [TD1[0], TD1[2]]
    assert reading.line_confidences == [0.9, 0.8]
    assert reading.format_guess is None  # two lines of 30 match no layout


def test_fewer_than_two_lines_read_is_no_zone() -> None:
    reader = FakeReader([Reading("", 0.0), Reading("", 0.0), Reading(TD1[2], 0.8)])

    assert locate_mrz(render_mrz_document(TD1), reader).model_dump(mode="json") == NOT_FOUND


def test_a_line_longer_than_the_contract_allows_is_cut() -> None:
    reader = FakeReader([Reading("A" * 70, 0.9), Reading("B" * 70, 0.9)])

    reading = locate_mrz(render_mrz_document(TD3), reader)

    assert [len(line) for line in reading.lines] == [MAX_MRZ_LINE_LENGTH] * 2


def test_no_zone_reads_nothing() -> None:
    reader = FakeReader([])

    reading = locate_mrz(np.full((648, 1027, 3), 230, dtype=np.uint8), reader)

    assert reading.model_dump(mode="json") == NOT_FOUND
    assert reader.calls == []
