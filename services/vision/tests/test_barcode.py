"""``barcode.py``: zxing-cpp decoding of each side (C32.1).

Every barcode is rendered here from the synthetic AAMVA vectors in ``contracts/fixtures/aamva/``
with ``pdf417gen``, as a barcode-only image on a plain background (C36), or written with
zxing-cpp's own encoder. Payloads are compared byte for byte: the text is zxing-cpp's ``Plain``
text, never the HRI text that renders AAMVA's control characters as ``<LF><RS><CR>``.
"""

from __future__ import annotations

import base64
import json
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import pdf417gen
import pytest
import zxingcpp

from forensic_scenes import Image, camera, card, decode, full_frame, jpeg, not_found
from openverify_vision import barcode, document, mrz_locate, ocr
from openverify_vision.analysis import FaceEngine, analyze_government_id_side
from openverify_vision.barcode import MAX_DECODE_SIDE, decode_barcodes, decode_side_barcodes
from openverify_vision.document import DocumentResult
from openverify_vision.faces import Face
from openverify_vision.quality import QualityThresholds
from openverify_vision.schemas import (
    MAX_BARCODES,
    Barcode,
    DocumentDetection,
    MrzReading,
    Quad,
    TextLine,
)
from openverify_vision.settings import Settings

from synthetic import make_checkerboard, make_uniform

REPO_ROOT = Path(__file__).resolve().parents[3]
AAMVA_VECTORS: list[dict[str, Any]] = json.loads(
    (REPO_ROOT / "contracts" / "fixtures" / "aamva" / "valid.json").read_text(encoding="utf-8")
)["vectors"]
PAYLOAD: str = AAMVA_VECTORS[0]["payload"]
PADDING = 40


def pdf417(payload: str, *, scale: int = 3, padding: int = PADDING) -> Image:
    """A barcode-only BGR image of ``payload`` (its latin-1 bytes) on a white background."""
    codes = pdf417gen.encode(payload.encode("latin-1"), columns=12, security_level=5)
    rendered = pdf417gen.render_image(codes, scale=scale, ratio=3, padding=padding)
    rgb = np.asarray(rendered.convert("RGB"), dtype=np.uint8)
    return np.ascontiguousarray(rgb[:, :, ::-1])


def qr(content: str, scale: int = 4) -> Image:
    written = zxingcpp.create_barcode(content, zxingcpp.BarcodeFormat.QRCode)
    grey = np.asarray(written.to_image(scale=scale), dtype=np.uint8)
    return np.ascontiguousarray(cv2.cvtColor(grey, cv2.COLOR_GRAY2BGR))


def photographed(symbol: Image) -> tuple[Image, np.ndarray]:
    """``symbol`` on a grey canvas at an angle, blurred, noisy and saved as JPEG quality 60.

    Returns the decoded photo and where the symbol's corners landed.
    """
    height, width = symbol.shape[:2]
    corners = np.array([[0, 0], [width, 0], [width, height], [0, height]], dtype=np.float32)
    landed = np.array([[150, 180], [1150, 120], [1190, 520], [120, 470]], dtype=np.float32)
    matrix = cv2.getPerspectiveTransform(corners, landed)
    canvas = cv2.warpPerspective(
        symbol, matrix, (1400, 700), flags=cv2.INTER_LINEAR, borderValue=(150, 150, 150)
    )
    blurred = cv2.GaussianBlur(canvas, (0, 0), 1.0)
    return decode(jpeg(camera(np.asarray(blurred, dtype=np.uint8), noise=4.0), 60)), landed


def payload_bytes(found: Barcode) -> bytes:
    return base64.b64decode(found.bytes_b64, validate=True)


def assert_quad_near(quad: Quad, expected: Sequence[Sequence[float]], tolerance: float) -> None:
    for (x, y), (ex, ey) in zip(quad, expected, strict=True):
        assert abs(x - ex) <= tolerance, (quad, expected)
        assert abs(y - ey) <= tolerance, (quad, expected)


# --- decode_barcodes ----------------------------------------------------------------------------


@pytest.mark.parametrize("vector", AAMVA_VECTORS, ids=[v["id"] for v in AAMVA_VECTORS])
def test_a_clean_aamva_render_decodes_byte_exact(vector: dict[str, Any]) -> None:
    payload: str = vector["payload"]

    (found,) = decode_barcodes(pdf417(payload))

    assert found.format == "PDF417"
    assert payload_bytes(found) == payload.encode("latin-1")
    # Plain text keeps the control characters; the HRI text would show "<LF><RS><CR>".
    assert found.text == payload
    assert "\n\x1e\r" in found.text
    assert "<LF>" not in found.text
    assert Barcode.model_validate(found.model_dump()) == found


