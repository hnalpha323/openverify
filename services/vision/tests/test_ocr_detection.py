"""``ocr/detection.py``: RapidOCR's DB detection pre- and post-processing, on fake models.

The arithmetic follows RapidOCR v3.10.0 (``ch_ppocr_det`` and ``utils/process_img.py``): bound
the sides (30 to 2000 pixels, multiples of 32), scale the shorter side up to 736, normalise,
then threshold the probability map, take each contour's minimum-area box, score it on the map,
unclip it and scale it back to the image.
"""

from __future__ import annotations

import tracemalloc

import numpy as np
import pytest
from numpy.typing import NDArray

from openverify_vision.ocr.detection import (
    DETECTION_MEAN,
    DETECTION_STD,
    DetectionParams,
    bound_side_lengths,
    boxes_from_probability_map,
    detect_text,
    detection_input,
    sort_boxes,
)

PARAMS = DetectionParams()


def blank(height: int, width: int) -> NDArray[np.uint8]:
    return np.zeros((height, width, 3), dtype=np.uint8)


# --- pre-processing -------------------------------------------------------------------------


def test_an_image_within_the_bounds_is_kept() -> None:
    img = blank(648, 1027)

    bounded, ratio_h, ratio_w = bound_side_lengths(img, min_side=30, max_side=2000)

    assert bounded is img
    assert (ratio_h, ratio_w) == (1.0, 1.0)


def test_a_long_side_over_the_bound_is_reduced_to_multiples_of_32() -> None:
    bounded, ratio_h, ratio_w = bound_side_lengths(blank(100, 4000), min_side=30, max_side=2000)

    # 0.5 x (100, 4000) = (50, 2000), rounded to multiples of 32: (64, 1984).
    assert bounded.shape == (64, 1984, 3)
    assert (ratio_h, ratio_w) == pytest.approx((100 / 64, 4000 / 1984))


def test_a_short_side_under_the_bound_is_enlarged() -> None:
    bounded, ratio_h, ratio_w = bound_side_lengths(blank(20, 200), min_side=30, max_side=2000)

    # 1.5 x (20, 200) = (30, 300), rounded to multiples of 32: (32, 288).
    assert bounded.shape == (32, 288, 3)
    assert (ratio_h, ratio_w) == pytest.approx((20 / 32, 200 / 288))


def test_the_detector_input_scales_the_shorter_side_to_736() -> None:
    img = np.full((648, 1027, 3), 255, dtype=np.uint8)
    img[0, 0] = (0, 0, 0)

    batch = detection_input(img, PARAMS)

    assert batch is not None
    # 736 / 648 x 1027 = 1166, rounded to a multiple of 32: 1152.
    assert batch.shape == (1, 3, 736, 1152)
    assert batch.dtype == np.float32
    white = (1.0 - np.asarray(DETECTION_MEAN)) / np.asarray(DETECTION_STD)
    assert batch[0, :, 400, 600] == pytest.approx(white, rel=1e-5)
    assert batch[0, :, 0, 0] == pytest.approx(-np.asarray(DETECTION_MEAN) / DETECTION_STD, rel=1e-5)


def test_the_detector_input_can_cap_the_longer_side() -> None:
    params = DetectionParams(limit_side_len=960, limit_type="max")

    batch = detection_input(blank(1000, 2000), params)

    assert batch is not None
    assert batch.shape == (1, 3, 480, 960)


def test_an_image_that_rounds_to_nothing_has_no_detector_input() -> None:
    params = DetectionParams(limit_side_len=960, limit_type="max")

    assert detection_input(blank(1, 100), params) is None


def test_the_detector_input_is_normalised_in_float32() -> None:
    """G010 (Workflow 3B review): no float64 copy of the map is ever held. Normalising with
    float64 mean and standard deviation arrays doubled the map and copied it twice (a peak of
    five float32 maps); in place in float32 the peak is the map and the batch it is copied to."""
    img = np.full((736, 736, 3), 200, dtype=np.uint8)

    tracemalloc.start()
    try:
        batch = detection_input(img, PARAMS)
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()

    assert batch is not None
    assert batch.dtype == np.float32
    assert peak <= 3 * batch.nbytes


# --- post-processing ------------------------------------------------------------------------


def probability_map(
    height: int, width: int, *blobs: tuple[int, int, int, int, float]
) -> NDArray[np.float32]:
    prob = np.zeros((height, width), dtype=np.float32)
    for x, y, w, h, value in blobs:
        prob[y : y + h, x : x + w] = value
    return prob


