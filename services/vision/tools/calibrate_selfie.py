"""Measure the C49 selfie calibration: face-match scores and provisional distributions.

What ``packages/checks/scripts/calibration-report.ts --selfie`` reads, in Stage 1's schema
(``contracts/fixtures/calibration/selfie-calibration.schema.json``). This script measures; the
report scores and words it.

**Face match** on the calibration set of ``fixtures/calibration-manifest.json`` (fetched with
``python3 scripts/fetch_fixtures.py --calibration`` into ``fixtures/faces/calibration/``; each
file is checked against its pinned SHA-256 first). Every image is decoded upright, scaled to at
most :data:`MAX_LONG_SIDE` pixels, and measured with YuNet and SFace in process. Then, in the
manifest's order, with rules fixed before any score is seen (C49.1):

- an image the manifest's pinned review excludes keeps that reason (``misattribution``,
  ``different_person_per_metadata``); a file absent from disk is ``fetch_failed``; an image with
  no face is ``no_face``;
- an image whose SFace cosine to an earlier kept image of the same identity is above
  :data:`NEAR_DUPLICATE_COSINE`, or whose aligned 112 x 112 crop correlates above
  :data:`NEAR_DUPLICATE_CORRELATION` with that image's, is a ``near_duplicate``; a low score never
  excludes anything;
- genuine pairs: every two kept images of one identity; impostor pairs: the first kept image of
  each identity against the first of every other (same-identity pairs are never impostors);
- the skew: identities per sex, and per identity the median ITA angle of its face skin (two cheek
  patches in CIE Lab: a proxy, stated as one; a black-and-white photo has none); per-group FRR is
  not measured;
- the review (C49.1): the genuine pairs of the same rules without the pinned review exclusions
  (``review.genuine_pairs_before``), so the report gives FRR before and after with the count
  removed.

**Embeddings stay in memory.** They exist only inside :func:`face_match` and are never written,
logged or returned; the output holds pseudonymous image ids and rounded cosines only.

**Provisional distributions** on the C45.2 synthetic fixtures (``fixtures/generated/selfie/``,
``make_synthetic_fixtures.py``), through ``POST /v1/analyze/selfie`` of the app in process: the
genuine still triples give the centre yaw ratio, the side yaw-ratio changes, the side-to-centre
cosines, the planarity residuals, the centre's passive liveness and its covering and glasses
scores; each spoof gives the centre's passive liveness (``passive_liveness_mean_<kind>``); each
composite its covering or glasses score (``covering_score_<item>``, ``glasses_score_<item>``);
the static replay (its first frame and those 1 s and 2 s later) gives the same side measures with
``_static_replay``. A measure vision does not take yet is left out. These are labelled
provisional: simulated spoofs do not measure APCER or BPCER.

**Genuine cues** (``genuine_cues``), a false-positive proxy for the heuristic checks, not a selfie
measurement: every kept portrait of the calibration set, scaled to a :data:`MAX_LONG_SIDE` long
side (re-encoded as JPEG q95 when scaled; sent as is otherwise), analysed as a centre pose
(``portraits``); and the 45 re-encodings of vision-integrity's 4A stability test (each
public-domain test face of ``fixtures/manifest.json`` at 1,280, 960 and 640 pixels, five ways each,
``re_encodings``). Each gives the passive-liveness mean, the covering score (only with a valid
forehead reference, as the check judges it), the glasses score and every synthetic cue; a cue
vision did not measure is left out. ``--skip-provisional`` skips both sections.

Usage::

    cd services/vision && uv run python tools/calibrate_selfie.py
    cd services/vision && uv run python tools/calibrate_selfie.py --skip-provisional
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import io
import json
import math
import secrets
import statistics
import sys
from collections.abc import Callable, Iterator, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any, Final, Protocol
from urllib.parse import urlsplit

import cv2
import numpy as np
from fastapi.testclient import TestClient
from numpy.typing import NDArray
from PIL import Image as PILImage
from pydantic import SecretStr

from head_turn import split_mjpeg
from openverify_vision.analysis import FaceEngine
from openverify_vision.app import create_app
from openverify_vision.auth import SERVICE_TOKEN_HEADER
from openverify_vision.faces import DETECTOR_VERSION, FETCH_MODELS_HINT, ModelNotAvailableError
from openverify_vision.imaging import ImageArray, ImageDecodeError, decode_image
from openverify_vision.liveness import PassiveLivenessEngine
from openverify_vision.recognition import RECOGNIZER_VERSION
from openverify_vision.settings import Settings
from selfie_composites import TEMPLATE_112, face_affine

REPO_ROOT: Final = Path(__file__).resolve().parents[3]
DEFAULT_MANIFEST: Final = REPO_ROOT / "fixtures" / "calibration-manifest.json"
DEFAULT_SELFIE_SET: Final = REPO_ROOT / "fixtures" / "generated" / "selfie"
DEFAULT_FACES_MANIFEST: Final = REPO_ROOT / "fixtures" / "manifest.json"
DEFAULT_MODELS: Final = REPO_ROOT / "models"
DEFAULT_OUT: Final = (
    REPO_ROOT / "fixtures" / "generated" / "calibration" / "selfie-measurements.json"
)
SCHEMA_VERSION: Final = 1
DOMAIN: Final = "studio portrait pairs"
"""Every number the report gives names this domain: not a selfie against an ID card photo."""

NEAR_DUPLICATE_COSINE: Final = 0.93
NEAR_DUPLICATE_CORRELATION: Final = 0.95
"""C49.1's near-duplicate rules (research §10), fixed before any score is seen."""

