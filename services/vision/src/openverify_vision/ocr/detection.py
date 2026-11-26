# Derived from RapidOCR v3.10.0 (https://github.com/RapidAI/RapidOCR, tag v3.10.0, commit
# bd941dae09da793e76c6ba15c7aaf40f8424232a): python/rapidocr/ch_ppocr_det/main.py
# (TextDetector, sorted_boxes), python/rapidocr/ch_ppocr_det/utils.py (DetPreProcess,
# DBPostProcess) and python/rapidocr/utils/process_img.py (resize_image_within_bounds,
# map_boxes_to_original); the defaults are those of python/rapidocr/config.yaml.
# Copyright (c) 2021 RapidOCR Authors. Copyright (c) 2020 PaddlePaddle Authors.
# Licensed under the Apache License, Version 2.0 (http://www.apache.org/licenses/LICENSE-2.0);
# see services/vision/NOTICE.
#
# Changed by the OpenVerify authors: rewritten as typed functions; the input is normalised with
# the mean and standard deviation of the model's own inference.yml; a side never rounds to
# zero; the two size bounds compose their ratios; boxes go back to source pixels before
# cropping; no text-line padding or angle classification (rectified documents are upright); the
# detector input's longer side is capped at max_side_len and it is normalised in float32.
"""Text detection: the DB model's pre-processing and box post-processing."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal

import cv2
import numpy as np
from numpy.typing import NDArray

from openverify_vision.imaging import ImageArray, ensure_bgr
from openverify_vision.ocr.geometry import Quad, mini_box, order_points_clockwise, unclip
from openverify_vision.ocr.runtime import InferenceModel

DETECTION_MEAN: Final = (0.485, 0.456, 0.406)
DETECTION_STD: Final = (0.229, 0.224, 0.225)
"""``NormalizeImage`` of the detector's ``inference.yml`` (PaddleX), per BGR channel."""

MIN_BOX_SIDE: Final = 3
"""Contours whose minimum-area box has a shorter side under this many map pixels are noise."""

SIZE_MULTIPLE: Final = 32
"""The detector's input sides are multiples of this."""

LINE_Y_TOLERANCE: Final = 10
"""Boxes whose top-left corners differ by less than this many pixels share a reading line."""

_DILATION_KERNEL: Final = np.ones((2, 2), dtype=np.uint8)


@dataclass(frozen=True, slots=True)
class DetectionParams:
    """Detector settings; the defaults are RapidOCR v3.10.0's (``config.yaml``)."""

    limit_side_len: int = 736
    """Scale the shorter (``min``) or longer (``max``) side to this length."""
    limit_type: Literal["min", "max"] = "min"
    thresh: float = 0.3
    """Probability over which a map pixel is text."""
    box_thresh: float = 0.5
    """Mean probability inside a box under which the box is dropped."""
    max_candidates: int = 1000
    unclip_ratio: float = 1.6
    use_dilation: bool = True
    min_side_len: int = 30
    max_side_len: int = 2000
    """Bounds on the image sides before detection (RapidOCR's ``Global`` settings)."""


def _resize_to_multiple(img: ImageArray, ratio: float) -> tuple[ImageArray, float, float]:
    height, width = img.shape[:2]
    resized_h = max(SIZE_MULTIPLE, round(int(height * ratio) / SIZE_MULTIPLE) * SIZE_MULTIPLE)
    resized_w = max(SIZE_MULTIPLE, round(int(width * ratio) / SIZE_MULTIPLE) * SIZE_MULTIPLE)
    resized = np.asarray(cv2.resize(img, (resized_w, resized_h)), dtype=np.uint8)
    return resized, height / resized_h, width / resized_w


def bound_side_lengths(
    img: ImageArray, *, min_side: int, max_side: int
) -> tuple[ImageArray, float, float]:
    """``img`` resized (to multiples of 32) so its longer side is at most ``max_side`` and its
    shorter side at least ``min_side``, with the height and width ratios from the result back
    to ``img``. An image already within the bounds is returned as it is."""
    ratio_h = ratio_w = 1.0
    height, width = img.shape[:2]
    if max(height, width) > max_side:
        img, ratio_h, ratio_w = _resize_to_multiple(img, max_side / max(height, width))
    height, width = img.shape[:2]
    if min(height, width) < min_side:
        img, more_h, more_w = _resize_to_multiple(img, min_side / min(height, width))
        ratio_h, ratio_w = ratio_h * more_h, ratio_w * more_w
    return img, ratio_h, ratio_w