def test_one_text_blob_is_one_box_grown_by_the_unclip_distance() -> None:
    prob = probability_map(100, 200, (50, 40, 100, 20, 0.9))

    ((quad, score),) = boxes_from_probability_map(prob, width=200, height=100, params=PARAMS)

    # The score is the mean over the box of the dilated bitmap, 101 x 21 pixels around the
    # 100 x 20 blob of 0.9 (RapidOCR's box_score_fast).
    assert score == pytest.approx(0.9 * (100 * 20) / (101 * 21), abs=1e-3)
    # The 2x2 dilation grows the 100 x 20 blob to about 101 x 21, then unclip adds
    # area * 1.6 / perimeter (about 13.5 px) on every side.
    xs, ys = quad[:, 0], quad[:, 1]
    assert xs.min() == pytest.approx(50 - 13.5, abs=2)
    assert xs.max() == pytest.approx(150 + 13.5, abs=2)
    assert ys.min() == pytest.approx(40 - 13.5, abs=2)
    assert ys.max() == pytest.approx(60 + 13.5, abs=2)
    assert quad.tolist()[0] == [xs.min(), ys.min()]  # clockwise from the top left


def test_boxes_are_scaled_to_the_destination_size() -> None:
    prob = probability_map(100, 200, (50, 40, 100, 20, 0.9))

    ((small, _),) = boxes_from_probability_map(prob, width=200, height=100, params=PARAMS)
    ((large, _),) = boxes_from_probability_map(prob, width=400, height=200, params=PARAMS)

    assert large == pytest.approx(small * 2, abs=2)


def test_boxes_are_clipped_to_the_image() -> None:
    prob = probability_map(100, 200, (0, 0, 120, 20, 0.9))

    ((quad, _),) = boxes_from_probability_map(prob, width=200, height=100, params=PARAMS)

    assert quad.min() >= 0
    assert quad[:, 0].max() <= 199
    assert quad[:, 1].max() <= 99


def test_a_blob_scoring_under_the_box_threshold_is_dropped() -> None:
    prob = probability_map(100, 200, (50, 40, 100, 20, 0.4))  # over thresh 0.3, under 0.5

    assert boxes_from_probability_map(prob, width=200, height=100, params=PARAMS) == []


def test_a_blob_smaller_than_the_minimum_size_is_dropped() -> None:
    prob = probability_map(100, 200, (50, 40, 1, 1, 0.9))

    assert boxes_from_probability_map(prob, width=200, height=100, params=PARAMS) == []


def test_at_most_max_candidates_contours_are_considered() -> None:
    prob = probability_map(100, 200, (10, 10, 60, 15, 0.9), (10, 60, 60, 15, 0.9))
    params = DetectionParams(max_candidates=1)

    assert len(boxes_from_probability_map(prob, width=200, height=100, params=params)) == 1


def test_an_empty_map_has_no_boxes() -> None:
    prob = probability_map(64, 64)

    assert boxes_from_probability_map(prob, width=64, height=64, params=PARAMS) == []


def quad_at(x: float, y: float) -> NDArray[np.float32]:
    return np.array([[x, y], [x + 50, y], [x + 50, y + 10], [x, y + 10]], dtype=np.float32)


def test_boxes_sort_into_lines_top_to_bottom_then_left_to_right() -> None:
    right, left, below = quad_at(300, 102), quad_at(10, 100), quad_at(10, 150)

    ordered = sort_boxes([below, right, left])

    assert [q[0].tolist() for q in ordered] == [[10, 100], [300, 102], [10, 150]]


def test_sort_boxes_of_nothing_is_nothing() -> None:
    assert sort_boxes([]) == []


# --- the whole detector, on a fake model ----------------------------------------------------


class MapModel:
    """Returns a probability map that is 0.95 on the given image-relative rectangles."""

    def __init__(self, *regions: tuple[float, float, float, float]) -> None:
        self.regions = regions
        self.inputs: list[tuple[int, ...]] = []

    def load(self) -> None:
        pass

    def run(self, batch: NDArray[np.float32]) -> NDArray[np.float32]:
        self.inputs.append(batch.shape)
        _, _, height, width = batch.shape
        prob = np.zeros((1, 1, height, width), dtype=np.float32)
        for rx, ry, rw, rh in self.regions:
            x0, y0 = round(rx * width), round(ry * height)
            prob[0, 0, y0 : y0 + round(rh * height), x0 : x0 + round(rw * width)] = 0.95
        return prob


def unclipped_span(
    start: int, length: int, across: int, scale: float, ratio: float = 1.6
) -> tuple[float, float]:
    """Where a map blob ``[start, start + length]`` ends up on one axis: grown by the unclip
    distance of its ``length`` x ``across`` box, then scaled to image pixels."""
    distance = length * across * ratio / (2 * (length + across))
    return (start - distance) * scale, (start + length + distance) * scale