MAX_LONG_SIDE: Final = 2000
MAX_PIXELS: Final = 120_000_000
"""Commons originals are large (some over 40 megapixels) and pinned, so the decode limit is the
script's own; Pillow's decompression-bomb check still applies."""

COSINE_DECIMALS: Final = 4
ITA_DECIMALS: Final = 1
PROVISIONAL_DECIMALS: Final = 6

SKIN_PATCHES: Final = ((30.0, 78.0), (82.0, 78.0))
"""Cheek centres in the 112 x 112 aligned-face template, below the eyes and beside the nose."""

SKIN_PATCH_HALF: Final = 4.0
"""Half the side of each cheek patch, in template units."""

STATIC_REPLAY_SIDE_SECONDS: Final = (1.0, 2.0)
"""The static replay's frames standing in for the left and right poses."""

MJPEG_FRAME_RATE: Final = 30

GENUINE_KEYS: Final = (
    "center_yaw_ratio",
    "side_yaw_ratio_change",
    "side_face_cosine_to_center",
    "planarity_median_residual_ratio",
    "passive_liveness_mean",
    "covering_score",
    "glasses_score",
)
STATIC_REPLAY_KEYS: Final = (
    "side_yaw_ratio_change_static_replay",
    "side_face_cosine_to_center_static_replay",
    "planarity_median_residual_ratio_static_replay",
)
SYNTHETIC_CUE_KEYS: Final = (
    "spectral_tail_deviation",
    "residual_peak_ratio",
    "noise_inconsistency",
    "jpeg_grid_misalignment",
    "canonical_landmark_distance",
)
GENUINE_CUE_KEYS: Final = (
    "passive_liveness_mean",
    "covering_score",
    "glasses_score",
    *SYNTHETIC_CUE_KEYS,
)
PORTRAIT_JPEG_QUALITY: Final = 95
"""A portrait scaled down is re-encoded at this quality (the highest of the 4A re-encodings)."""

RE_ENCODING_SIDES: Final = (1280, 960, 640)
RE_ENCODING_SHRINK: Final = 0.83
"""vision-integrity's 4A stability test: the long sides and the "resized" step's factor."""

ACHROMATIC_CHROMA: Final = 3.0
"""Cheeks whose median CIE a*b* chroma is below this are grey (a black-and-white photo): no skin
tone to read. Skin reads a chroma of about 10 to 30."""


class CalibrationError(Exception):
    """The set on disk is not the pinned set, or nothing in it could be measured."""


@dataclass(frozen=True, slots=True)
class SetImage:
    """One image of the calibration manifest, with what this script needs of it."""

    name: str
    """The pseudonymous image id, ``p0001-1``."""
    identity: str
    filename: str
    sha256: str
    sex: str
    year: int | None
    review_reason: str | None
    """The pinned review's exclusion reason, or ``None`` (no review, or kept)."""