def detection_input(img: ImageArray, params: DetectionParams) -> NDArray[np.float32] | None:
    """The normalised ``(1, 3, H, W)`` batch the detector reads: the shorter (or longer) side
    scaled to ``limit_side_len``, the longer side never over ``max_side_len``, and both sides
    rounded to multiples of 32. ``None`` when a side rounds to nothing.

    The ``max_side_len`` cap is the OpenVerify authors' (Workflow 3B review G010): scaling the
    shorter side of an elongated image up to 736 made inputs of tens of megapixels."""
    height, width = img.shape[:2]
    if params.limit_type == "max":
        longer = max(height, width)
        ratio = params.limit_side_len / longer if longer > params.limit_side_len else 1.0
    else:
        shorter = min(height, width)
        ratio = params.limit_side_len / shorter if shorter < params.limit_side_len else 1.0
    ratio = min(ratio, params.max_side_len / max(height, width))
    resized_h = round(int(height * ratio) / SIZE_MULTIPLE) * SIZE_MULTIPLE
    resized_w = round(int(width * ratio) / SIZE_MULTIPLE) * SIZE_MULTIPLE
    if resized_h <= 0 or resized_w <= 0:
        return None
    # In place in float32: float64 statistics would double the map and copy it twice (G010).
    resized = cv2.resize(img, (resized_w, resized_h)).astype(np.float32)
    resized /= 255.0
    resized -= np.asarray(DETECTION_MEAN, dtype=np.float32)
    resized /= np.asarray(DETECTION_STD, dtype=np.float32)
    return np.ascontiguousarray(resized.transpose(2, 0, 1)[None], dtype=np.float32)


def _box_score(prob: NDArray[np.float32], box: Quad) -> float:
    """Mean probability inside ``box`` (RapidOCR's ``box_score_fast``)."""
    height, width = prob.shape
    x_min = int(np.clip(np.floor(box[:, 0].min()), 0, width - 1))
    x_max = int(np.clip(np.ceil(box[:, 0].max()), 0, width - 1))
    y_min = int(np.clip(np.floor(box[:, 1].min()), 0, height - 1))
    y_max = int(np.clip(np.ceil(box[:, 1].max()), 0, height - 1))
    mask = np.zeros((y_max - y_min + 1, x_max - x_min + 1), dtype=np.uint8)
    shifted = box - np.array([x_min, y_min], dtype=np.float32)
    cv2.fillPoly(mask, [shifted.astype(np.int32)], 1)
    return float(cv2.mean(prob[y_min : y_max + 1, x_min : x_max + 1], mask)[0])


def boxes_from_probability_map(
    prob: NDArray[np.float32], *, width: int, height: int, params: DetectionParams
) -> list[tuple[Quad, float]]:
    """Text boxes of a DB probability map with their scores, in ``width`` x ``height`` pixels
    (the image the map was computed for), clockwise from the top left."""
    bitmap = (prob > params.thresh).astype(np.uint8)
    if params.use_dilation:
        bitmap = np.asarray(cv2.dilate(bitmap, _DILATION_KERNEL), dtype=np.uint8)
    map_h, map_w = bitmap.shape
    contours, _ = cv2.findContours(bitmap * 255, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

    found: list[tuple[Quad, float]] = []
    for contour in contours[: params.max_candidates]:
        points, short_side = mini_box(contour)
        if short_side < MIN_BOX_SIDE:
            continue
        score = _box_score(prob, points)
        if params.box_thresh > score:
            continue
        grown, short_side = mini_box(unclip(points, params.unclip_ratio))
        if short_side < MIN_BOX_SIDE + 2:
            continue
        grown[:, 0] = np.clip(np.round(grown[:, 0] / map_w * width), 0, width)
        grown[:, 1] = np.clip(np.round(grown[:, 1] / map_h * height), 0, height)
        quad = order_points_clockwise(grown.astype(np.int32).astype(np.float32))
        quad[:, 0] = np.clip(quad[:, 0], 0, width - 1).astype(np.int32)
        quad[:, 1] = np.clip(quad[:, 1], 0, height - 1).astype(np.int32)
        if (
            int(np.linalg.norm(quad[0] - quad[1])) <= MIN_BOX_SIDE
            or int(np.linalg.norm(quad[0] - quad[3])) <= MIN_BOX_SIDE
        ):
            continue
        found.append((quad, score))
    return found


def sort_boxes(quads: list[Quad]) -> list[Quad]:
    """``quads`` in reading order: by the top-left corner's y, grouped into lines where it moves
    by less than :data:`LINE_Y_TOLERANCE`, then by x within each line."""
    if not quads:
        return []
    stacked = np.stack(quads)
    by_y = np.argsort(stacked[:, 0, 1], kind="stable")
    ys = stacked[by_y, 0, 1]
    line_ids = np.concatenate([[0], np.cumsum(np.diff(ys) >= LINE_Y_TOLERANCE)])
    order = by_y[np.lexsort((stacked[by_y, 0, 0], line_ids))]
    return [quads[int(i)] for i in order]


def detect_text(img: ImageArray, model: InferenceModel, params: DetectionParams) -> list[Quad]:
    """Every text line of ``img`` as a quad in its pixels, in reading order."""
    bgr = ensure_bgr(img)
    bounded, ratio_h, ratio_w = bound_side_lengths(
        bgr, min_side=params.min_side_len, max_side=params.max_side_len
    )
    batch = detection_input(bounded, params)
    if batch is None:
        return []
    prob = model.run(batch)
    bounded_h, bounded_w = bounded.shape[:2]
    boxes = boxes_from_probability_map(prob[0, 0], width=bounded_w, height=bounded_h, params=params)
    height, width = bgr.shape[:2]
    quads = []
    for quad in sort_boxes([quad for quad, _ in boxes]):
        source = quad * np.array([ratio_w, ratio_h], dtype=np.float32)
        source[:, 0] = np.clip(source[:, 0], 0, width)
        source[:, 1] = np.clip(source[:, 1], 0, height)
        quads.append(source)
    return quads
