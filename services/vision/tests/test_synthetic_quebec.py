"""The Quebec-format synthetic driver licence of Phase 12A (``tools/synthetic_quebec.py``).

Every value is invented: the holder is fictional, the card carries the SPECIMEN marker and the
OpenVerify synthetic banner, and its PDF417 payload carries the ``ZQ`` synthetic-data subfile.
These tests pin what the three Stage 2 agents of Workflow 12A rely on: the printed lines and
their boxes, the AAMVA payload, the barcode's decodability at card scale, the phone-capture
degradations, and the committed fixture files under ``contracts/fixtures/quebec-dl/``.
"""

from __future__ import annotations

import io
import json
import re
from datetime import date
from pathlib import Path

import cv2
import numpy as np
import pytest
import zxingcpp
from PIL import Image

from synthetic_quebec import (
    AAMVA_MARKER,
    BACKS,
    CAPTURES,
    CARD_MM,
    FIXTURE_DIR,
    HAPPY_HOLDER,
    HAPPY_LICENCE,
    QUEBEC_IIN,
    Capture,
    QuebecHolder,
    aamva_cases,
    aamva_payload,
    compact_number,
    main,
    ocr_cases,
    photograph,
    render_back,
    render_front,
)

MANDATORY_2020 = frozenset(
    {"DCA", "DCB", "DCD", "DBA", "DCS", "DAC", "DAD", "DBD", "DBB", "DBC", "DAY"}
    | {"DAU", "DAG", "DAI", "DAJ", "DAK", "DAQ", "DCF", "DCG", "DDE", "DDF", "DDG"}
)


def split_payload(payload: str) -> tuple[dict[str, str], dict[str, dict[str, str]]]:
    """A minimal AAMVA reader: the header fields and each subfile's elements, located by the
    designators (so a designator that does not locate its subfile fails the test)."""
    assert payload.startswith("@\n\x1e\r")
    header = {"file_type": payload[4:9], "iin": payload[9:15], "version": payload[15:17]}
    count = int(payload[19:21])
    subfiles: dict[str, dict[str, str]] = {}
    for index in range(count):
        designator = payload[21 + 10 * index : 31 + 10 * index]
        kind, offset, length = designator[:2], int(designator[2:6]), int(designator[6:10])
        body = payload[offset : offset + length]
        assert body.startswith(kind), kind
        assert body.endswith("\r"), kind
        subfiles[kind] = {line[:3]: line[3:] for line in body[2:-1].split("\n")}
    return header, subfiles


def decoded(image: Image.Image | np.ndarray) -> list[bytes]:
    pixels = np.asarray(image.convert("RGB")) if isinstance(image, Image.Image) else image
    results = zxingcpp.read_barcodes(
        pixels,
        formats=zxingcpp.BarcodeFormats(zxingcpp.BarcodeFormat.PDF417),
        text_mode=zxingcpp.TextMode.Plain,
    )
    return [bytes(result.bytes) for result in results]


def laplacian_variance(image: Image.Image) -> float:
    grey = cv2.cvtColor(np.asarray(image.convert("RGB")), cv2.COLOR_RGB2GRAY)
    return float(cv2.Laplacian(grey, cv2.CV_64F).var())


# --- the holder and the AAMVA payload --------------------------------------------------------


def test_the_happy_licence_is_quebec_shaped_and_invented() -> None:
    assert re.fullmatch(r"[A-Z]\d{4}-\d{6}-\d{2}", HAPPY_LICENCE.number)
    assert compact_number(HAPPY_LICENCE.number) == "T123456789012"
    assert HAPPY_HOLDER.surname == "TREMBLAY"
    assert HAPPY_HOLDER.given_names == "MARIE"
    assert re.fullmatch(r"[A-Z]\d[A-Z] \d[A-Z]\d", HAPPY_HOLDER.postal_code)
    assert HAPPY_LICENCE.issue_date < date(2026, 11, 22) < HAPPY_LICENCE.expiry_date
    assert CARD_MM == (85.6, 53.98)