def load_set(path: Path) -> tuple[list[SetImage], str]:
    """The images of the calibration manifest at ``path`` (``scripts/fetch_fixtures.py`` validates
    it in full) and the manifest's SHA-256."""
    data = path.read_bytes()
    document = json.loads(data)
    images: list[SetImage] = []
    for identity in document["identities"]:
        for entry in identity["images"]:
            suffix = PurePosixPath(urlsplit(entry["url"]).path).suffix.lower()
            review = entry.get("review") or {}
            images.append(
                SetImage(
                    name=entry["id"],
                    identity=identity["id"],
                    filename=f"{entry['id']}{suffix}",
                    sha256=entry["sha256"],
                    sex=identity["sex"],
                    year=entry.get("year"),
                    review_reason=review.get("reason")
                    if review.get("decision") == "exclude"
                    else None,
                )
            )
    return images, hashlib.sha256(data).hexdigest()


# --- one face -------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class FaceSample:
    """What one image contributes; held in memory only, never written."""

    embedding: NDArray[np.float64]
    """L2-normalised SFace embedding."""
    aligned: NDArray[np.float32]
    """The aligned 112 x 112 grey crop, for the near-duplicate correlation."""
    ita: float | None
    """The ITA angle of the cheeks' skin, in degrees; ``None`` when off the image."""


class FaceMeasurer(Protocol):
    def measure(self, image: ImageArray) -> FaceSample | None: ...


def _similarity(landmarks: NDArray[np.float64]) -> NDArray[np.float64]:
    """The 2 x 3 similarity transform (least squares) taking ``landmarks`` to the template."""
    points = np.asarray(landmarks, dtype=np.float64).reshape(5, 2)
    rows = []
    for (x, y), (u, v) in zip(points, TEMPLATE_112, strict=True):
        rows.append(([x, -y, 1.0, 0.0], u))
        rows.append(([y, x, 0.0, 1.0], v))
    design = np.asarray([row for row, _ in rows])
    target = np.asarray([value for _, value in rows])
    (a, b, tx, ty), *_ = np.linalg.lstsq(design, target, rcond=None)
    return np.asarray([[a, -b, tx], [b, a, ty]], dtype=np.float64)


def aligned_crop(image: ImageArray, landmarks: NDArray[np.float64]) -> NDArray[np.float32]:
    """The face warped onto the 112 x 112 template SFace aligns to, in grey."""
    warped = cv2.warpAffine(image, _similarity(landmarks), (112, 112), flags=cv2.INTER_LINEAR)
    return np.asarray(cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY), dtype=np.float32)


def skin_ita(image: ImageArray, landmarks: NDArray[np.float64]) -> float | None:
    """The ITA angle (``atan((L* - 50) / b*)`` in degrees) of the median Lab colour of the cheeks;
    ``None`` when a patch leaves the image or the cheeks are grey (:data:`ACHROMATIC_CHROMA`). A
    proxy for skin tone, stated as one."""
    affine = face_affine(landmarks)
    half = max(2, round(float(np.linalg.norm(affine[:, 0])) * SKIN_PATCH_HALF))
    height, width = image.shape[:2]
    pixels: list[NDArray[np.uint8]] = []
    for centre in SKIN_PATCHES:
        x, y = (round(float(v)) for v in affine @ np.array([*centre, 1.0]))
        if x - half < 0 or y - half < 0 or x + half >= width or y + half >= height:
            return None
        pixels.append(image[y - half : y + half + 1, x - half : x + half + 1].reshape(-1, 3))
    patch = np.concatenate(pixels).reshape(-1, 1, 3).astype(np.float32) / 255
    lab = cv2.cvtColor(patch, cv2.COLOR_BGR2Lab).reshape(-1, 3)
    lightness, red, yellow = (float(np.median(lab[:, channel])) for channel in range(3))
    if math.hypot(red, yellow) < ACHROMATIC_CHROMA:
        return None
    return math.degrees(math.atan2(lightness - 50, yellow))


