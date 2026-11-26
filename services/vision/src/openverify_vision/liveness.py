# Derived from Silent-Face-Anti-Spoofing
# (https://github.com/minivision-ai/Silent-Face-Anti-Spoofing, commit
# b6d5f04ad78778917853b25c778acef6d5626d15): src/generate_patches.py
# (CropImage._get_new_box, CropImage.crop), src/data_io/functional.py (to_tensor), and
# src/anti_spoof_predict.py and test.py (the softmax and the fusion of the two models).
# Copyright 2020 Minivision.
# Licensed under the Apache License, Version 2.0 (http://www.apache.org/licenses/LICENSE-2.0);
# see services/vision/NOTICE.
#
# Changed by the OpenVerify authors: rewritten with NumPy and OpenCV and type hints, without
# PyTorch; the models run as ONNX, the 3:4 frame upstream requires is not, and the effective crop
# scales are reported. ``upstream_box`` (the YuNet box transform) and the engine are new.
"""Passive liveness: the MiniFASNetV2 + V1SE ensemble (C41.1, research §3).

Vision measures P(real) per model; the ``selfie_liveness_detection`` evaluator (TypeScript)
decides. The models are the pinned ONNX re-exports of Minivision's Apache-2.0 checkpoints
(``models/manifest.json``; their training data is undisclosed, ``THIRD_PARTY_LICENSES.md``).

**Upstream's preprocessing, reimplemented exactly** (minivision-ai/Silent-Face-Anti-Spoofing at
b6d5f04: ``test.py``, ``src/generate_patches.py``, ``src/anti_spoof_predict.py``,
``src/data_io/functional.py``); ``tests/test_liveness.py`` checks it against outputs recorded
from that code:

1. :func:`crop_box` is ``CropImage._get_new_box``: the scale is clipped to
   ``min((H - 1) / h, (W - 1) / w, scale)``, a box of ``w * scale`` x ``h * scale`` is centred on
   the face box, and when it overflows an image edge it is **shifted back inside, keeping its
   size** (never clamped); the corners are truncated to integers.
2. :func:`crop_patch` cuts ``image[top : bottom + 1, left : right + 1]`` and resizes it to
   80 x 80 with ``cv2.resize``'s default (bilinear); the aspect ratio is not kept.
3. :func:`to_input` keeps the pixels **BGR, raw 0-255** (upstream's ``to_tensor`` does not divide
   by 255), as float32 NCHW.
4. Each model's 3 logits go through a softmax; **class 1 is real**. The ensemble's score is the
   mean of the two P(real), upstream's fused value for label 1 (the sum of the two softmax
   vectors, over 2). V2 sees the box at scale 2.7, V1SE at 4.0 (from the checkpoint names).

Upstream also requires a 3:4 portrait frame (its Android preview); OpenVerify does not, and
reports the **effective scales** instead: at normal selfie framing the 4.0 crop does not fit and
is clipped (research §3 measured 2.2 to 2.8), so V1SE rarely sees its trained context.

**The YuNet box transform** (:func:`upstream_box`). Upstream crops around its own detector's box
(``Widerface-RetinaFace.caffemodel``), which is near-square and starts lower than YuNet's. Measured
on 2026-10-21 on 18 framings (the three public-domain faces of ``fixtures/manifest.json``, as
640 x 480 and 480 x 640 frames with the face at 30, 40 and 50% of the frame height), relative to
YuNet's box height ``h``, upstream's box has its top 0.117 h lower (median; range 0.071 to
0.152), its height 0.875 h (0.81 to 0.951), its width 0.842 h (0.78 to 0.921), its horizontal
centre 0.009 h to the right (-0.014 to 0.036) and its bottom 0.018 h higher (-0.044 to 0.026). The
transform keeps YuNet's bottom edge and horizontal centre and takes a box 0.84 h wide and
0.88 h tall. It is geometry, not a threshold: it moves the crop toward the one the models were
trained on, and is provisional like every selfie default.

What this does not do (research §3): it scores digitally injected frames and synthetic
moire, print and compression as real; it is no defence against virtual cameras, deepfakes,
bezel-less replays or 3-D masks; it is unvalidated on turned faces, so the side poses' scores
are recorded, not judged (plan decision 19).
"""

from __future__ import annotations

import logging
import math
import threading
from pathlib import Path
from typing import TYPE_CHECKING, Final

import cv2
import numpy as np
from numpy.typing import NDArray

from openverify_vision.faces import Face, ModelNotAvailableError
from openverify_vision.imaging import ImageArray, ensure_bgr
from openverify_vision.inference import InferenceError
from openverify_vision.ocr.runtime import InferenceModel, OnnxModel
from openverify_vision.schemas import EffectiveScales, PassiveLiveness

