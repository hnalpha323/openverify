"""C41.1 synthetic-face cues (research §5.3) and the XMP digital source type.

The XMP packets are written here, by hand, into JPEG APP1 segments and PNG iTXt chunks. The
search is a bounded byte search (at most 64 KiB of the packet, no XML parser), so entity
declarations, external entities and oversized packets are inert: the hostile tests pin that.

The face cues are measured on drawn scenes (a smooth colour backdrop with fine texture and
sensor-like noise, the "face" a box in it) with one artefact added at a time, and their
stability on re-encoded copies of the three public-domain faces (in memory, YuNet's face).
"""

from __future__ import annotations

import io
import struct
import time
from pathlib import Path

import cv2
import numpy as np
import pytest
from numpy.typing import NDArray
from PIL import Image as PILImage
from PIL.PngImagePlugin import PngInfo

from openverify_vision.analysis import FaceEngine
from openverify_vision.faces import YUNET_FILENAME, Face
from openverify_vision.imaging import decode_image
from openverify_vision.pose import CANONICAL_LANDMARKS_CM
from openverify_vision.schemas import SyntheticScores
from openverify_vision.settings import Settings
from openverify_vision.synthetic_face import (
    MAX_XMP_SEARCH_BYTES,
    canonical_landmark_distance,
    measure_synthetic,
    read_digital_source_type,
)
from repose import project_canonical

from synthetic import Image, encode

IPTC = "http://cv.iptc.org/newscodes/digitalsourcetype/"
XMP_NAMESPACE = b"http://ns.adobe.com/xap/1.0/\x00"


def packet(body: str, *, doctype: str = "") -> bytes:
    """An XMP packet around ``body`` (the inside of one ``rdf:Description``)."""
    return (
        f'{doctype}<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>'
        '<x:xmpmeta xmlns:x="adobe:ns:meta/">'
        '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
        '<rdf:Description rdf:about="" '
        'xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" '
        f"{body}"
        "</rdf:Description></rdf:RDF></x:xmpmeta>"
        '<?xpacket end="w"?>'
    ).encode()


def attribute(value: str, prefix: str = "Iptc4xmpExt") -> str:
    return f'{prefix}:DigitalSourceType="{value}">'


def element(value: str) -> str:
    return f">\n  <Iptc4xmpExt:DigitalSourceType>{value}</Iptc4xmpExt:DigitalSourceType>\n"


def photo(seed: int = 1) -> Image:
    rng = np.random.default_rng(seed)
    return rng.integers(60, 200, size=(240, 320, 3), dtype=np.uint8)


def jpeg_with_xmp(xmp: bytes, image: Image | None = None) -> bytes:
    """A JPEG whose first segment after SOI is an APP1 XMP segment holding ``xmp``."""
    data = encode(photo() if image is None else image, "JPEG", quality=90)
    payload = XMP_NAMESPACE + xmp
    assert len(payload) + 2 <= 0xFFFF
    segment = b"\xff\xe1" + struct.pack(">H", len(payload) + 2) + payload
    return data[:2] + segment + data[2:]


def png_with_xmp(xmp: bytes) -> bytes:
    """A PNG with an ``XML:com.adobe.xmp`` iTXt chunk (no size limit, unlike a JPEG APP1)."""
    info = PngInfo()
    info.add_itxt("XML:com.adobe.xmp", xmp.decode())
    buffer = io.BytesIO()
    PILImage.fromarray(photo()).save(buffer, format="PNG", pnginfo=info)
    return buffer.getvalue()


FACE = Face(
    box=(110.0, 60.0, 100.0, 120.0),
    landmarks=((140.0, 105.0), (180.0, 105.0), (160.0, 130.0), (145.0, 155.0), (175.0, 155.0)),
    score=0.95,
)