class EngineMeasurer:
    """The real measurer: the service's face engine (YuNet across scales, SFace)."""

    def __init__(self, engine: FaceEngine) -> None:
        self._engine = engine

    def measure(self, image: ImageArray) -> FaceSample | None:
        faces = self._engine.find_faces(image)
        if not faces:
            return None
        face = faces[0]
        vector = np.asarray(self._engine.embed(image, face), dtype=np.float64)
        norm = float(np.linalg.norm(vector))
        if norm == 0:  # pragma: no cover - SFace never returns a zero vector for a face
            return None
        landmarks = np.asarray(face.landmarks, dtype=np.float64)
        return FaceSample(
            embedding=vector / norm,
            aligned=aligned_crop(image, landmarks),
            ita=skin_ita(image, landmarks),
        )


# --- the calibration set --------------------------------------------------------------------------


def _correlation(a: NDArray[np.float32], b: NDArray[np.float32]) -> float:
    first, second = a.astype(np.float64).ravel(), b.astype(np.float64).ravel()
    if first.std() == 0 or second.std() == 0:
        return 1.0 if np.array_equal(first, second) else 0.0
    return float(np.corrcoef(first, second)[0, 1])


def _near_duplicate(sample: FaceSample, kept: FaceSample) -> bool:
    return (
        float(sample.embedding @ kept.embedding) > NEAR_DUPLICATE_COSINE
        or _correlation(sample.aligned, kept.aligned) > NEAR_DUPLICATE_CORRELATION
    )


def _decode(path: Path, image: SetImage) -> ImageArray:
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != image.sha256:
        raise CalibrationError(
            f"{image.name}: {path} does not match its pinned sha256; fetch it again with "
            "python3 scripts/fetch_fixtures.py --calibration"
        )
    try:
        decoded = decode_image(data, max_pixels=MAX_PIXELS)
    except ImageDecodeError as exc:
        raise CalibrationError(f"{image.name}: {path} cannot be decoded: {exc}") from exc
    return _fit(decoded, MAX_LONG_SIDE)


def _fit(image: ImageArray, long_side: int) -> ImageArray:
    """``image`` scaled (``INTER_AREA``) so its long side is ``long_side``, unless it is smaller."""
    height, width = image.shape[:2]
    scale = long_side / max(height, width)
    if scale >= 1:
        return image
    size = (round(width * scale), round(height * scale))
    return np.asarray(cv2.resize(image, size, interpolation=cv2.INTER_AREA), dtype=np.uint8)


def _jpeg(image: ImageArray, quality: int) -> bytes:
    """``image`` (BGR) as a Pillow JPEG, as vision-integrity's 4A tests encode."""
    buffer = io.BytesIO()
    PILImage.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB)).save(
        buffer, format="JPEG", quality=quality
    )
    return buffer.getvalue()


def portrait_upload(data: bytes) -> bytes:
    """What the analysis gets of a calibration portrait: the original when its long side is at
    most :data:`MAX_LONG_SIDE`, else its upright decode scaled to it and re-encoded as JPEG at
    :data:`PORTRAIT_JPEG_QUALITY`."""
    decoded = decode_image(data, max_pixels=MAX_PIXELS)
    if max(decoded.shape[:2]) <= MAX_LONG_SIDE:
        return data
    return _jpeg(_fit(decoded, MAX_LONG_SIDE), PORTRAIT_JPEG_QUALITY)


def _portrait_at(path: Path, long_side: int) -> ImageArray:
    """vision-integrity's 4A decode of a test face: Pillow's draft mode at twice the size, then
    ``INTER_AREA`` to ``long_side`` (up or down)."""
    with PILImage.open(path) as photo:
        photo.draft("RGB", (2 * long_side, 2 * long_side))
        bgr = cv2.cvtColor(np.asarray(photo.convert("RGB"), dtype=np.uint8), cv2.COLOR_RGB2BGR)
    height, width = bgr.shape[:2]
    scale = long_side / max(height, width)
    size = (round(width * scale), round(height * scale))
    return np.asarray(cv2.resize(bgr, size, interpolation=cv2.INTER_AREA), dtype=np.uint8)