def test_detect_text_maps_boxes_back_to_the_image() -> None:
    img = blank(648, 1027)
    model = MapModel((100 / 1027, 200 / 648, 300 / 1027, 40 / 648))

    (quad,) = detect_text(img, model, PARAMS)

    assert model.inputs == [(1, 3, 736, 1152)]
    # The blob as MapModel draws it on the 1152 x 736 map, one pixel wider after dilation.
    x0, w = round(100 / 1027 * 1152), round(300 / 1027 * 1152)
    y0, h = round(200 / 648 * 736), round(40 / 648 * 736)
    left, right = unclipped_span(x0, w, h, 1027 / 1152)
    top, bottom = unclipped_span(y0, h, w, 648 / 736)
    assert quad[:, 0].min() == pytest.approx(left, abs=2)
    assert quad[:, 0].max() == pytest.approx(right, abs=2)
    assert quad[:, 1].min() == pytest.approx(top, abs=2)
    assert quad[:, 1].max() == pytest.approx(bottom, abs=2)


def test_detect_text_bounds_a_huge_image_first() -> None:
    model = MapModel((0.1, 0.1, 0.5, 0.05))

    (quad,) = detect_text(blank(3000, 4000), model, PARAMS)

    # Halved to 1500 x 2000, rounded to multiples of 32 (Python rounds 62.5 to 62).
    assert model.inputs == [(1, 3, 1504, 1984)]
    x0, w, h = round(0.1 * 1984), round(0.5 * 1984), round(0.05 * 1504)
    left, right = unclipped_span(x0, w, h, 4000 / 1984)  # back in source pixels
    assert quad[:, 0].min() == pytest.approx(left, abs=3)
    assert quad[:, 0].max() == pytest.approx(right, abs=3)


def test_detect_text_reads_lines_in_order() -> None:
    model = MapModel((0.5, 0.1, 0.3, 0.05), (0.1, 0.1, 0.3, 0.05), (0.1, 0.5, 0.3, 0.05))

    quads = detect_text(blank(648, 1027), model, PARAMS)

    starts = [(round(float(q[0, 0]), -1), round(float(q[0, 1]), -1)) for q in quads]
    assert [x for x, _ in starts][:2] == sorted(x for x, _ in starts[:2])
    assert starts[2][1] > starts[0][1]


@pytest.mark.parametrize(
    ("height", "width", "inputs"),
    [
        # Bounded to 32 x 1984, then the shorter side scaled to 736 made 736 x 45,632 (33.6 Mpx).
        (30, 4000, [(1, 3, 32, 1984)]),
        (5000, 1, [(1, 3, 1984, 32)]),
        # Bounded to 32 x 5632 (the shorter side enlarged), then 736 x 129,536 (95.3 Mpx); capped
        # to the longer side's 2000 pixels the 32 rows round to nothing: no text, and no error.
        (8, 1500, []),
    ],
    ids=["4000x30", "1x5000", "1500x8"],
)
def test_an_elongated_upload_never_makes_a_detector_input_over_the_side_bound(
    height: int, width: int, inputs: list[tuple[int, ...]]
) -> None:
    """G010 (Workflow 3B review): a few-hundred-byte elongated upload made a detector input of
    tens of megapixels (gigabytes, seconds to minutes); the longer side stays within 2000."""
    model = MapModel()

    detect_text(blank(height, width), model, PARAMS)

    assert model.inputs == inputs
    assert all(max(shape[2:]) <= PARAMS.max_side_len for shape in model.inputs)


def test_detect_text_of_an_image_with_no_input_is_nothing() -> None:
    params = DetectionParams(limit_side_len=960, limit_type="max", min_side_len=1)

    assert detect_text(blank(1, 100), MapModel(), params) == []


# --- pinned after GREEN: the remaining branches of the post-processing ----------------------


def test_without_dilation_the_box_scores_the_blob_alone() -> None:
    prob = probability_map(100, 200, (50, 40, 100, 20, 0.9))
    params = DetectionParams(use_dilation=False)

    ((_, score),) = boxes_from_probability_map(prob, width=200, height=100, params=params)

    assert score == pytest.approx(0.9, abs=1e-3)


def test_a_box_still_thin_after_unclip_is_dropped() -> None:
    prob = probability_map(100, 200, (50, 40, 100, 3, 0.9))
    params = DetectionParams(unclip_ratio=0.1)  # grows a 3-pixel line by well under a pixel

    assert boxes_from_probability_map(prob, width=200, height=100, params=params) == []


def test_a_box_that_shrinks_to_a_few_image_pixels_is_dropped() -> None:
    prob = probability_map(100, 200, (50, 40, 100, 20, 0.9))

    # A 100 x 20 blob is about 127 x 47 after unclip; 5 / 100 of 47 rows is 2 image pixels.
    assert boxes_from_probability_map(prob, width=200, height=5, params=PARAMS) == []