# --- the forms a digital source type takes in XMP ----------------------------------------------


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        (attribute(f"{IPTC}trainedAlgorithmicMedia"), "trainedAlgorithmicMedia"),
        (element(f"{IPTC}compositeSynthetic"), "compositeSynthetic"),
        (
            f'><Iptc4xmpExt:DigitalSourceType rdf:resource="{IPTC}algorithmicMedia"/>',
            "algorithmicMedia",
        ),
        (
            attribute("https://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture"),
            "digitalCapture",
        ),
        (
            attribute(f"{IPTC}compositeWithTrainedAlgorithmicMedia", prefix="iptcExt"),
            "compositeWithTrainedAlgorithmicMedia",
        ),
        (attribute("trainedAlgorithmicMedia"), "trainedAlgorithmicMedia"),
        (f"Iptc4xmpExt:DigitalSourceType = '{IPTC}virtualRecording'>", "virtualRecording"),
    ],
    ids=["attribute", "element", "rdf-resource", "https", "other-prefix", "bare-code", "spaced"],
)
def test_the_iptc_digital_source_type_is_read_from_the_xmp_packet(body: str, expected: str) -> None:
    assert read_digital_source_type(jpeg_with_xmp(packet(body))) == expected


def test_a_png_itxt_packet_is_read_too() -> None:
    xmp = packet(attribute(f"{IPTC}trainedAlgorithmicMedia"))
    assert read_digital_source_type(png_with_xmp(xmp)) == "trainedAlgorithmicMedia"


@pytest.mark.parametrize(
    "body",
    [
        attribute("http://example.com/vocabulary/trainedAlgorithmicMedia"),
        attribute(f"{IPTC}trained Algorithmic"),
        attribute(f"{IPTC}"),
        attribute(f"{IPTC}{'a' * 300}"),
        attribute("café"),
        'xmp:CreatorTool="Example">',
    ],
    ids=["other-vocabulary", "space", "empty-code", "overlong", "non-ascii", "absent"],
)
def test_no_iptc_code_reads_as_none(body: str) -> None:
    assert read_digital_source_type(jpeg_with_xmp(packet(body))) is None


def test_an_upload_without_xmp_has_no_digital_source_type() -> None:
    assert read_digital_source_type(encode(photo(), "JPEG")) is None
    assert read_digital_source_type(b"") is None


def test_a_property_outside_any_xmp_packet_is_ignored() -> None:
    stray = f'Iptc4xmpExt:DigitalSourceType="{IPTC}trainedAlgorithmicMedia"'.encode()
    assert read_digital_source_type(encode(photo(), "JPEG") + stray) is None


def test_a_property_after_the_packets_end_is_ignored() -> None:
    xmp = packet('xmp:Rating="1">') + attribute(f"{IPTC}trainedAlgorithmicMedia").encode()
    assert read_digital_source_type(jpeg_with_xmp(xmp)) is None


# --- hostile XMP ---------------------------------------------------------------------------------


def test_entity_expansion_is_never_performed() -> None:
    laughs = "".join(f'<!ENTITY lol{n} "{f"&lol{n - 1};" * 10}">' for n in range(1, 10))
    doctype = f'<!DOCTYPE lolz [<!ENTITY lol0 "{IPTC}trainedAlgorithmicMedia">{laughs}]>'
    xmp = packet(element("&lol9;"), doctype=doctype)
    started = time.perf_counter()
    assert read_digital_source_type(jpeg_with_xmp(xmp)) is None
    assert time.perf_counter() - started < 1.0


def test_an_external_entity_is_never_resolved() -> None:
    doctype = (
        "<!DOCTYPE x [<!ENTITY xxe SYSTEM "
        f'"{IPTC}trainedAlgorithmicMedia"><!ENTITY file SYSTEM "file:///etc/hostname">]>'
    )
    for value in ("&xxe;", "&file;"):
        xmp = packet(attribute(value), doctype=doctype)
        assert read_digital_source_type(jpeg_with_xmp(xmp)) is None, value


def test_only_the_first_64_kib_of_an_oversized_packet_are_searched() -> None:
    filler = f'xmp:Label="{"x" * (MAX_XMP_SEARCH_BYTES + 4096)}" '
    late = packet(filler + attribute(f"{IPTC}trainedAlgorithmicMedia"))
    assert len(late) > MAX_XMP_SEARCH_BYTES
    assert read_digital_source_type(png_with_xmp(late)) is None
    early = packet(f'Iptc4xmpExt:DigitalSourceType="{IPTC}trainedAlgorithmicMedia" ' + filler + ">")
    assert len(early) > MAX_XMP_SEARCH_BYTES
    assert read_digital_source_type(png_with_xmp(early)) == "trainedAlgorithmicMedia"