def re_encodings(path: Path) -> list[tuple[str, bytes]]:
    """The 15 re-encodings of one public-domain test face in vision-integrity's 4A stability test:
    at each of :data:`RE_ENCODING_SIDES`, JPEG q95, q85 and q75, resized by
    :data:`RE_ENCODING_SHRINK` then q85, and q75 then q90."""
    found: list[tuple[str, bytes]] = []
    for side in RE_ENCODING_SIDES:
        image = _portrait_at(path, side)
        smaller = cv2.resize(
            image, None, fx=RE_ENCODING_SHRINK, fy=RE_ENCODING_SHRINK, interpolation=cv2.INTER_AREA
        )
        once = decode_image(_jpeg(image, 75), max_pixels=MAX_PIXELS)
        for label, data in (
            ("q95", _jpeg(image, 95)),
            ("q85", _jpeg(image, 85)),
            ("q75", _jpeg(image, 75)),
            (f"resized {RE_ENCODING_SHRINK}, q85", _jpeg(np.asarray(smaller, np.uint8), 85)),
            ("q75 then q90", _jpeg(once, 90)),
        ):
            found.append((f"{side} px, {label}", data))
    return found


def _pairs(
    kept: Mapping[str, Sequence[SetImage]],
    samples: Mapping[str, FaceSample],
    *,
    impostors: bool = True,
) -> list[dict[str, Any]]:
    def cosine(a: SetImage, b: SetImage) -> float:
        value = float(samples[a.name].embedding @ samples[b.name].embedding)
        return round(min(1.0, max(-1.0, value)), COSINE_DECIMALS)

    pairs: list[dict[str, Any]] = []
    for images in kept.values():
        for index, a in enumerate(images):
            for b in images[index + 1 :]:
                gap = None if a.year is None or b.year is None else abs(a.year - b.year)
                pairs.append(
                    {"a": a.name, "b": b.name, "genuine": True, "cosine": cosine(a, b),
                     "age_gap_years": gap}
                )  # fmt: skip
    firsts = [images[0] for images in kept.values() if images] if impostors else []
    for index, a in enumerate(firsts):
        for b in firsts[index + 1 :]:
            pairs.append({"a": a.name, "b": b.name, "genuine": False, "cosine": cosine(a, b)})
    return pairs


def _measure_all(
    images: Sequence[SetImage], images_dir: Path, measurer: FaceMeasurer
) -> tuple[dict[str, FaceSample], dict[str, str]]:
    """Every image's sample (held in memory only), or why it has none."""
    samples: dict[str, FaceSample] = {}
    unusable: dict[str, str] = {}
    for image in images:
        path = images_dir / image.filename
        if not path.is_file():
            unusable[image.name] = "fetch_failed"
            continue
        sample = measurer.measure(_decode(path, image))
        if sample is None:
            unusable[image.name] = "no_face"
        else:
            samples[image.name] = sample
    return samples, unusable


def _select(
    images: Sequence[SetImage],
    samples: Mapping[str, FaceSample],
    unusable: Mapping[str, str],
    *,
    review: bool,
) -> tuple[dict[str, list[SetImage]], list[dict[str, str]]]:
    """The kept images by identity, and why each other image was left out, in manifest order;
    with ``review`` the pinned review's exclusions apply."""
    excluded: list[dict[str, str]] = []
    kept: dict[str, list[SetImage]] = {}
    for image in images:
        kept.setdefault(image.identity, [])
        reason = image.review_reason if review else None
        reason = reason or unusable.get(image.name)
        sample = samples.get(image.name)
        if (
            reason is None
            and sample is not None
            and any(_near_duplicate(sample, samples[other.name]) for other in kept[image.identity])
        ):
            reason = "near_duplicate"
        if reason is not None or sample is None:
            excluded.append({"image": image.name, "reason": reason or "no_face"})
            continue
        kept[image.identity].append(image)
    return kept, excluded