if TYPE_CHECKING:
    from openverify_vision.settings import Settings

ANTI_SPOOF_V2_FILENAME: Final = "MiniFASNetV2.onnx"
ANTI_SPOOF_V1SE_FILENAME: Final = "MiniFASNetV1SE.onnx"
"""Must match the ``anti_spoof_minifasnet_*`` entries in ``models/manifest.json``."""

ANTI_SPOOF_V2_VERSION: Final = "minifasnet-v2-2.7"
ANTI_SPOOF_V1SE_VERSION: Final = "minifasnet-v1se-4.0"
"""Reported as ``model_versions.anti_spoof_v2`` and ``anti_spoof_v1se``."""

V2_SCALE: Final = 2.7
V1SE_SCALE: Final = 4.0
"""The crop scales upstream parses from the checkpoint names (``2.7_80x80_MiniFASNetV2.pth``,
``4_0_0_80x80_MiniFASNetV1SE.pth``)."""

INPUT_SIZE: Final = 80
REAL_CLASS: Final = 1
_CLASSES: Final = 3

BOX_TOP_SHIFT: Final = 0.12
BOX_HEIGHT_SHARE: Final = 0.88
BOX_WIDTH_SHARE: Final = 0.84
"""The YuNet box transform (see the module docstring), as shares of the YuNet box height."""

_PROBABILITY_DECIMALS: Final = 4
_SCALE_DECIMALS: Final = 3

IntBox = tuple[int, int, int, int]
"""``(x, y, width, height)`` in whole pixels, as upstream's detector reports a face."""

Corners = tuple[int, int, int, int]
"""``(left, top, right, bottom)``, inclusive pixel coordinates of a crop."""

logger = logging.getLogger(__name__)


def upstream_box(face: Face) -> IntBox | None:
    """YuNet's face box moved toward upstream's detector box: the same bottom edge and
    horizontal centre, :data:`BOX_HEIGHT_SHARE` of the height tall and :data:`BOX_WIDTH_SHARE`
    of the height wide. The corner is floored and the size rounded (at least one pixel), as whole
    pixels like upstream's box. ``None`` for a degenerate box."""
    x, y, w, h = face.box
    if not all(math.isfinite(value) for value in face.box) or w <= 0 or h <= 0:
        return None
    width, height = BOX_WIDTH_SHARE * h, BOX_HEIGHT_SHARE * h
    left = x + w / 2 - width / 2
    top = y + h - height
    return (math.floor(left), math.floor(top), max(1, round(width)), max(1, round(height)))


def crop_box(src_w: int, src_h: int, bbox: IntBox, scale: float) -> tuple[Corners, float]:
    """Upstream's ``CropImage._get_new_box``: the crop's corners in a ``src_w`` x ``src_h`` image
    and the scale actually used (clipped so the crop fits). See the module docstring."""
    x, y, box_w, box_h = bbox
    if box_w <= 0 or box_h <= 0 or src_w <= 0 or src_h <= 0:
        raise ValueError("the box and the image need a positive width and height")
    scale = min((src_h - 1) / box_h, (src_w - 1) / box_w, scale)
    new_width, new_height = box_w * scale, box_h * scale
    center_x, center_y = box_w / 2 + x, box_h / 2 + y
    left, top = center_x - new_width / 2, center_y - new_height / 2
    right, bottom = center_x + new_width / 2, center_y + new_height / 2
    if left < 0:
        right -= left
        left = 0
    if top < 0:
        bottom -= top
        top = 0
    if right > src_w - 1:
        left -= right - src_w + 1
        right = src_w - 1
    if bottom > src_h - 1:
        top -= bottom - src_h + 1
        bottom = src_h - 1
    return (int(left), int(top), int(right), int(bottom)), scale


def crop_patch(image: ImageArray, bbox: IntBox, scale: float) -> tuple[ImageArray, float]:
    """Upstream's ``CropImage.crop``: the :func:`crop_box` region of the BGR image resized to
    80 x 80 (bilinear, aspect ratio not kept), and the scale used."""
    bgr = ensure_bgr(image)
    height, width = bgr.shape[:2]
    (left, top, right, bottom), effective = crop_box(width, height, bbox, scale)
    region = bgr[top : bottom + 1, left : right + 1]
    return np.asarray(cv2.resize(region, (INPUT_SIZE, INPUT_SIZE)), dtype=np.uint8), effective


def to_input(patch: ImageArray) -> NDArray[np.float32]:
    """Upstream's ``to_tensor``: the BGR patch as raw 0-255 float32, NCHW with a batch of one."""
    chw = np.asarray(patch, dtype=np.float32).transpose(2, 0, 1)
    return np.ascontiguousarray(chw[np.newaxis])