def test_a_flood_of_unreadable_properties_stays_bounded() -> None:
    flood = 'Iptc4xmpExt:DigitalSourceType="&a;" ' * 1500
    xmp = packet(flood + attribute(f"{IPTC}trainedAlgorithmicMedia"))
    started = time.perf_counter()
    assert read_digital_source_type(png_with_xmp(xmp)) is None
    assert time.perf_counter() - started < 1.0


def test_a_huge_upload_without_xmp_is_searched_quickly() -> None:
    data = encode(photo(), "JPEG") + b"<" * (8 * 1024 * 1024)
    started = time.perf_counter()
    assert read_digital_source_type(data) is None
    assert time.perf_counter() - started < 1.0


# --- only an upload's metadata is read ----------------------------------------------------------


def test_an_upload_reports_its_digital_source_type() -> None:
    image = photo()
    data = jpeg_with_xmp(packet(attribute(f"{IPTC}trainedAlgorithmicMedia")), image)
    scores = measure_synthetic(data, image, FACE, "upload")
    assert scores is not None
    assert scores.digital_source_type == "trainedAlgorithmicMedia"


def test_an_upload_without_a_face_still_reports_its_digital_source_type() -> None:
    image = photo()
    data = jpeg_with_xmp(packet(attribute(f"{IPTC}compositeSynthetic")), image)
    scores = measure_synthetic(data, image, None, "upload")
    assert scores is not None
    assert scores.digital_source_type == "compositeSynthetic"
    assert scores.spectral_tail_deviation is None
    assert scores.canonical_landmark_distance is None


def test_a_camera_capture_never_reads_metadata() -> None:
    image = photo()
    data = jpeg_with_xmp(packet(attribute(f"{IPTC}trainedAlgorithmicMedia")), image)
    scores = measure_synthetic(data, image, None, "camera")
    assert scores is None or scores.digital_source_type is None


# --- the face cues on drawn scenes ---------------------------------------------------------------

SCENE_BOX = (380.0, 180.0, 200.0, 240.0)
"""The "face" of :func:`scene`, in a 960 x 720 frame."""
REGION = (slice(180, 420), slice(380, 580))


def face_in(box: tuple[float, float, float, float]) -> Face:
    x, y, w, h = box
    landmarks = (
        (x + 0.3 * w, y + 0.4 * h),
        (x + 0.7 * w, y + 0.4 * h),
        (x + 0.5 * w, y + 0.6 * h),
        (x + 0.35 * w, y + 0.8 * h),
        (x + 0.65 * w, y + 0.8 * h),
    )
    return Face(box=box, landmarks=landmarks, score=0.95)