def face_match(
    images: Sequence[SetImage], images_dir: Path, measurer: FaceMeasurer
) -> dict[str, Any]:
    """The ``set`` (without the manifest digest), ``pairs``, ``review`` and ``skew`` of the
    document, and the kept images (``kept_images``, in manifest order) for the genuine cues."""
    samples, unusable = _measure_all(images, images_dir, measurer)
    kept, excluded = _select(images, samples, unusable, review=True)
    before, _ = _select(images, samples, unusable, review=False)

    used = {identity: chosen for identity, chosen in kept.items() if chosen}
    sexes: dict[str, int] = {}
    angles: list[float] = []
    for chosen in used.values():
        sexes[chosen[0].sex] = sexes.get(chosen[0].sex, 0) + 1
        found = [samples[image.name].ita for image in chosen]
        measured = [angle for angle in found if angle is not None]
        if measured:
            angles.append(round(statistics.median(measured), ITA_DECIMALS))
    return {
        "set": {
            "identities": len(used),
            "images": sum(len(chosen) for chosen in used.values()),
            "excluded": excluded,
        },
        "pairs": _pairs(used, samples),
        "review": {
            "excluded_images": sum(1 for image in images if image.review_reason is not None),
            "genuine_pairs_before": _pairs(
                {identity: chosen for identity, chosen in before.items() if chosen},
                samples,
                impostors=False,
            ),
        },
        "skew": {"sex": sexes, "ita_degrees": angles, "per_group_frr_measured": False},
        "kept_images": [image for chosen in used.values() for image in chosen],
    }


# --- the provisional distributions ----------------------------------------------------------------

SelfieAnalyser = Callable[[Mapping[str, bytes]], Mapping[str, Any]]
"""``analyse({"center": ..., "left": ..., "right": ...})`` answers like ``/v1/analyze/selfie``."""


@contextlib.contextmanager
def app_analyser(
    settings: Settings,
    *,
    face_engine: FaceEngine | None = None,
    liveness: PassiveLivenessEngine | None = None,
) -> Iterator[SelfieAnalyser]:
    """An analyser posting to ``/v1/analyze/selfie`` of the app in process. ``face_engine`` and
    ``liveness`` replace the app's own (tests)."""
    app = create_app(settings, face_engine=face_engine)
    if liveness is not None:
        app.state.liveness_engine = liveness
    token = settings.service_token.get_secret_value()
    with TestClient(app) as client:

        def analyse(poses: Mapping[str, bytes]) -> Mapping[str, Any]:
            files = {pose: (f"{pose}.jpg", data, "image/jpeg") for pose, data in poses.items()}
            response = client.post(
                "/v1/analyze/selfie", files=files, headers={SERVICE_TOKEN_HEADER: token}
            )
            response.raise_for_status()
            answer: Mapping[str, Any] = response.json()
            return answer

        yield analyse


def _value(answer: Mapping[str, Any], *path: str) -> float | None:
    found: Any = answer
    for key in path:
        if not isinstance(found, Mapping) or found.get(key) is None:
            return None
        found = found[key]
    return float(found)


def _sides(answer: Mapping[str, Any], found: dict[str, list[float]], suffix: str = "") -> None:
    center = _value(answer, "poses", "center", "head_pose", "yaw_ratio")
    for side in ("left", "right"):
        turned = _value(answer, "poses", side, "head_pose", "yaw_ratio")
        if center is not None and turned is not None:
            found[f"side_yaw_ratio_change{suffix}"].append(abs(turned - center))
    for entry in answer.get("consistency", []):
        cosine = _value(entry, "face_cosine_to_center")
        residual = _value(entry, "planarity", "median_residual_ratio")
        if cosine is not None:
            found[f"side_face_cosine_to_center{suffix}"].append(cosine)
        if residual is not None:
            found[f"planarity_median_residual_ratio{suffix}"].append(residual)


def _genuine(answer: Mapping[str, Any], found: dict[str, list[float]]) -> None:
    measures = {
        "center_yaw_ratio": ("head_pose", "yaw_ratio"),
        "passive_liveness_mean": ("passive_liveness", "mean"),
        "covering_score": ("occlusion", "covering", "score"),
        "glasses_score": ("occlusion", "glasses", "score"),
    }
    for key, path in measures.items():
        value = _value(answer, "poses", "center", *path)
        if value is not None:
            found[key].append(value)
    _sides(answer, found)


def _append(found: dict[str, list[float]], key: str, value: float | None) -> None:
    found.setdefault(key, [])
    if value is not None:
        found[key].append(value)