def softmax(logits: NDArray[np.floating]) -> NDArray[np.float64]:
    """The softmax of one row of logits (any leading singleton axes are dropped)."""
    row = np.asarray(logits, dtype=np.float64).reshape(-1)
    exponentials = np.exp(row - row.max())
    return np.asarray(exponentials / exponentials.sum(), dtype=np.float64)


def _p_real(model: InferenceModel, patch: ImageArray) -> float:
    logits = np.asarray(model.run(to_input(patch)))
    if logits.shape != (1, _CLASSES) or not np.all(np.isfinite(logits)):
        raise InferenceError("the anti-spoofing model returned an unusable output")
    return float(softmax(logits)[REAL_CLASS])


class PassiveLivenessEngine:
    """The ensemble's two models, loaded on first use (so the service starts, and serves
    ``/health``, before the weights are fetched) and picked up once fetched. Thread-safe.

    Without the models (none given, or the files missing), nothing is measured: ``measure``
    answers ``None`` with a warning in the log, and ``versions`` is ``(None, None)``, as the text
    models do for OCR (C32.1). The selfie checks then have no passive evidence and cannot pass.
    """

    def __init__(
        self, v2: InferenceModel | None = None, v1se: InferenceModel | None = None
    ) -> None:
        self._v2 = v2
        self._v1se = v1se
        self._loaded = False
        self._lock = threading.Lock()

    @classmethod
    def from_models_dir(cls, models_dir: Path) -> PassiveLivenessEngine:
        """An engine over the two pinned ONNX files in ``models_dir``; nothing is loaded yet."""
        return cls(
            OnnxModel(models_dir / ANTI_SPOOF_V2_FILENAME, name="anti-spoofing MiniFASNetV2"),
            OnnxModel(models_dir / ANTI_SPOOF_V1SE_FILENAME, name="anti-spoofing MiniFASNetV1SE"),
        )

    @classmethod
    def from_settings(cls, settings: Settings) -> PassiveLivenessEngine:
        """An engine over the models in ``settings.models_dir``; nothing is loaded yet."""
        return cls.from_models_dir(settings.models_dir)

    def load(self) -> bool:
        """Load both models if they are there; ``False`` (with a warning) when they are not.
        Safe to repeat."""
        with self._lock:
            if self._loaded:
                return True
            if self._v2 is None or self._v1se is None:
                logger.warning("no anti-spoofing models, so passive liveness is not measured")
                return False
            try:
                self._v2.load()
                self._v1se.load()
            except ModelNotAvailableError as exc:
                # The text, not the exception: a handler that keeps records would keep its
                # traceback, and with it the caller's full-size decode (Workflow 4B review H008).
                logger.warning(
                    "anti-spoofing models unavailable, so passive liveness is not measured: %s",
                    str(exc),
                )
                return False
            self._loaded = True
            return True

    @property
    def versions(self) -> tuple[str | None, str | None]:
        """``(anti_spoof_v2, anti_spoof_v1se)`` as ``model_versions`` reports them; ``None``
        while the models are not loaded."""
        if not self._loaded:
            return (None, None)
        return (ANTI_SPOOF_V2_VERSION, ANTI_SPOOF_V1SE_VERSION)

    def predict(self, image: ImageArray, bbox: IntBox) -> PassiveLiveness | None:
        """The ensemble on a face given as upstream's detector box; ``None`` without the models.

        Raises :class:`~openverify_vision.inference.InferenceError` when a model returns
        something other than three finite logits."""
        if not self.load() or self._v2 is None or self._v1se is None:
            return None
        bgr = ensure_bgr(image)
        v2_patch, v2_scale = crop_patch(bgr, bbox, V2_SCALE)
        v1se_patch, v1se_scale = crop_patch(bgr, bbox, V1SE_SCALE)
        p_v2 = _p_real(self._v2, v2_patch)
        p_v1se = _p_real(self._v1se, v1se_patch)
        return PassiveLiveness(
            v2=round(p_v2, _PROBABILITY_DECIMALS),
            v1se=round(p_v1se, _PROBABILITY_DECIMALS),
            mean=round((p_v2 + p_v1se) / 2, _PROBABILITY_DECIMALS),
            effective_scales=EffectiveScales(
                v2=round(v2_scale, _SCALE_DECIMALS), v1se=round(v1se_scale, _SCALE_DECIMALS)
            ),
        )

    def measure(self, image: ImageArray, face: Face | None) -> PassiveLiveness | None:
        """P(real) per model for the YuNet ``face`` in ``image`` (through :func:`upstream_box`);
        ``None`` without a face, for a degenerate box, or without the models."""
        if face is None:
            return None
        bbox = upstream_box(face)
        if bbox is None:
            return None
        return self.predict(image, bbox)