def test_the_quad_outlines_the_symbol_clockwise_from_the_top_left() -> None:
    image = pdf417(PAYLOAD)
    height, width = image.shape[:2]

    (found,) = decode_barcodes(image)

    inner = (PADDING, PADDING, width - PADDING, height - PADDING)
    expected = [
        (inner[0], inner[1]),
        (inner[2], inner[1]),
        (inner[2], inner[3]),
        (inner[0], inner[3]),
    ]
    assert_quad_near(found.quad, expected, tolerance=3.0)


def test_a_photographed_barcode_decodes_byte_exact() -> None:
    photo, landed = photographed(pdf417(PAYLOAD))

    (found,) = decode_barcodes(photo)

    assert payload_bytes(found) == PAYLOAD.encode("latin-1")
    assert found.text == PAYLOAD
    # The symbol starts PADDING pixels inside the warped image, so its corners sit inside.
    xs, ys = [p[0] for p in found.quad], [p[1] for p in found.quad]
    assert landed[:, 0].min() <= min(xs)
    assert max(xs) <= landed[:, 0].max()
    assert landed[:, 1].min() <= min(ys)
    assert max(ys) <= landed[:, 1].max()


def test_a_greyscale_numpy_array_decodes() -> None:
    grey = np.asarray(cv2.cvtColor(pdf417(PAYLOAD), cv2.COLOR_BGR2GRAY), dtype=np.uint8)

    (found,) = decode_barcodes(grey)

    assert payload_bytes(found) == PAYLOAD.encode("latin-1")


@pytest.mark.parametrize(
    "image",
    [
        pytest.param(card(), id="card"),
        pytest.param(make_checkerboard(), id="checkerboard"),
        pytest.param(np.zeros((1, 1, 3), dtype=np.uint8), id="1x1"),
        pytest.param(make_uniform((90, 120, 200), height=400, width=600), id="uniform"),
    ],
)
def test_an_image_without_a_barcode_has_none(image: Image) -> None:
    assert decode_barcodes(image) == []