def provisional(selfie_dir: Path, analyse: SelfieAnalyser) -> dict[str, list[float]]:
    """The provisional distributions of the selfie set in ``selfie_dir`` (module docstring)."""
    index: dict[str, Any] = json.loads((selfie_dir / "index.json").read_text(encoding="utf-8"))
    root = selfie_dir.parent  # the index names files from the generated directory

    def poses(entry: Mapping[str, Any]) -> dict[str, bytes]:
        return {pose: (root / name).read_bytes() for pose, name in entry["poses"].items()}

    found: dict[str, list[float]] = {key: [] for key in (*GENUINE_KEYS, *STATIC_REPLAY_KEYS)}
    for still in index["stills"]:
        _genuine(analyse(poses(still)), found)
    for spoof in index["spoofs"]:
        mean = _value(analyse(poses(spoof)), "poses", "center", "passive_liveness", "mean")
        _append(found, f"passive_liveness_mean_{spoof['kind']}", mean)
    for composite in index["composites"]:
        measure = "covering" if composite["kind"] == "covering" else "glasses"
        score = _value(analyse(poses(composite)), "poses", "center", "occlusion", measure, "score")
        _append(found, f"{measure}_score_{composite['item']}", score)
    for clip in index["clips"]:
        if clip["kind"] != "static_replay":
            continue
        frames = split_mjpeg((root / clip["file"]).read_bytes())
        left, right = (round(seconds * MJPEG_FRAME_RATE) for seconds in STATIC_REPLAY_SIDE_SECONDS)
        replay = {"center": frames[0], "left": frames[left], "right": frames[right]}
        _sides(analyse(replay), found, "_static_replay")
    return {key: [round(v, PROVISIONAL_DECIMALS) for v in values] for key, values in found.items()}


# --- the genuine cues (a false-positive proxy for the heuristic checks) ---------------------------


def _raw(answer: Mapping[str, Any], *path: str) -> object:
    found: Any = answer
    for key in path:
        if not isinstance(found, Mapping):
            return None
        found = found.get(key)
    return found


def _cues(answer: Mapping[str, Any], found: dict[str, list[float]]) -> None:
    """The heuristic cues of an analysis's centre pose, appended to ``found``."""
    center = ("poses", "center")
    values = {
        "passive_liveness_mean": _value(answer, *center, "passive_liveness", "mean"),
        "covering_score": _value(answer, *center, "occlusion", "covering", "score")
        if _raw(answer, *center, "occlusion", "covering", "forehead_valid") is True
        else None,
        "glasses_score": _value(answer, *center, "occlusion", "glasses", "score"),
        **{key: _value(answer, *center, "synthetic", key) for key in SYNTHETIC_CUE_KEYS},
    }
    for key, value in values.items():
        if value is not None:
            found[key].append(round(value, PROVISIONAL_DECIMALS))


def portrait_cues(
    images: Sequence[SetImage], images_dir: Path, analyse: SelfieAnalyser
) -> dict[str, list[float]]:
    """The genuine cues of each calibration portrait (see the module docstring)."""
    found: dict[str, list[float]] = {key: [] for key in GENUINE_CUE_KEYS}
    for image in images:
        path = images_dir / image.filename
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != image.sha256:
            raise CalibrationError(f"{image.name}: {path} does not match its pinned sha256")
        _cues(analyse({"center": portrait_upload(data)}), found)
    return found


def test_faces(manifest: Path, folder: Path) -> list[Path]:
    """The public-domain test faces of ``fixtures/manifest.json``, each checked against its pin."""
    entries = json.loads(manifest.read_text(encoding="utf-8"))["faces"]
    faces: list[Path] = []
    for entry in entries:
        path = folder / entry["filename"]
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != entry["sha256"]:
            raise CalibrationError(
                f"{path} is missing or does not match its pin; "
                "run python3 scripts/fetch_fixtures.py"
            )
        faces.append(path)
    return faces


def re_encoding_cues(faces: Sequence[Path], analyse: SelfieAnalyser) -> dict[str, list[float]]:
    """The genuine cues of the 15 re-encodings of each test face (45 for the three)."""
    found: dict[str, list[float]] = {key: [] for key in GENUINE_CUE_KEYS}
    for face in faces:
        for _, data in re_encodings(face):
            _cues(analyse({"center": data}), found)
    return found