def test_the_payload_follows_aamva_2020_with_the_quebec_iin_and_the_marker() -> None:
    payload = aamva_payload(HAPPY_HOLDER, HAPPY_LICENCE)
    header, subfiles = split_payload(payload)

    assert header == {"file_type": "ANSI ", "iin": QUEBEC_IIN, "version": "10"}
    assert QUEBEC_IIN == "604428"
    dl = subfiles["DL"]
    assert set(dl) >= MANDATORY_2020
    assert dl["DAQ"] == "T123456789012"
    assert dl["DCS"] == "TREMBLAY"
    assert dl["DAC"] == "MARIE"
    # Canada writes CCYYMMDD.
    assert dl["DBB"] == "19900214"
    assert dl["DBD"] == "20210315"
    assert dl["DBA"] == "20290214"
    assert dl["DCG"] == "CAN"
    assert dl["DAJ"] == "QC"
    assert dl["DBC"] == "2"
    assert subfiles["ZQ"] == {"ZQA": AAMVA_MARKER}
    assert AAMVA_MARKER == "OPENVERIFY SYNTHETIC TEST DATA"
    assert payload.isascii()


def test_the_tolerance_payloads_differ_from_the_standard_in_one_way_each() -> None:
    standard = aamva_payload(HAPPY_HOLDER, HAPPY_LICENCE)
    file_type = aamva_payload(HAPPY_HOLDER, HAPPY_LICENCE, file_type="AAMVA")
    printed = aamva_payload(HAPPY_HOLDER, HAPPY_LICENCE, printed_number=True)
    shifted = aamva_payload(HAPPY_HOLDER, HAPPY_LICENCE, offset_shift=2)
    older = aamva_payload(HAPPY_HOLDER, HAPPY_LICENCE, version=8)

    assert file_type[4:9] == "AAMVA"
    assert file_type[9:] == standard[9:]
    assert split_payload(printed)[1]["DL"]["DAQ"] == "T1234-567890-12"
    # Same bytes after the designators; only the DL designator's offset is off by two.
    assert shifted != standard
    assert shifted[31:] == standard[31:]
    with pytest.raises(AssertionError):
        split_payload(shifted)
    assert split_payload(older)[0]["version"] == "08"


def test_the_aamva_cases_carry_their_expected_fields() -> None:
    cases = aamva_cases()
    ids = [case["id"] for case in cases]

    assert len(ids) == len(set(ids))
    assert set(ids) >= {
        "qc-v10",
        "qc-file-type-aamva",
        "qc-printed-number",
        "qc-offset-shift",
        "qc-v08",
    }
    for case in cases:
        assert AAMVA_MARKER in case["payload"]
        assert case["expected"]["identification-number"] == "T123456789012"
        assert case["expected"]["birthdate"] == "1990-02-14"
        assert case["expected"]["expiration-date"] == "2029-02-14"
        assert case["expected"]["name-last"] == "TREMBLAY"
        assert case["expected"]["name-first"] == "MARIE"


# --- the card --------------------------------------------------------------------------------


def test_the_front_prints_the_quebec_lines_with_their_boxes() -> None:
    side = render_front()
    width, height = side.image.size
    roles = {line.role: line for line in side.lines}

    assert (width, height) == (round(85.6 * 12), round(53.98 * 12))
    assert roles["number"].text == "T1234-567890-12"
    assert roles["name-last"].text == "TREMBLAY"
    assert roles["name-first"].text == "MARIE"
    assert roles["birthdate"].text == "DATE DE NAISSANCE (A-M-J): 1990-02-14"
    assert roles["issue-date"].text == "DELIVRE LE 2021-03-15"
    assert roles["expiration-date"].text == "EXPIRE LE 2029-02-14"
    assert roles["sex"].text == "SEXE: F"
    assert roles["address-city"].text.endswith("QC H0H 0H0")
    # The two name lines sit just under the number, surname first.
    assert roles["number"].box[1] < roles["name-last"].box[1] < roles["name-first"].box[1]
    for line in side.lines:
        x, y, w, h = line.box
        assert min(x, y) >= 0
        assert x + w <= width
        assert y + h <= height
        assert min(w, h) > 0
    texts = " ".join(line.text for line in side.lines)
    assert "SPECIMEN" in texts
    assert "OPENVERIFY SYNTHETIC TEST CARD" in texts
    assert side.barcode_box is None


