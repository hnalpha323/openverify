"""tools/calibrate_selfie.py: the C49 measurements in Stage 1's schema, embeddings in memory only.

The face-match part runs on a calibration set written here: flat synthetic "photos" whose first
pixels say which identity and image they are, and a stub measurer that turns that into a seeded
embedding, an aligned crop and a skin angle (no model, no real face). The provisional part runs
on a hand-made selfie set with a stub analyser. ``test_calibrate_selfie_real.py`` runs the real
models on the public-domain faces.

The fixed rules (C49.1): near-duplicates are an SFace cosine above 0.93 or an aligned-crop pixel
correlation above 0.95; an exclusion otherwise comes only from the manifest's pinned review.
"""

from __future__ import annotations

import contextlib
import hashlib
import io
import json
import math
from collections.abc import Mapping
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import pytest
from numpy.typing import NDArray

from calibrate_selfie import (
    DOMAIN,
    GENUINE_CUE_KEYS,
    NEAR_DUPLICATE_CORRELATION,
    NEAR_DUPLICATE_COSINE,
    EngineMeasurer,
    FaceSample,
    app_analyser,
    face_match,
    load_set,
    main,
    portrait_upload,
    provisional,
    re_encodings,
    skin_ita,
)
from head_turn import encode_jpeg, write_mjpeg
from openverify_vision.analysis import FaceEngine
from openverify_vision.faces import Face
from openverify_vision.schemas import EMBEDDING_DIMENSIONS
from openverify_vision.settings import Settings
from schema_check import errors

REPO_ROOT = Path(__file__).resolve().parents[3]
SCHEMA = json.loads(
    (REPO_ROOT / "contracts/fixtures/calibration/selfie-calibration.schema.json").read_text(
        encoding="utf-8"
    )
)
NOW = datetime(2026, 10, 21, 12, 30, tzinfo=UTC)
NO_FACE = 250
COSINE_TWIN = 200
CROP_TWIN = 150


# --- the calibration set -------------------------------------------------------------------------

IDENTITIES: list[tuple[str, str, list[dict[str, Any]]]] = [
    (
        "p0001",
        "female",
        [
            {"year": 2010},
            {"year": 2016},
            {"year": 2012, "review": {"decision": "exclude", "reason": "misattribution"}},
            {"year": 2011, "twin": COSINE_TWIN},
        ],
    ),
    (
        "p0002",
        "male",
        [{"year": None}, {"year": 2001, "twin": CROP_TWIN}, {"face": False}, {"year": 2001}],
    ),
    ("p0003", "unknown", [{"missing": True}, {}]),
    ("p0004", "female", [{"missing": True, "review": {"decision": "keep"}}]),
]


def photo(identity: int, number: int, twin: int = 0, face: bool = True) -> NDArray[np.uint8]:
    """A flat picture: pixel (0, 0) names the identity and image, (0, 1) a twin, (0, 2) no face."""
    image = np.full((64, 64, 3), 90, dtype=np.uint8)
    image[0, 0] = 10 * identity + number
    image[0, 1] = twin
    image[0, 2] = 0 if face else NO_FACE
    return image


def commons_url(name: str) -> str:
    digest = hashlib.md5(name.encode()).hexdigest()  # noqa: S324 - Commons' directory scheme
    return f"https://upload.wikimedia.org/wikipedia/commons/{digest[0]}/{digest[:2]}/{name}"


def calibration_set(root: Path) -> tuple[Path, Path]:
    """Write the images and their manifest; return (manifest, images directory)."""
    images = root / "images"
    images.mkdir(parents=True)
    identities = []
    for index, (identity, sex, entries) in enumerate(IDENTITIES, start=1):
        listed = []
        for number, spec in enumerate(entries, start=1):
            name = f"{identity}-{number}"
            ok, buffer = cv2.imencode(
                ".png", photo(index, number, spec.get("twin", 0), spec.get("face", True))
            )
            assert ok
            data = buffer.tobytes()
            if not spec.get("missing"):
                (images / f"{name}.png").write_bytes(data)
            commons = f"Official_portrait_{name}.png"
            entry: dict[str, Any] = {
                "id": name,
                "url": commons_url(commons),
                "source_page": f"https://commons.wikimedia.org/wiki/File:{commons}",
                "revision_id": 1000 + index * 10 + number,
                "sha256": hashlib.sha256(data).hexdigest(),
                "sha1": hashlib.sha1(data).hexdigest(),  # noqa: S324 - Commons pins SHA-1
                "size": len(data),
                "license_template": "PD-USGov-NASA",
                "year": spec.get("year"),
            }
            if "review" in spec:
                entry["review"] = spec["review"]
            listed.append(entry)
        identities.append({"id": identity, "sex": sex, "images": listed})
    manifest = root / "calibration-manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "description": "test set",
                "purpose": "measure the pipeline's face-match error rates",
                "takedown": "remove the identity and rerun",
                "identities": identities,
            }
        ),
        encoding="utf-8",
    )
    return manifest, images