def scene(seed: int = 1, height: int = 720, width: int = 960, noise: float = 2.0) -> Image:
    """A smooth colour backdrop with fine texture and sensor-like noise, as a camera sees it."""
    rng = np.random.default_rng(seed)
    coarse = cv2.resize(
        rng.normal(128.0, 30.0, (height // 16, width // 16, 3)),
        (width, height),
        interpolation=cv2.INTER_CUBIC,
    )
    texture = cv2.GaussianBlur(rng.normal(0.0, 8.0, (height, width, 3)), (0, 0), 0.8)
    grain = rng.normal(0.0, noise, (height, width, 3))
    return np.clip(coarse + texture + grain, 0, 255).astype(np.uint8)


def scores_of(data: bytes, box: tuple[float, float, float, float] = SCENE_BOX) -> SyntheticScores:
    image = decode_image(data, max_pixels=50_000_000)
    scores = measure_synthetic(data, image, face_in(box), "camera")
    assert scores is not None
    return scores


def png(image: Image) -> bytes:
    return encode(image, "PNG")


def jpg(image: Image, quality: int) -> bytes:
    return encode(image, "JPEG", quality=quality)


def grated(image: Image, cycles_per_pixel: float, amplitude: float = 4.0) -> Image:
    """``image`` with a vertical grating of ``cycles_per_pixel`` added to the face only."""
    out = image.astype(np.float64)
    columns = np.arange(image.shape[1], dtype=np.float64)
    wave = amplitude * np.sin(2 * np.pi * cycles_per_pixel * columns)
    out[REGION] += wave[None, REGION[1], None]
    return np.clip(out, 0, 255).astype(np.uint8)


def test_a_clean_scene_reads_low_on_every_cue() -> None:
    clean = scores_of(png(scene()))
    assert clean.spectral_tail_deviation is not None
    assert clean.spectral_tail_deviation < 0.5
    assert clean.residual_peak_ratio is not None
    assert clean.residual_peak_ratio < 3
    assert clean.noise_inconsistency is not None
    assert clean.noise_inconsistency < 0.1
    assert clean.jpeg_grid_misalignment is None  # a PNG has no JPEG grid
    assert clean.canonical_landmark_distance is not None
    assert clean.canonical_landmark_distance > 0.2
    assert clean.digital_source_type is None


def test_a_clean_jpeg_scene_has_an_aligned_grid() -> None:
    misalignment = scores_of(jpg(scene(), 95)).jpeg_grid_misalignment
    assert misalignment is not None
    assert misalignment < 0.1


def test_an_up_convolved_face_bends_the_spectral_tail() -> None:
    image = scene()
    half = cv2.resize(image[REGION], (100, 120), interpolation=cv2.INTER_AREA)
    rng = np.random.default_rng(5)
    doubled = cv2.resize(half, (200, 240), interpolation=cv2.INTER_NEAREST) + rng.normal(
        0, 2, (240, 200, 3)
    )
    up = image.copy()
    up[REGION] = np.clip(doubled, 0, 255).astype(np.uint8)
    clean = scores_of(png(image)).spectral_tail_deviation
    bent = scores_of(png(up)).spectral_tail_deviation
    assert clean is not None
    assert bent is not None
    assert bent >= 2.0
    assert bent >= 5 * clean


def test_a_periodic_face_residual_peaks_above_the_background() -> None:
    for data in (png(grated(scene(), 0.3)), jpg(grated(scene(), 0.3), 90)):
        ratio = scores_of(data).residual_peak_ratio
        assert ratio is not None
        assert ratio >= 10


@pytest.mark.parametrize("cycles", [0.25, 0.375])
def test_peaks_on_the_jpeg_and_demosaic_frequencies_are_masked(cycles: float) -> None:
    ratio = scores_of(png(grated(scene(), cycles))).residual_peak_ratio
    assert ratio is not None
    assert ratio < 3


def test_a_face_smoother_than_its_surroundings_reads_as_noise_inconsistent() -> None:
    image = scene()
    image[REGION] = cv2.GaussianBlur(image[REGION], (0, 0), 2.0)
    score = scores_of(png(image)).noise_inconsistency
    assert score is not None
    assert score >= 0.5


def test_a_face_noisier_than_its_surroundings_does_not() -> None:
    image = scene()
    rng = np.random.default_rng(6)
    image[REGION] = np.clip(image[REGION] + rng.normal(0, 6, image[REGION].shape), 0, 255).astype(
        np.uint8
    )
    assert scores_of(png(image)).noise_inconsistency == 0.0


def _pasted(quality: int, shift: tuple[int, int]) -> Image:
    """The scene with its face replaced by a JPEG of ``quality`` whose grid is shifted."""
    image = scene()
    moved = np.roll(np.roll(image, shift[0], axis=0), shift[1], axis=1)
    ok, buffer = cv2.imencode(".jpg", moved, [cv2.IMWRITE_JPEG_QUALITY, quality])
    assert ok
    decoded = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
    restored = np.roll(np.roll(decoded, -shift[0], axis=0), -shift[1], axis=1)
    out = image.copy()
    out[REGION] = restored[REGION]
    return out


def test_a_face_pasted_from_a_shifted_jpeg_grid_is_misaligned() -> None:
    shifted = scores_of(jpg(_pasted(20, (3, 5)), 95)).jpeg_grid_misalignment
    aligned = scores_of(jpg(_pasted(20, (0, 0)), 95)).jpeg_grid_misalignment
    assert shifted is not None
    assert aligned is not None
    assert shifted >= 0.5
    assert aligned < shifted


def test_a_flat_backdrop_leaves_the_spectral_tail_unmeasured() -> None:
    flat = np.full((720, 960, 3), 140, np.uint8)
    flat[REGION] = scene()[REGION]
    assert scores_of(png(flat)).spectral_tail_deviation is None


def test_a_face_filling_the_frame_has_no_background_to_compare_with() -> None:
    image = scene(2, 400, 360)
    scores = scores_of(png(image), (40.0, 30.0, 280.0, 340.0))
    assert scores.spectral_tail_deviation is None
    assert scores.residual_peak_ratio is None


def test_a_face_too_small_for_a_spectrum_still_has_its_noise_measured() -> None:
    scores = scores_of(png(scene()), (440.0, 260.0, 60.0, 70.0))
    assert scores.spectral_tail_deviation is None
    assert scores.residual_peak_ratio is None
    assert scores.noise_inconsistency is not None


def test_a_camera_capture_without_a_face_measures_nothing() -> None:
    image = scene()
    assert measure_synthetic(png(image), image, None, "camera") is None


# --- the FFHQ-aligned landmark positions (Yang et al. 2019) -----------------------------------


def test_an_ffhq_aligned_face_sits_on_the_canonical_square() -> None:
    # Eyes 256 px apart and the mouth 230 px below them: the alignment square is the frame.
    aligned = [(384.0, 489.0), (640.0, 489.0), (512.0, 600.0), (422.0, 719.0), (602.0, 719.0)]
    distance = canonical_landmark_distance(aligned, (1024, 1024))
    assert distance == pytest.approx(0.0, abs=1e-4)


def test_a_selfie_frame_is_far_from_the_canonical_square() -> None:
    points = project_canonical(np.asarray(CANONICAL_LANDMARKS_CM, dtype=np.float64), 0.0)
    distance = canonical_landmark_distance([(float(x), float(y)) for x, y in points], (640, 480))
    assert distance is not None
    assert distance > 0.2


def test_a_crop_moves_the_face_off_the_canonical_square() -> None:
    aligned = [(384.0, 489.0), (640.0, 489.0), (512.0, 600.0), (422.0, 719.0), (602.0, 719.0)]
    cropped = [(x - 100.0, y - 100.0) for x, y in aligned]
    distance = canonical_landmark_distance(cropped, (824, 824))
    assert distance is not None
    assert distance > 0.05


def test_degenerate_landmarks_have_no_distance() -> None:
    assert canonical_landmark_distance([(5.0, 5.0)] * 5, (100, 100)) is None
    assert canonical_landmark_distance([(5.0, 5.0)] * 3, (100, 100)) is None
    assert canonical_landmark_distance([(1.0, 2.0)] * 5, (0, 100)) is None


# --- hostile sizes stay bounded -------------------------------------------------------------------


def test_a_huge_frame_and_face_are_measured_on_bounded_windows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[tuple[int, ...]] = []
    for name in ("medianBlur", "filter2D"):
        original = getattr(cv2, name)

        def spy(
            image: NDArray[np.generic],
            *args: object,
            _original: object = original,
            **kwargs: object,
        ) -> object:
            seen.append(image.shape)
            return _original(image, *args, **kwargs)  # type: ignore[operator]

        monkeypatch.setattr(cv2, name, spy)
    big = np.asarray(cv2.resize(scene(3), (5400, 4050), interpolation=cv2.INTER_LINEAR), np.uint8)
    scores = scores_of(jpg(big, 90), (2000.0, 1000.0, 1300.0, 1600.0))
    assert scores.noise_inconsistency is not None
    assert seen
    assert all(max(shape[:2]) <= 256 for shape in seen)


# --- stability: re-encoding a clean public-domain photo never reads high -------------------------

REPO_ROOT = Path(__file__).resolve().parents[3]
MODELS_DIR = REPO_ROOT / "models"
FACES_DIR = REPO_ROOT / "fixtures" / "faces"
PUBLIC_DOMAIN = ("person-a-id.jpg", "person-a-selfie.jpg", "person-b-selfie.jpg")

HIGH_TAIL_DEVIATION = 4.0
"""One decade of power across the tail band (a slope of 4 decades per unit radius over 0.25)."""
HIGH_PEAK_RATIO = 10.0
"""A residual peak one decade more prominent than any in the background."""
HIGH_UNIT_SCORE = 0.5
"""The middle of the [0, 1] cues' scale."""
NEAR_CANONICAL = 0.05
"""Within 5 % of the frame of the FFHQ alignment square."""

needs_faces = pytest.mark.skipif(
    not (MODELS_DIR / YUNET_FILENAME).is_file() or not (FACES_DIR / PUBLIC_DOMAIN[0]).is_file(),
    reason="fetch the models and faces: scripts/fetch_models.py and scripts/fetch_fixtures.py",
)


def _portrait(name: str, long_side: int) -> Image:
    with PILImage.open(FACES_DIR / name) as photo:
        photo.draft("RGB", (2 * long_side, 2 * long_side))
        bgr = cv2.cvtColor(np.asarray(photo.convert("RGB"), dtype=np.uint8), cv2.COLOR_RGB2BGR)
    height, width = bgr.shape[:2]
    scale = long_side / max(height, width)
    size = (round(width * scale), round(height * scale))
    return np.asarray(cv2.resize(bgr, size, interpolation=cv2.INTER_AREA), dtype=np.uint8)


def _re_encodings(image: Image) -> list[tuple[str, bytes]]:
    smaller = np.asarray(
        cv2.resize(image, None, fx=0.83, fy=0.83, interpolation=cv2.INTER_AREA), np.uint8
    )
    once = decode_image(jpg(image, 75), max_pixels=50_000_000)
    return [
        ("q95", jpg(image, 95)),
        ("q85", jpg(image, 85)),
        ("q75", jpg(image, 75)),
        ("resized 0.83, q85", jpg(smaller, 85)),
        ("q75 then q90", jpg(once, 90)),
    ]


@needs_faces
@pytest.mark.parametrize("name", PUBLIC_DOMAIN)
@pytest.mark.parametrize("long_side", [1280, 640])
def test_re_encoding_a_clean_public_domain_photo_never_reads_high(
    name: str, long_side: int
) -> None:
    engine = FaceEngine.from_settings(Settings(service_token="t" * 40, models_dir=MODELS_DIR))  # type: ignore[call-arg]
    for label, data in _re_encodings(_portrait(name, long_side)):
        image = decode_image(data, max_pixels=50_000_000)
        faces = engine.find_faces(image)
        assert faces, label
        scores = measure_synthetic(data, image, faces[0], "upload")
        assert scores is not None, label
        assert scores.digital_source_type is None, label
        assert (
            scores.spectral_tail_deviation is None
            or scores.spectral_tail_deviation < HIGH_TAIL_DEVIATION
        ), label
        assert scores.residual_peak_ratio is None or scores.residual_peak_ratio < HIGH_PEAK_RATIO, (
            label
        )
        assert scores.noise_inconsistency is not None, label
        assert scores.noise_inconsistency < HIGH_UNIT_SCORE, label
        assert scores.jpeg_grid_misalignment is not None, label
        assert scores.jpeg_grid_misalignment < HIGH_UNIT_SCORE, label
        assert scores.canonical_landmark_distance is not None, label
        assert scores.canonical_landmark_distance > NEAR_CANONICAL, label


# --- edges: faces off the frame, tiny faces and frames ------------------------------------------


def test_non_finite_landmarks_have_no_distance() -> None:
    points = [(1.0, 2.0), (float("nan"), 2.0), (3.0, 4.0), (1.0, 6.0), (3.0, 6.0)]
    assert canonical_landmark_distance(points, (100, 100)) is None


def test_a_face_box_off_the_frame_measures_only_its_landmarks() -> None:
    image = scene()
    data = jpg(image, 90)
    scores = measure_synthetic(data, image, face_in((1200.0, 900.0, 200.0, 240.0)), "camera")
    assert scores is not None
    assert scores.spectral_tail_deviation is None
    assert scores.noise_inconsistency is None
    assert scores.jpeg_grid_misalignment is None
    assert scores.canonical_landmark_distance is not None


def test_a_face_under_16_pixels_has_no_window_and_no_grid() -> None:
    image = scene()
    scores = measure_synthetic(jpg(image, 90), image, face_in((470.0, 300.0, 15.0, 15.0)), "camera")
    assert scores is not None
    assert scores.noise_inconsistency is None
    assert scores.jpeg_grid_misalignment is None


@pytest.mark.parametrize("size", [60, 64])
def test_a_frame_too_small_for_a_noise_window_uses_the_neck_or_nothing(size: int) -> None:
    image = scene(4, size, size)
    low = measure_synthetic(png(image), image, face_in((8.0, 4.0, 40.0, 40.0)), "camera")
    assert low is not None
    assert low.noise_inconsistency is None  # no 64-pixel window fits; the neck is 14 px deep
    tall = scene(4, 3 * size, size)
    high = measure_synthetic(png(tall), tall, face_in((4.0, 4.0, 52.0, 60.0)), "camera")
    assert high is not None
    assert high.noise_inconsistency is not None  # the 21-pixel neck below a 60-pixel face