# --- the command line -----------------------------------------------------------------------------


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Measure the C49 selfie calibration.")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument(
        "--images",
        type=Path,
        default=None,
        help="the fetched set (default: <manifest dir>/faces/calibration)",
    )
    parser.add_argument("--selfie-set", type=Path, default=DEFAULT_SELFIE_SET)
    parser.add_argument(
        "--faces-manifest",
        type=Path,
        default=DEFAULT_FACES_MANIFEST,
        help="the public-domain test faces re-encoded for the genuine cues",
    )
    parser.add_argument(
        "--faces", type=Path, default=None, help="their folder (default: <manifest dir>/faces)"
    )
    parser.add_argument("--models", type=Path, default=DEFAULT_MODELS)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument(
        "--skip-provisional",
        action="store_true",
        help="measure the face match only: the provisional section is then empty and the "
        "genuine cues are not measured",
    )
    return parser


def _timestamp(now: Callable[[], datetime]) -> str:
    return now().astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def main(
    argv: Sequence[str] | None = None,
    *,
    measurer: FaceMeasurer | None = None,
    analyse: SelfieAnalyser | None = None,
    now: Callable[[], datetime] | None = None,
) -> int:
    """The command line. ``measurer`` and ``analyse`` replace the real models (tests)."""
    args = _parser().parse_args(argv)
    images_dir: Path = (
        args.images if args.images is not None else args.manifest.parent / "faces" / "calibration"
    )
    clock = now if now is not None else lambda: datetime.now(UTC)
    settings = Settings.model_construct(
        service_token=SecretStr(secrets.token_hex(24)), models_dir=args.models
    )
    try:
        images, manifest_sha256 = load_set(args.manifest)
        if measurer is None:
            engine = FaceEngine.from_settings(settings)
            engine.ensure_loaded()
            measurer = EngineMeasurer(engine)
        matched = face_match(images, images_dir, measurer)
    except (OSError, KeyError, ValueError, CalibrationError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except ModelNotAvailableError as exc:
        print(f"error: {exc}; {FETCH_MODELS_HINT}", file=sys.stderr)
        return 1
    if matched["set"]["images"] == 0:
        print("error: no image of the set could be measured; fetch it first", file=sys.stderr)
        return 1

    distributions: dict[str, list[float]] = {}
    cues: dict[str, dict[str, list[float]]] | None = None
    if args.skip_provisional:
        print(
            "warning: skipping the provisional distributions and the genuine cues "
            "(--skip-provisional)",
            file=sys.stderr,
        )
    elif not (args.selfie_set / "index.json").is_file():
        print(
            f"error: no selfie set at {args.selfie_set}; run tools/make_synthetic_fixtures.py",
            file=sys.stderr,
        )
        return 1
    else:
        faces_dir: Path = (
            args.faces if args.faces is not None else args.faces_manifest.parent / "faces"
        )
        source = contextlib.nullcontext(analyse) if analyse is not None else app_analyser(settings)
        try:
            faces = test_faces(args.faces_manifest, faces_dir)
            with source as run:
                distributions = provisional(args.selfie_set, run)
                cues = {
                    "portraits": portrait_cues(matched["kept_images"], images_dir, run),
                    "re_encodings": re_encoding_cues(faces, run),
                }
        except (OSError, KeyError, ValueError, CalibrationError) as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 1

    document = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": _timestamp(clock),
        "domain": DOMAIN,
        "models": {"detector": DETECTOR_VERSION, "recognizer": RECOGNIZER_VERSION},
        "set": {"manifest_sha256": manifest_sha256, **matched["set"]},
        "pairs": matched["pairs"],
        "review": matched["review"],
        "skew": matched["skew"],
        "provisional": distributions,
        **({} if cues is None else {"genuine_cues": cues}),
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
    genuine = sum(1 for pair in document["pairs"] if pair["genuine"])
    print(
        f"wrote {args.out}: {matched['set']['identities']} identities, "
        f"{matched['set']['images']} images, {genuine} genuine and "
        f"{len(document['pairs']) - genuine} impostor pairs, "
        f"{len(matched['set']['excluded'])} excluded"
    )
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised through main()
    raise SystemExit(main())