def unit(rng: np.random.Generator, size: int) -> NDArray[np.float64]:
    vector = rng.normal(0, 1, size)
    return np.asarray(vector / np.linalg.norm(vector), dtype=np.float64)


class StubMeasurer:
    """Seeded embeddings: an identity's images share a direction (cosine about 0.74)."""

    def __init__(self) -> None:
        self.embeddings: list[NDArray[np.float64]] = []

    def measure(self, image: NDArray[np.uint8]) -> FaceSample | None:
        code, twin, face = (int(image[0, i, 0]) for i in range(3))
        if face == NO_FACE:
            return None
        identity = code // 10
        base = unit(np.random.default_rng(identity), EMBEDDING_DIMENSIONS)
        own = unit(np.random.default_rng(1000 + code), EMBEDDING_DIMENSIONS)
        first = identity * 10 + 1
        if twin == COSINE_TWIN:
            own = unit(np.random.default_rng(1000 + first), EMBEDDING_DIMENSIONS)
        vector = base + 0.6 * own
        embedding = np.asarray(vector / np.linalg.norm(vector), dtype=np.float64)
        crop_seed = first if twin == CROP_TWIN else code
        aligned = np.random.default_rng(crop_seed).uniform(0, 255, (112, 112)).astype(np.float32)
        self.embeddings.append(embedding)
        return FaceSample(embedding=embedding, aligned=aligned, ita=40.0 + identity)


# --- the selfie set and its analyser --------------------------------------------------------------


def write_selfie_set(root: Path) -> tuple[Path, dict[str, str]]:
    """A minimal selfie set; returns its directory and each centre file's digest -> fixture."""
    directory = root / "selfie"
    directory.mkdir()
    by_digest: dict[str, str] = {}

    def poses(name: str, shade: int) -> dict[str, str]:
        files = {}
        for offset, pose in enumerate(("center", "left", "right")):
            data = encode_jpeg(np.full((48, 64, 3), shade + offset * 3, dtype=np.uint8), 92)
            (directory / f"{name}-{pose}.jpg").write_bytes(data)
            files[pose] = f"selfie/{name}-{pose}.jpg"
            if pose == "center":
                by_digest[hashlib.sha256(data).hexdigest()] = name
        return files

    frames = [encode_jpeg(np.full((48, 64, 3), 20 + i, dtype=np.uint8), 85) for i in range(90)]
    write_mjpeg(directory / "static-replay-a.mjpeg", frames)
    by_digest[hashlib.sha256(frames[0]).hexdigest()] = "static-replay-a"
    index = {
        "label": "pipeline fixtures, not attack-detection rates",
        "clips": [
            {"name": "head-turn-a", "kind": "head_turn", "file": "selfie/head-turn-a.mjpeg"},
            {
                "name": "static-replay-a",
                "kind": "static_replay",
                "file": "selfie/static-replay-a.mjpeg",
            },
        ],
        "stills": [
            {"name": "head-turn-a", "person": "A", "poses": poses("head-turn-a", 30)},
            {"name": "head-turn-b", "person": "B", "poses": poses("head-turn-b", 60)},
        ],
        "spoofs": [
            {
                "name": "screen-replay-a",
                "kind": "screen_replay",
                "poses": poses("screen-replay-a", 90),
            }
        ],
        "composites": [
            {
                "name": "covering-mask-a",
                "kind": "covering",
                "item": "mask",
                "poses": poses("mask", 120),
            },
            {
                "name": "glasses-dark-a",
                "kind": "glasses",
                "item": "dark",
                "poses": poses("dark", 150),
            },
        ],
    }
    (directory / "index.json").write_text(json.dumps(index), encoding="utf-8")
    return directory, by_digest


def pose(
    yaw: float | None = None,
    live: float | None = None,
    covering: float | None = None,
    glasses: float | None = None,
) -> dict[str, Any]:
    return {
        "head_pose": None if yaw is None else {"yaw_ratio": yaw},
        "passive_liveness": None if live is None else {"mean": live},
        "occlusion": None
        if covering is None
        else {"covering": {"score": covering}, "glasses": {"score": glasses}},
    }