def test_the_front_can_leave_out_the_field_numbers_and_the_quebec_header() -> None:
    numbered = {line.role for line in render_front().lines}
    plain = render_front(field_numbers=False, issuer="UTOPIA")

    assert "field-number" in numbered
    assert "field-number" not in {line.role for line in plain.lines}
    assert all("QU" not in line.text for line in plain.lines if line.role == "header")


def test_the_back_barcode_decodes_to_the_payload_at_card_scale() -> None:
    payload = aamva_payload(HAPPY_HOLDER, HAPPY_LICENCE)
    side = render_back()

    assert side.payload == payload
    assert side.barcode_box is not None
    assert decoded(side.image) == [payload.encode("ascii")]
    assert {"standard", "dense"} <= set(BACKS)
    dense = render_back(back="dense", px_per_mm=20.0)
    assert decoded(dense.image) == [payload.encode("ascii")]


def test_a_holder_change_reaches_the_lines_and_the_payload() -> None:
    holder = QuebecHolder(surname="GAGNON", given_names="LUC", sex="M")
    front = render_front(holder)
    back = render_back(holder)

    assert {line.text for line in front.lines} >= {"GAGNON", "LUC", "SEXE: M"}
    assert back.payload is not None
    assert "\nDCSGAGNON\n" in back.payload
    assert "\nDBC1\n" in back.payload


# --- phone captures --------------------------------------------------------------------------


def test_the_captures_cover_the_phone_degradations() -> None:
    assert {
        "flat",
        "phone-1080",
        "phone-1080-soft",
        "phone-1080-blur",
        "phone-1080-motion",
        "phone-1080-tilt",
        "phone-1080-glare",
        "phone-1080-q75",
        "phone-full",
    } <= set(CAPTURES)
    assert CAPTURES["phone-1080"].frame == (1080, 1920)
    assert CAPTURES["phone-full"].frame == (3024, 4032)


def test_a_photograph_is_deterministic_and_records_its_truth() -> None:
    first = photograph("back", CAPTURES["phone-1080"])
    second = photograph("back", CAPTURES["phone-1080"])

    assert first.jpeg == second.jpeg
    assert first.image.size == (1080, 1920)
    with Image.open(io.BytesIO(first.jpeg)) as image:
        assert image.format == "JPEG"
        assert image.size == (1080, 1920)
    for x, y in first.quad:
        assert 0 <= x <= 1080
        assert 0 <= y <= 1920
    truth = first.truth()
    assert truth["capture"]["name"] == "phone-1080"
    assert truth["side"] == "back"
    assert truth["payload"] == aamva_payload(HAPPY_HOLDER, HAPPY_LICENCE)
    assert 2.0 < truth["module_px"] < 4.0
    assert 900 < truth["card_width_px"] < 1000
    assert len(truth["lines"]) > 0
    json.dumps(truth)


def test_blur_jpeg_and_resolution_degrade_as_named() -> None:
    sharp = photograph("front", CAPTURES["phone-1080"])
    soft = photograph("front", CAPTURES["phone-1080-soft"])
    blurred = photograph("front", CAPTURES["phone-1080-blur"])
    low_quality = photograph("front", CAPTURES["phone-1080-q75"])
    full = photograph("front", CAPTURES["phone-full"])

    assert laplacian_variance(sharp.image) > laplacian_variance(soft.image)
    assert laplacian_variance(soft.image) > laplacian_variance(blurred.image)
    assert len(low_quality.jpeg) < len(sharp.jpeg)
    assert full.image.size == (3024, 4032)
    assert full.truth()["card_width_px"] > 2 * sharp.truth()["card_width_px"]


def test_the_flat_back_decodes_and_glare_covers_part_of_the_barcode() -> None:
    payload = aamva_payload(HAPPY_HOLDER, HAPPY_LICENCE).encode("ascii")
    flat = photograph("back", CAPTURES["flat"])
    glare = photograph("back", CAPTURES["phone-1080-glare"])

    assert decoded(flat.image) == [payload]
    bright = np.asarray(glare.image.convert("L")) >= 250
    assert bright.mean() > 0.005