def test_a_large_upload_is_downscaled_before_zxing_and_its_quad_scaled_back(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    symbol = pdf417(PAYLOAD, scale=8, padding=200)
    height, width = symbol.shape[:2]
    upload = np.full((height + 1000, max(width + 1000, 6000), 3), 255, dtype=np.uint8)
    upload[500 : 500 + height, 500 : 500 + width] = symbol
    seen: list[tuple[int, ...]] = []
    real = zxingcpp.read_barcodes

    def spy(image: Image, *args: Any, **kwargs: Any) -> Any:
        seen.append(tuple(image.shape))
        return real(image, *args, **kwargs)

    monkeypatch.setattr(zxingcpp, "read_barcodes", spy)

    (found,) = decode_barcodes(upload)

    assert seen
    assert all(max(shape[:2]) <= MAX_DECODE_SIDE for shape in seen)
    assert payload_bytes(found) == PAYLOAD.encode("latin-1")
    left, top = 500 + 200, 500 + 200
    right, bottom = 500 + width - 200, 500 + height - 200
    expected = [(left, top), (right, top), (right, bottom), (left, bottom)]
    assert_quad_near(found.quad, expected, tolerance=12.0)


def test_at_most_eight_barcodes_are_reported_pdf417_first() -> None:
    tiles = [qr(f"OPENVERIFY TEST {i:02d}") for i in range(10)]
    tile = tiles[0].shape[0]
    sheet = np.full((3 * (tile + 40) + 40, 4 * (tile + 40) + 40, 3), 255, dtype=np.uint8)
    for i, image in enumerate(tiles):
        row, column = divmod(i, 4)
        y, x = 40 + row * (tile + 40), 40 + column * (tile + 40)
        sheet[y : y + tile, x : x + tile] = image
    symbol = pdf417(PAYLOAD, scale=2, padding=10)
    page = np.full(
        (sheet.shape[0] + symbol.shape[0] + 40, max(sheet.shape[1], symbol.shape[1]), 3),
        255,
        np.uint8,
    )
    page[: sheet.shape[0], : sheet.shape[1]] = sheet
    page[sheet.shape[0] + 20 : sheet.shape[0] + 20 + symbol.shape[0], : symbol.shape[1]] = symbol

    found = decode_barcodes(page)

    assert len(found) == MAX_BARCODES
    assert found[0].format == "PDF417"
    assert {b.format for b in found[1:]} == {"QR Code"}


class FakePoint:
    def __init__(self, x: float, y: float) -> None:
        self.x, self.y = x, y


class FakePosition:
    def __init__(self) -> None:
        self.top_left = FakePoint(1, 1)
        self.top_right = FakePoint(9, 1)
        self.bottom_right = FakePoint(9, 5)
        self.bottom_left = FakePoint(1, 5)


class FakeResult:
    def __init__(self, data: bytes, text: str) -> None:
        self.format = zxingcpp.BarcodeFormat.PDF417
        self.bytes = data
        self.text = text
        self.position = FakePosition()


def test_a_payload_beyond_the_contract_limits_is_left_out(monkeypatch: pytest.MonkeyPatch) -> None:
    results = [
        FakeResult(b"\x00" * 7000, "x"),  # base64 over 8192 characters
        FakeResult(b"ok", "\U0001f600" * 2049),  # over 4096 UTF-16 code units, as zod counts
        FakeResult(b"ok", "ok"),
    ]
    monkeypatch.setattr(zxingcpp, "read_barcodes", lambda *a, **k: results)

    found = decode_barcodes(make_checkerboard())

    assert [(payload_bytes(b), b.text) for b in found] == [(b"ok", "ok")]


# --- decode_side_barcodes -----------------------------------------------------------------------


CANVAS_QUAD = np.array([[120, 140], [1180, 90], [1230, 520], [90, 560]], dtype=np.float32)
"""Where the barcode-only page's corners land on the canvas."""


def symbol_corners_on_canvas(symbol: Image) -> list[tuple[float, float]]:
    """Where the symbol itself (inside its ``PADDING``) lands on the canvas of ``on_canvas``."""
    height, width = symbol.shape[:2]
    corners = np.array([[0, 0], [width, 0], [width, height], [0, height]], dtype=np.float32)
    forward = cv2.getPerspectiveTransform(corners, CANVAS_QUAD)
    inner = np.array(
        [
            [PADDING, PADDING],
            [width - PADDING, PADDING],
            [width - PADDING, height - PADDING],
            [PADDING, height - PADDING],
        ],
        dtype=np.float32,
    )
    landed = cv2.perspectiveTransform(inner.reshape(-1, 1, 2), forward).reshape(-1, 2)
    return [(float(x), float(y)) for x, y in landed]


def on_canvas(symbol: Image) -> tuple[Image, DocumentResult]:
    """A barcode-only page photographed at an angle on a plain grey canvas, with its document."""
    height, width = symbol.shape[:2]
    corners = np.array([[0, 0], [width, 0], [width, height], [0, height]], dtype=np.float32)
    quad = CANVAS_QUAD
    forward = cv2.getPerspectiveTransform(corners, quad)
    upload = cv2.warpPerspective(
        symbol, forward, (1320, 660), flags=cv2.INTER_LINEAR, borderValue=(150, 150, 150)
    )
    upload = camera(np.asarray(upload, dtype=np.uint8), noise=2.0)
    back = cv2.getPerspectiveTransform(quad, corners)
    rectified = np.asarray(cv2.warpPerspective(upload, back, (width, height)), dtype=np.uint8)
    detection = DocumentDetection(
        found=True,
        quad=tuple((float(x), float(y)) for x, y in quad),  # type: ignore[arg-type]
        method="contour",
        rectified_size=(width, height),
        aspect_ratio=width / height,
        area_ratio=0.6,
    )
    return upload, DocumentResult(detection=detection, rectified=rectified)


def only_on(target: Image) -> Callable[[Image], list[Barcode]]:
    """A ``decode_barcodes`` that reads only ``target`` (the other image yields nothing)."""
    real = barcode.decode_barcodes

    def fake(img: Image) -> list[Barcode]:
        return real(img) if img is target else []

    return fake


def test_a_barcode_found_only_on_the_rectified_document_is_mapped_to_upload_pixels(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    symbol = pdf417(PAYLOAD)
    upload, doc = on_canvas(symbol)
    assert doc.rectified is not None
    monkeypatch.setattr(barcode, "decode_barcodes", only_on(doc.rectified))

    (found,) = decode_side_barcodes(upload, doc)

    assert payload_bytes(found) == PAYLOAD.encode("latin-1")
    # Mapped back through the document's quad, the corners land where the symbol's corners are
    # on the upload (zxing-cpp's own quad on a perspective upload only approximates them).
    assert_quad_near(found.quad, symbol_corners_on_canvas(symbol), tolerance=3.0)


def test_a_degenerate_document_quad_maps_nothing_back_to_the_upload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    upload, doc = on_canvas(pdf417(PAYLOAD))
    assert doc.rectified is not None
    point = (5.0, 5.0)
    degenerate = DocumentResult(
        detection=doc.detection.model_copy(update={"quad": (point, point, point, point)}),
        rectified=doc.rectified,
    )
    monkeypatch.setattr(barcode, "decode_barcodes", only_on(doc.rectified))
    # Only the second pass's mapping is under test: the PDF417 recovery (Phase 12A V1), which
    # would find the symbol this fake hides on the upload, is left out.
    monkeypatch.setattr(barcode, "recover_pdf417", lambda img, document: None)

    assert decode_side_barcodes(upload, degenerate) == []


def test_a_barcode_both_passes_find_is_reported_once_with_its_upload_quad() -> None:
    upload, doc = on_canvas(pdf417(PAYLOAD))
    (on_upload,) = decode_barcodes(upload)

    assert decode_side_barcodes(upload, doc) == [on_upload]


def test_without_a_rectified_document_only_the_upload_is_read(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[Image] = []

    def fake(img: Image) -> list[Barcode]:
        seen.append(img)
        return []

    monkeypatch.setattr(barcode, "decode_barcodes", fake)
    image = card()

    assert decode_side_barcodes(image, not_found()) == []
    assert len(seen) == 1
    assert seen[0] is image


def test_the_side_never_reports_more_than_eight_barcodes(monkeypatch: pytest.MonkeyPatch) -> None:
    def many(img: Image) -> list[Barcode]:
        tag = "U" if img.shape[1] == 300 else "R"
        return [
            Barcode(
                format="QR Code",
                bytes_b64=base64.b64encode(f"{tag}{i}".encode()).decode(),
                text=f"{tag}{i}",
                quad=((0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)),
            )
            for i in range(6)
        ]

    monkeypatch.setattr(barcode, "decode_barcodes", many)
    image = np.full((200, 300, 3), 255, dtype=np.uint8)
    rectified = full_frame(np.full((100, 158, 3), 255, dtype=np.uint8))
    doc = DocumentResult(
        detection=full_frame(image).detection.model_copy(update={"rectified_size": (158, 100)}),
        rectified=rectified.rectified,
    )

    found = decode_side_barcodes(image, doc)

    assert len(found) == MAX_BARCODES
    assert [b.text for b in found[:6]] == [f"U{i}" for i in range(6)]


# --- composition --------------------------------------------------------------------------------


class NoFaces:
    def load(self) -> None:
        pass

    def detect(self, img: Image) -> list[Face]:
        return []


class NoEmbedding:
    def load(self) -> None:
        pass

    def embed(self, img: Image, face: Face) -> Any:
        raise AssertionError("no face, no embedding")


def test_the_side_analysis_reads_barcodes_on_the_upload_and_the_rectified_document(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    upload, doc = on_canvas(pdf417(PAYLOAD))
    seen: list[Image] = []
    real = barcode.decode_barcodes

    def spy(img: Image) -> list[Barcode]:
        seen.append(img)
        return real(img)

    no_mrz = MrzReading(found=False, format_guess=None, lines=[], line_confidences=[], box=None)
    monkeypatch.setattr(document, "detect_document", lambda img: doc)
    monkeypatch.setattr(ocr.OcrEngine, "read_text", lambda self, img: list[TextLine]())
    monkeypatch.setattr(mrz_locate, "locate_mrz", lambda img, reader: no_mrz)
    monkeypatch.setattr(barcode, "decode_barcodes", spy)
    settings = Settings.model_validate({"service_token": "s" * 40, "models_dir": tmp_path})

    side = analyze_government_id_side(
        jpeg(upload, 90),
        upload,
        FaceEngine(NoFaces(), NoEmbedding(), long_sides=(10_000,)),
        ocr.OcrEngine.from_settings(settings),
        QualityThresholds(),
        front=False,
    )

    assert [img is upload for img in seen] == [True, False]
    assert seen[1] is doc.rectified
    assert [payload_bytes(b) for b in side.barcodes] == [PAYLOAD.encode("latin-1")]