def side(name: str, cosine: float | None, planarity: float | None) -> dict[str, Any]:
    return {
        "pose": name,
        "face_cosine_to_center": cosine,
        "planarity": None if planarity is None else {"median_residual_ratio": planarity},
    }


ANSWERS: dict[str, dict[str, Any]] = {
    "head-turn-a": {
        "poses": {"center": pose(0.004, 0.97, 0.1, 0.2), "left": pose(0.2), "right": pose(-0.13)},
        "consistency": [side("left", 0.85, 0.012), side("right", 0.8, 0.015)],
    },
    "head-turn-b": {
        "poses": {"center": pose(-0.012), "left": pose(0.15), "right": pose(-0.14)},
        "consistency": [side("left", 0.75, None), side("right", 0.76, 0.011)],
    },
    "screen-replay-a": {
        "poses": {"center": pose(0.0, 0.3), "left": pose(), "right": pose()},
        "consistency": [],
    },
    "mask": {"poses": {"center": pose(0.0, 0.9, 0.8, 0.05)}, "consistency": []},
    "dark": {"poses": {"center": pose(0.0, 0.9, 0.1, 0.9)}, "consistency": []},
    "static-replay-a": {
        "poses": {"center": pose(0.001), "left": pose(0.003), "right": pose(-0.002)},
        "consistency": [side("left", 0.99, 0.001), side("right", 0.99, 0.0012)],
    },
}


def portrait_answer(name: str) -> dict[str, Any]:
    """What the stub analyser measures on a calibration portrait: values from its id."""
    identity, number = int(name[1:5]), int(name.split("-")[1])
    return {
        "poses": {
            "center": {
                "passive_liveness": {"mean": 0.9 + 0.01 * identity + 0.001 * number},
                "occlusion": {
                    "covering": {"score": 0.1 * number, "forehead_valid": name != "p0002-4"},
                    "glasses": {"score": 0.05 * identity},
                },
                "synthetic": {
                    "spectral_tail_deviation": None if name == "p0003-2" else 0.5 * identity,
                    "residual_peak_ratio": 1.0 + 0.1 * number,
                    "noise_inconsistency": 0.01 * number,
                    "jpeg_grid_misalignment": 0.02 * identity,
                    "canonical_landmark_distance": 0.3 + 0.01 * number,
                    "digital_source_type": None,
                },
            }
        },
        "consistency": [],
    }


RE_ENCODED_ANSWER: dict[str, Any] = {
    "poses": {
        "center": {
            "passive_liveness": {"mean": 0.8},
            "occlusion": None,
            "synthetic": {
                "spectral_tail_deviation": 1.25,
                "residual_peak_ratio": 0.9,
                "noise_inconsistency": 0.02,
                "jpeg_grid_misalignment": 0.04,
                "canonical_landmark_distance": 0.4,
                "digital_source_type": None,
            },
        }
    },
    "consistency": [],
}
"""What the stub analyser measures on any re-encoded public-domain face."""


class StubAnalyser:
    """Answers the selfie fixtures by their centre's digest, a calibration portrait (centre only)
    by its file's digest, and anything else sent alone (a re-encoded face) with one answer."""

    def __init__(self, by_digest: dict[str, str], portraits: dict[str, str] | None = None) -> None:
        self.by_digest = by_digest
        self.portraits = portraits or {}
        self.calls: list[str] = []
        self.alone: list[bytes] = []

    def __call__(self, poses: Mapping[str, bytes]) -> Mapping[str, Any]:
        digest = hashlib.sha256(poses["center"]).hexdigest()
        if set(poses) == {"center"} and digest not in self.by_digest:
            if digest in self.portraits:
                self.calls.append(self.portraits[digest])
                return portrait_answer(self.portraits[digest])
            self.alone.append(poses["center"])
            return RE_ENCODED_ANSWER
        name = self.by_digest[digest]
        self.calls.append(name)
        assert set(poses) == {"center", "left", "right"}
        return ANSWERS[name]