def test_a_custom_capture_and_holder_are_accepted() -> None:
    capture = Capture(name="custom", frame=(720, 1280), card_width_share=0.8, seed=7)
    photo = photograph("front", capture, holder=QuebecHolder(surname="ROY"))

    assert photo.image.size == (720, 1280)
    assert any(line["text"] == "ROY" for line in photo.truth()["lines"])
    with pytest.raises(ValueError, match="side"):
        photograph("middle", capture)  # type: ignore[arg-type]


# --- OCR-line cases and the committed fixtures -----------------------------------------------


def test_the_ocr_cases_hold_lines_and_the_fields_the_parser_must_read() -> None:
    cases = {case["id"]: case for case in ocr_cases()}

    assert {"printed", "phone-ocr", "labels-unread", "number-confusion", "not-quebec"} <= set(cases)
    for case in cases.values():
        assert case["now"] == "2026-11-22T00:00:00.000Z"
        for line in case["lines"]:
            assert set(line) == {"text", "confidence", "box"}
            assert 0.0 <= line["confidence"] <= 1.0
            assert len(line["box"]) == 4
    phone = cases["phone-ocr"]
    texts = [line["text"] for line in phone["lines"]]
    assert "DATE DE NAISSANCE (A-M-J):1990-0Z-14" in texts
    assert "DELIVRE LE2021-03-15" in texts
    assert not any(re.fullmatch(r"\d{1,2}[a-z]?", text) for text in texts)
    assert phone["expected"] == {
        "identification-number": {"value": "T123456789012", "via": "pattern"},
        "name-last": {"value": "TREMBLAY", "via": "layout"},
        "name-first": {"value": "MARIE", "via": "layout"},
        "birthdate": {"value": "1990-02-14", "via": "label"},
        "issue-date": {"value": "2021-03-15", "via": "label"},
        "expiration-date": {"value": "2029-02-14", "via": "label"},
        "sex": {"value": "F", "via": "label"},
    }
    assert cases["labels-unread"]["expected"]["issue-date"]["via"] == "pattern"
    assert cases["labels-unread"]["expected"]["expiration-date"]["via"] == "pattern"
    assert "T1234-56789O-12" in [line["text"] for line in cases["number-confusion"]["lines"]]
    not_quebec = cases["not-quebec"]
    assert set(not_quebec["absent"]) == {"name-first", "name-last"}
    assert "name-last" not in not_quebec["expected"]


def test_the_committed_fixtures_are_the_generated_ones(tmp_path: Path) -> None:
    assert main(["fixtures", "--out", str(tmp_path)]) == 0
    # Compared as JSON: the committed files are formatted by Prettier afterwards.
    for name in ("ocr-lines.json", "aamva.json"):
        generated = json.loads((tmp_path / name).read_text(encoding="utf-8"))
        committed = json.loads((FIXTURE_DIR / name).read_text(encoding="utf-8"))
        assert generated == committed, f"regenerate {name} (tools/synthetic_quebec.py fixtures)"
    assert main(["fixtures", "--check", "--out", str(FIXTURE_DIR)]) == 0
    (tmp_path / "aamva.json").write_text("{}", encoding="utf-8")
    assert main(["fixtures", "--check", "--out", str(tmp_path)]) == 1


def test_the_images_command_writes_each_capture_with_its_truth(tmp_path: Path) -> None:
    assert main(["images", "--out", str(tmp_path), "--capture", "flat", "phone-1080-q75"]) == 0

    written = sorted(path.name for path in tmp_path.iterdir())
    assert written == [
        "back-flat.jpg",
        "back-phone-1080-q75.jpg",
        "front-flat.jpg",
        "front-phone-1080-q75.jpg",
        "truth.json",
    ]
    truth = json.loads((tmp_path / "truth.json").read_text(encoding="utf-8"))
    assert set(truth) == {"front-flat", "back-flat", "front-phone-1080-q75", "back-phone-1080-q75"}
    assert truth["back-flat"]["payload"].startswith("@\n")


def test_an_unknown_capture_is_refused(tmp_path: Path) -> None:
    with pytest.raises(SystemExit):
        main(["images", "--out", str(tmp_path), "--capture", "nope"])