EXPECTED_PROVISIONAL = {
    "center_yaw_ratio": [0.004, -0.012],
    "side_yaw_ratio_change": [0.196, 0.134, 0.162, 0.128],
    "side_face_cosine_to_center": [0.85, 0.8, 0.75, 0.76],
    "planarity_median_residual_ratio": [0.012, 0.015, 0.011],
    "passive_liveness_mean": [0.97],
    "covering_score": [0.1],
    "glasses_score": [0.2],
    "passive_liveness_mean_screen_replay": [0.3],
    "covering_score_mask": [0.8],
    "glasses_score_dark": [0.9],
    "side_yaw_ratio_change_static_replay": [0.002, 0.003],
    "side_face_cosine_to_center_static_replay": [0.99, 0.99],
    "planarity_median_residual_ratio_static_replay": [0.001, 0.0012],
}


FACE_SHAPES = ((1200, 1600), (900, 700), (500, 400))
"""Three stand-in "public-domain faces" (height, width): seeded noise, not photos."""


def write_faces(root: Path) -> tuple[Path, Path]:
    """Three JPEGs and a ``fixtures/manifest.json``-shaped list of them; (manifest, folder)."""
    folder = root / "faces"
    folder.mkdir()
    entries = []
    for index, shape in enumerate(FACE_SHAPES):
        pixels = np.random.default_rng(index).integers(0, 256, (*shape, 3), dtype=np.uint8)
        data = encode_jpeg(pixels, 90)
        name = f"face-{index}.jpg"
        (folder / name).write_bytes(data)
        entries.append({"name": f"face_{index}", "filename": name,
                        "sha256": hashlib.sha256(data).hexdigest()})  # fmt: skip
    manifest = root / "manifest.json"
    manifest.write_text(json.dumps({"faces": entries}), encoding="utf-8")
    return manifest, folder


def portrait_digests(images: Path) -> dict[str, str]:
    return {hashlib.sha256(path.read_bytes()).hexdigest(): path.stem for path in images.iterdir()}


def run(
    root: Path, measurer: StubMeasurer, *extra: str, analyser: StubAnalyser | None = None
) -> tuple[int, str, str, Path]:
    manifest, images = calibration_set(root)
    selfie, by_digest = write_selfie_set(root)
    faces_manifest, faces = write_faces(root)
    out = root / "out" / "selfie-measurements.json"
    printed, warned = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(printed), contextlib.redirect_stderr(warned):
        code = main(
            [
                "--manifest",
                str(manifest),
                "--images",
                str(images),
                "--selfie-set",
                str(selfie),
                "--faces-manifest",
                str(faces_manifest),
                "--faces",
                str(faces),
                "--out",
                str(out),
                *extra,
            ],
            measurer=measurer,
            analyse=analyser or StubAnalyser(by_digest, portrait_digests(images)),
            now=lambda: NOW,
        )
    return code, printed.getvalue(), warned.getvalue(), out


@pytest.fixture
def measured(tmp_path: Path) -> tuple[dict[str, Any], StubMeasurer, Path]:
    measurer = StubMeasurer()
    code, _, warned, out = run(tmp_path, measurer)
    assert code == 0, warned
    document: dict[str, Any] = json.loads(out.read_text(encoding="utf-8"))
    return document, measurer, out


# --- the document ---------------------------------------------------------------------------------


def test_the_rules_are_fixed_before_any_score_is_seen() -> None:
    assert (NEAR_DUPLICATE_COSINE, NEAR_DUPLICATE_CORRELATION) == (0.93, 0.95)
    assert DOMAIN == "studio portrait pairs"


def test_the_output_follows_the_stage_1_schema(
    measured: tuple[dict[str, Any], StubMeasurer, Path],
) -> None:
    document, _, _ = measured

    assert errors(document, SCHEMA) == []
    assert document["schema_version"] == 1
    assert document["generated_at"] == "2026-10-21T12:30:00Z"
    assert document["domain"] == "studio portrait pairs"
    assert document["models"] == {"detector": "yunet-2026may", "recognizer": "sface-2021dec"}


def test_the_set_counts_what_was_used_and_why_the_rest_was_not(
    measured: tuple[dict[str, Any], StubMeasurer, Path], tmp_path: Path
) -> None:
    document, _, _ = measured

    manifest = tmp_path / "calibration-manifest.json"
    assert document["set"]["manifest_sha256"] == hashlib.sha256(manifest.read_bytes()).hexdigest()
    assert document["set"]["identities"] == 3
    assert document["set"]["images"] == 5
    assert sorted((e["image"], e["reason"]) for e in document["set"]["excluded"]) == [
        ("p0001-3", "misattribution"),
        ("p0001-4", "near_duplicate"),
        ("p0002-2", "near_duplicate"),
        ("p0002-3", "no_face"),
        ("p0003-1", "fetch_failed"),
        ("p0004-1", "fetch_failed"),
    ]


def test_genuine_pairs_stay_within_an_identity_and_impostors_take_one_image_each(
    measured: tuple[dict[str, Any], StubMeasurer, Path],
) -> None:
    document, _, _ = measured
    pairs = {(p["a"], p["b"]): p for p in document["pairs"]}

    genuine = sorted(key for key, p in pairs.items() if p["genuine"])
    impostor = sorted(key for key, p in pairs.items() if not p["genuine"])
    assert genuine == [("p0001-1", "p0001-2"), ("p0002-1", "p0002-4")]
    assert impostor == [("p0001-1", "p0002-1"), ("p0001-1", "p0003-2"), ("p0002-1", "p0003-2")]
    assert pairs[("p0001-1", "p0001-2")]["age_gap_years"] == 6
    assert pairs[("p0002-1", "p0002-4")]["age_gap_years"] is None
    assert 0.6 < pairs[("p0001-1", "p0001-2")]["cosine"] < 0.9
    assert all(abs(pairs[key]["cosine"]) < 0.4 for key in impostor)


def test_the_skew_counts_sexes_and_ita_angles_of_the_used_identities(
    measured: tuple[dict[str, Any], StubMeasurer, Path],
) -> None:
    document, _, _ = measured

    assert document["skew"] == {
        "sex": {"female": 1, "male": 1, "unknown": 1},
        "ita_degrees": [41.0, 42.0, 43.0],
        "per_group_frr_measured": False,
    }


def test_the_provisional_distributions_come_from_the_synthetic_fixtures(
    measured: tuple[dict[str, Any], StubMeasurer, Path],
) -> None:
    document, _, _ = measured

    assert document["provisional"].keys() == EXPECTED_PROVISIONAL.keys()
    for key, values in EXPECTED_PROVISIONAL.items():
        assert document["provisional"][key] == pytest.approx(values), key


KEPT = ["p0001-1", "p0001-2", "p0002-1", "p0002-4", "p0003-2"]
"""The images the face match keeps, in the manifest's order."""


def test_the_review_keeps_the_genuine_pairs_it_removed_for_the_frr_before_it(
    measured: tuple[dict[str, Any], StubMeasurer, Path],
) -> None:
    document, _, _ = measured

    assert "review" in document
    review = document["review"]
    assert review["excluded_images"] == 1  # p0001-3, a pinned misattribution
    before = {(p["a"], p["b"]): p for p in review["genuine_pairs_before"]}
    assert set(before) == {
        ("p0001-1", "p0001-2"),
        ("p0001-1", "p0001-3"),
        ("p0001-2", "p0001-3"),
        ("p0002-1", "p0002-4"),
    }
    assert all(pair["genuine"] for pair in before.values())
    assert before[("p0001-2", "p0001-3")]["age_gap_years"] == 4
    after = {(p["a"], p["b"]): p["cosine"] for p in document["pairs"] if p["genuine"]}
    assert all(before[key]["cosine"] == cosine for key, cosine in after.items())


def test_the_genuine_portraits_give_each_heuristic_cue_one_value_per_kept_image(
    measured: tuple[dict[str, Any], StubMeasurer, Path],
) -> None:
    document, _, _ = measured

    assert "genuine_cues" in document
    portraits = document["genuine_cues"]["portraits"]
    assert set(portraits) == set(GENUINE_CUE_KEYS)
    center = {name: portrait_answer(name)["poses"]["center"] for name in KEPT}
    synthetic = {name: pose["synthetic"] for name, pose in center.items()}
    expected = {
        "passive_liveness_mean": [center[n]["passive_liveness"]["mean"] for n in KEPT],
        "covering_score": [center[n]["occlusion"]["covering"]["score"] for n in KEPT
                           if n != "p0002-4"],  # no forehead reference: never judged
        "glasses_score": [center[n]["occlusion"]["glasses"]["score"] for n in KEPT],
        "spectral_tail_deviation": [synthetic[n]["spectral_tail_deviation"] for n in KEPT
                                    if n != "p0003-2"],  # not measured: left out
    }  # fmt: skip
    for key in ("residual_peak_ratio", "noise_inconsistency", "jpeg_grid_misalignment",
                "canonical_landmark_distance"):  # fmt: skip
        expected[key] = [synthetic[n][key] for n in KEPT]
    for key, values in expected.items():
        assert portraits[key] == pytest.approx(values), key


def test_the_public_domain_faces_give_the_45_re_encodings_of_vision_integrity(
    tmp_path: Path,
) -> None:
    manifest, images = calibration_set(tmp_path)
    analyser = StubAnalyser(write_selfie_set(tmp_path)[1], portrait_digests(images))
    code, _, warned, out = run(tmp_path / "again", StubMeasurer(), analyser=analyser)
    del manifest

    assert code == 0, warned
    document = json.loads(out.read_text(encoding="utf-8"))
    assert errors(document, SCHEMA) == []
    re_encoded = document["genuine_cues"]["re_encodings"]
    assert len(analyser.alone) == 45
    for key in GENUINE_CUE_KEYS:
        expected = 0 if key in ("covering_score", "glasses_score") else 45
        assert len(re_encoded[key]) == expected, key
    assert re_encoded["spectral_tail_deviation"] == [1.25] * 45


def long_side(data: bytes) -> int:
    decoded = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    assert decoded is not None
    return int(max(decoded.shape[:2]))


def test_each_face_is_re_encoded_five_ways_at_1280_960_and_640_pixels(tmp_path: Path) -> None:
    _, faces = write_faces(tmp_path)

    encoded = re_encodings(faces / "face-0.jpg")

    assert [label for label, _ in encoded][:5] == [
        "1280 px, q95",
        "1280 px, q85",
        "1280 px, q75",
        "1280 px, resized 0.83, q85",
        "1280 px, q75 then q90",
    ]
    assert [long_side(data) for _, data in encoded] == [
        1280, 1280, 1280, 1062, 1280, 960, 960, 960, 797, 960, 640, 640, 640, 531, 640,
    ]  # fmt: skip
    assert all(data[:2] == b"\xff\xd8" for _, data in encoded)


def test_a_portrait_is_scaled_to_a_2000_px_long_side_and_re_encoded_only_when_larger() -> None:
    wide = np.random.default_rng(3).integers(0, 256, (1200, 2400, 3), dtype=np.uint8)
    small = np.random.default_rng(4).integers(0, 256, (300, 200, 3), dtype=np.uint8)
    wide_png = cv2.imencode(".png", wide)[1].tobytes()
    small_png = cv2.imencode(".png", small)[1].tobytes()

    scaled = portrait_upload(wide_png)

    assert scaled[:2] == b"\xff\xd8"  # JPEG
    decoded = cv2.imdecode(np.frombuffer(scaled, np.uint8), cv2.IMREAD_COLOR)
    assert decoded.shape[:2] == (1000, 2000)
    assert portrait_upload(small_png) == small_png


def test_a_black_and_white_portrait_has_no_skin_tone_to_read() -> None:
    landmarks = np.array([[38.3, 51.7], [73.5, 51.5], [56.0, 71.7], [41.5, 92.4], [70.7, 92.2]])
    skin = np.zeros((112, 112, 3), dtype=np.uint8)
    skin[:] = (120, 150, 200)  # BGR: a light skin tone
    grey = np.full((112, 112, 3), 150, dtype=np.uint8)

    angle = skin_ita(skin, landmarks)

    assert angle is not None
    assert 20 < angle < 60
    assert skin_ita(grey, landmarks) is None


def test_no_embedding_is_written_anywhere(
    measured: tuple[dict[str, Any], StubMeasurer, Path], tmp_path: Path
) -> None:
    document, measurer, out = measured
    text = out.read_text(encoding="utf-8")

    assert measurer.embeddings
    written = sorted(str(p.relative_to(tmp_path)) for p in tmp_path.rglob("*") if p.is_file())
    assert [name for name in written if name.startswith("out")] == ["out/selfie-measurements.json"]
    for embedding in measurer.embeddings:
        for value in embedding[:16]:
            assert f"{value:.6f}" not in text
            assert repr(float(value)) not in text

    def lists(value: object) -> list[list[Any]]:
        if isinstance(value, dict):
            return [found for item in value.values() for found in lists(item)]
        if isinstance(value, list):
            return [value, *(found for item in value for found in lists(item))]
        return []

    assert all(len(found) != EMBEDDING_DIMENSIONS for found in lists(document))


def test_the_run_writes_nothing_beside_its_output(tmp_path: Path) -> None:
    before = set(Path.cwd().iterdir())

    code, _, _, out = run(tmp_path, StubMeasurer())

    assert code == 0
    assert set(Path.cwd().iterdir()) == before
    assert set((tmp_path / "out").iterdir()) == {out}


def test_a_file_that_does_not_match_its_pin_stops_the_run(tmp_path: Path) -> None:
    manifest, images = calibration_set(tmp_path / "set")
    (images / "p0001-2.png").write_bytes(b"swapped")
    out = tmp_path / "out.json"
    warned = io.StringIO()

    with contextlib.redirect_stderr(warned):
        code = main(
            [
                "--manifest",
                str(manifest),
                "--images",
                str(images),
                "--out",
                str(out),
                "--skip-provisional",
            ],
            measurer=StubMeasurer(),
            now=lambda: NOW,
        )

    assert code == 1
    assert "p0001-2" in warned.getvalue()
    assert "sha256" in warned.getvalue()
    assert not out.exists()


def test_skip_provisional_writes_an_empty_provisional_section(tmp_path: Path) -> None:
    code, _, warned, out = run(tmp_path, StubMeasurer(), "--skip-provisional")

    assert code == 0
    assert json.loads(out.read_text(encoding="utf-8"))["provisional"] == {}
    assert "skip" in warned


def test_a_set_without_a_usable_image_is_an_error(tmp_path: Path) -> None:
    manifest, images = calibration_set(tmp_path)
    for path in images.iterdir():
        path.unlink()
    warned = io.StringIO()

    with contextlib.redirect_stderr(warned):
        code = main(
            [
                "--manifest",
                str(manifest),
                "--images",
                str(images),
                "--out",
                str(tmp_path / "o.json"),
                "--skip-provisional",
            ],
            measurer=StubMeasurer(),
        )

    assert code == 1
    assert "no image" in warned.getvalue()


def test_load_set_reads_the_fetch_scripts_manifest(tmp_path: Path) -> None:
    manifest, _ = calibration_set(tmp_path)

    images, digest = load_set(manifest)

    assert digest == hashlib.sha256(manifest.read_bytes()).hexdigest()
    assert [image.name for image in images][:4] == ["p0001-1", "p0001-2", "p0001-3", "p0001-4"]
    assert images[0].filename == "p0001-1.png"
    assert images[0].sex == "female"
    assert images[0].year == 2010
    assert images[2].review_reason == "misattribution"
    assert images[-1].review_reason is None  # a "keep" decision excludes nothing


# --- the in-process analyser ----------------------------------------------------------------------


class FixedDetector:
    def load(self) -> None:
        pass

    def detect(self, img: NDArray[np.uint8]) -> list[Face]:
        return [Face(box=(10.0, 10.0, 30.0, 30.0), landmarks=((20.0, 20.0),) * 5, score=0.95)]


class UnitRecognizer:
    def load(self) -> None:
        pass

    def embed(self, img: NDArray[np.uint8], face: Face) -> NDArray[np.float32]:
        vector = np.ones(EMBEDDING_DIMENSIONS, dtype=np.float32)
        return vector / np.linalg.norm(vector)


class NoLiveness:
    @property
    def versions(self) -> tuple[str | None, str | None]:
        return (None, None)

    def measure(self, image: object, face: object) -> None:
        del image, face


def test_the_app_analyser_posts_the_poses_to_the_selfie_route(tmp_path: Path) -> None:
    settings = Settings.model_validate({"service_token": "t" * 40, "models_dir": tmp_path})
    engine = FaceEngine(FixedDetector(), UnitRecognizer(), long_sides=(10_000,))
    selfie, _ = write_selfie_set(tmp_path)

    with app_analyser(settings, face_engine=engine, liveness=NoLiveness()) as analyse:  # type: ignore[arg-type]
        answer = analyse({"center": (selfie / "head-turn-a-center.jpg").read_bytes()})
        found = provisional(selfie, analyse)

    assert answer["poses"]["center"]["faces"]
    assert set(found) == set(EXPECTED_PROVISIONAL)
    assert all(isinstance(v, float) and math.isfinite(v) for vs in found.values() for v in vs)


# --- the edges ------------------------------------------------------------------------------------


class NoFaceDetector:
    def load(self) -> None:
        pass

    def detect(self, img: NDArray[np.uint8]) -> list[Face]:
        return []


def test_the_engine_measurer_finds_no_face_on_a_blank_picture() -> None:
    engine = FaceEngine(NoFaceDetector(), UnitRecognizer(), long_sides=(10_000,))

    assert EngineMeasurer(engine).measure(np.zeros((64, 64, 3), dtype=np.uint8)) is None


def test_a_cheek_patch_off_the_picture_has_no_ita() -> None:
    corner = np.array([[2.0, 2.0], [6.0, 2.0], [4.0, 4.0], [2.5, 6.0], [5.5, 6.0]])

    assert skin_ita(np.zeros((64, 64, 3), dtype=np.uint8), corner) is None


class FlatCrops:
    """Orthogonal embeddings (never a cosine twin), flat crops from pixel (0, 1), no skin angle."""

    def measure(self, image: NDArray[np.uint8]) -> FaceSample:
        code, shade = int(image[0, 0, 0]), int(image[0, 1, 0])
        embedding = np.zeros(EMBEDDING_DIMENSIONS)
        embedding[code % EMBEDDING_DIMENSIONS] = 1.0
        return FaceSample(
            embedding=embedding, aligned=np.full((112, 112), shade, np.float32), ita=None
        )


def test_flat_crops_are_near_duplicates_only_when_equal(tmp_path: Path) -> None:
    manifest, images = calibration_set(tmp_path)
    picked = [image for image in load_set(manifest)[0] if image.identity == "p0002"]
    for number, shade in ((1, 40), (2, 40), (3, 90), (4, 41)):
        flat = photo(2, number)
        flat[0, 1] = shade
        ok, buffer = cv2.imencode(".png", flat)
        assert ok
        (images / f"p0002-{number}.png").write_bytes(buffer.tobytes())
    rewritten = [
        replace(image, sha256=hashlib.sha256((images / image.filename).read_bytes()).hexdigest())
        for image in picked
    ]

    found = face_match(rewritten, images, FlatCrops())

    assert found["set"]["excluded"] == [{"image": "p0002-2", "reason": "near_duplicate"}]
    assert found["set"]["images"] == 3
    assert found["skew"]["ita_degrees"] == []


def test_a_pinned_file_that_is_not_an_image_stops_the_run(tmp_path: Path) -> None:
    manifest, images = calibration_set(tmp_path)
    document = json.loads(manifest.read_text(encoding="utf-8"))
    junk = b"not an image at all"
    document["identities"][0]["images"][0]["sha256"] = hashlib.sha256(junk).hexdigest()
    manifest.write_text(json.dumps(document), encoding="utf-8")
    (images / "p0001-1.png").write_bytes(junk)
    warned = io.StringIO()

    with contextlib.redirect_stderr(warned):
        code = main(
            ["--manifest", str(manifest), "--images", str(images), "--skip-provisional",
             "--out", str(tmp_path / "out.json")],
            measurer=StubMeasurer(),
        )  # fmt: skip

    assert code == 1
    assert "cannot be decoded" in warned.getvalue()


def test_without_the_models_it_points_at_the_fetch_script(tmp_path: Path) -> None:
    manifest, images = calibration_set(tmp_path)
    warned = io.StringIO()

    with contextlib.redirect_stderr(warned):
        code = main(
            ["--manifest", str(manifest), "--images", str(images), "--models",
             str(tmp_path / "none"), "--out", str(tmp_path / "out.json")]
        )  # fmt: skip

    assert code == 1
    assert "fetch_models.py" in warned.getvalue()


def test_without_a_selfie_set_it_points_at_the_generator(tmp_path: Path) -> None:
    manifest, images = calibration_set(tmp_path)
    out = tmp_path / "out.json"
    warned = io.StringIO()

    with contextlib.redirect_stderr(warned):
        code = main(
            ["--manifest", str(manifest), "--images", str(images), "--selfie-set",
             str(tmp_path / "absent"), "--out", str(out)],
            measurer=StubMeasurer(),
        )  # fmt: skip

    assert code == 1
    assert "make_synthetic_fixtures.py" in warned.getvalue()
    assert not out.exists()


def test_a_measure_vision_did_not_take_is_left_out(tmp_path: Path) -> None:
    selfie, _ = write_selfie_set(tmp_path)

    def unmeasured(poses: Mapping[str, bytes]) -> Mapping[str, Any]:
        del poses
        return {
            "poses": {"center": pose(0.01), "left": pose(), "right": pose(0.02)},
            "consistency": [side("left", None, None), side("right", None, 0.002)],
        }

    found = provisional(selfie, unmeasured)

    assert found["center_yaw_ratio"] == [0.01, 0.01]
    assert found["side_yaw_ratio_change"] == pytest.approx([0.01, 0.01])
    assert found["side_face_cosine_to_center"] == []
    assert found["planarity_median_residual_ratio"] == [0.002, 0.002]
    assert found["passive_liveness_mean"] == []
    assert found["passive_liveness_mean_screen_replay"] == []
