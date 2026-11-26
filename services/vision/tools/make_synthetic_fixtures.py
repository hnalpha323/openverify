"""Generate the e2e and real-model test assets from the fetched public-domain faces.

Inputs are the photos listed in ``fixtures/manifest.json`` (fetch them first with
``python3 scripts/fetch_fixtures.py``); each one is checked against its pinned SHA-256.
Outputs, all written to the gitignored ``fixtures/generated/``:

- ``id-front.jpg``: synthetic TD1 card front with person A's ID portrait;
- ``id-back.jpg``: synthetic card back with the TD1 machine-readable zone;
- ``selfie-a.jpg`` and ``selfie-a.y4m``: person A's other photo framed as a VGA selfie, as a
  still and as a Chromium fake-camera clip;
- ``selfie-b.jpg`` and ``selfie-b.y4m``: the same for person B (negative face-match case);
- ``variants/<name>-front.jpg`` and ``variants/<name>-back.jpg``: every C36 variant of the card
  (``synthetic_variants``), each built to trip one check, plus the TD3 passport page and the
  MRV-A visa; person B's photo is the swapped-in portrait;
- ``aamva/<vector id>.png``: every payload of ``contracts/fixtures/aamva/`` as a barcode-only
  PDF417 on a plain background, never on a card;
- ``variants.json``: per variant its group, the checks it must trip and, per side, the file and
  what it shows (fields, printed text, MRZ lines, document corners, JPEG quality); per AAMVA
  vector its file;
- ``selfie/``: the C45.2 selfie set of :mod:`synthetic_selfie` (pipeline fixtures, not
  attack-detection rates): head-turn MJPEG clips of persons A and B following
  ``contracts/fixtures/flow/selfie-capture.json``, their still triples, the static replay,
  screen, phone and print spoofs, covering and glasses composites, and ``selfie/index.json``.
  It needs YuNet and MediaPipe's canonical face mesh from ``models/`` (``--models``; fetch them
  with ``python3 scripts/fetch_models.py``);
- ``poa/`` (Phase 5, C65.2): the proof-of-address main set of :mod:`synthetic_poa` (each class
  in English and Spanish as a PDF and a photo, the date cases, the password cases, every edited
  and genuine variant) and, under ``poa/hostile/``, the hostile set; a JSON sidecar beside each
  file (``<name>.json``) and ``poa/index.json`` holding them all;
- ``poa-held-out/`` (C60.7): the held-out set, the pinned federal forms filled with synthetic
  values among it (fetch them with ``python3 scripts/fetch_fixtures.py``), with its sidecars and
  ``poa-held-out/index.json`` (counts by label, language and form);
- ``nfc/`` (C65.3): ``td3-passport.jpg`` (the TD3 data page, as ``variants/``) with its MRZ
  record ``td3-passport.json`` (DG1's 88-character MRZ), and person A's chip portrait framed as
  the page frames it, ``person-a-portrait.jp2`` and ``person-a-portrait-codestream.j2k``, each
  with its sidecar;
- ``.generator-version``: :func:`generator_stamp`, written last, so a stamp means a complete
  set from this version of the generator, these capture constants and this day.

Everything is deterministic: the same inputs and day give the same bytes. The documents are
current on ``--as-of`` (default: today in UTC), so the stamp names the day and the e2e setup
regenerates once a day.

Usage::

    cd services/vision && uv run python tools/make_synthetic_fixtures.py
    cd services/vision && uv run python tools/make_synthetic_fixtures.py --print-version
    cd services/vision && uv run python tools/make_synthetic_fixtures.py --as-of 2026-10-24
"""

from __future__ import annotations

import argparse
import functools
import hashlib
import json
import shutil
import sys
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any, Final

import cv2
import numpy as np
from PIL import Image, ImageOps

from fake_camera import Frame, selfie_frames, write_y4m
from head_turn import (
    CONSTANTS_PATH,
    CaptureConstants,
    ClipError,
    ModelKit,
    SelfieKit,
    load_capture_constants,
)
from openverify_vision.faces import ModelNotAvailableError
from synthetic_aamva import load_vectors, render_barcode
from synthetic_id import FaceBox
from synthetic_poa import (
    COVERED_LANGUAGES,
    FederalForm,
    Fixture,
    held_out_set,
    hostile_set,
    main_set,
)
from synthetic_selfie import SELFIE_DIR, generate_selfie_set
from synthetic_selfie import FixtureError as SelfieFixtureError
from synthetic_selfie import Source as SelfieSource
from synthetic_travel import encode_jpeg2000, passport_portrait, td3_record
from synthetic_variants import Portrait, Side, Variant, c36_variants

REPO_ROOT: Final = Path(__file__).resolve().parents[3]
DEFAULT_MANIFEST: Final = REPO_ROOT / "fixtures" / "manifest.json"
DEFAULT_OUT: Final = REPO_ROOT / "fixtures" / "generated"
DEFAULT_MODELS: Final = REPO_ROOT / "models"
JPEG_QUALITY: Final = 92

GENERATOR_VERSION: Final = 7
"""Bump on every change to what this script writes. ``e2e/setup/stack.ts`` compares it with the
stamp in ``fixtures/generated/`` and regenerates on a mismatch, so no run keeps an old card.

1. The Phase 1 card (SAMPLE, SPEC12345, specimen banner).
2. The C36 happy-path card: a fictional holder and no specimen marker.
3. The C36 variants, the AAMVA barcode-only images and ``variants.json``.
4. Each side names its portrait photo; the screen recapture keeps the display's brightness.
5. The specimen-stamped card also prints the SPECIMEN - NOT A REAL DOCUMENT banner, and the
   specimen-overprint variant keeps the stamp alone.
6. The C45.2 selfie set in ``selfie/`` (Workflow 4A). From this version the stamp also names the
   capture constants' digest (:func:`generator_stamp`), so editing them regenerates the clips.
7. Phase 5: the proof-of-address main, hostile and held-out sets (``poa/``, ``poa-held-out/``)
   and the chip's inputs (``nfc/``). The stamp also names the day the documents are current
   on, so a stamp from another day regenerates them."""

STAMP_NAME: Final = ".generator-version"
"""Written into the output directory after every asset, holding :func:`generator_stamp`."""

POA_DIR: Final = "poa"
"""C65.2: the proof-of-address main set and, under ``hostile/``, the hostile set."""

HELD_OUT_DIR: Final = "poa-held-out"
"""C60.7: the held-out documents."""

NFC_DIR: Final = "nfc"
"""C65.3: person A's chip portrait (JP2 and J2K) and the TD3 page with its MRZ record."""

SET_INDEX: Final = "index.json"
"""Every sidecar of a set's directory, in one file."""

FORMS_DIR: Final = "federal-forms"
"""Where ``scripts/fetch_fixtures.py`` puts the pinned federal forms, under ``generated/``."""

VARIANTS_DIR: Final = "variants"
"""C36 variants other than the happy pair: ``<name>-front.jpg`` and ``<name>-back.jpg``."""

AAMVA_DIR: Final = "aamva"
"""Barcode-only PDF417 images of ``contracts/fixtures/aamva/``: ``<vector id>.png``."""

INDEX_NAME: Final = "variants.json"
"""What every generated document shows and which checks it must trip."""

OUTPUTS: Final = (
    "id-front.jpg",
    "id-back.jpg",
    "selfie-a.jpg",
    "selfie-a.y4m",
    "selfie-b.jpg",
    "selfie-b.y4m",
)


class FixtureError(Exception):
    """An input face is missing or does not match its pin."""


class ManifestShapeError(Exception):
    """The manifest lacks a face this generator needs."""


@dataclass(frozen=True, slots=True)
class Source:
    name: str
    filename: str
    sha256: str
    face_box: FaceBox


def _select(faces: list[dict[str, Any]], person: str, role: str) -> Source:
    for face in faces:
        if face.get("person") == person and face.get("role") == role:
            x, y, w, h = (int(v) for v in face["face_box"])
            return Source(face["name"], face["filename"], face["sha256"], (x, y, w, h))
    raise ManifestShapeError(f"manifest has no {role} photo of person {person}")


def _load(source: Source, faces_dir: Path) -> Image.Image:
    path = faces_dir / source.filename
    if not path.is_file():
        raise FixtureError(f"{path} is missing; run python3 scripts/fetch_fixtures.py first")
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != source.sha256:
        raise FixtureError(f"{path} does not match its pinned sha256; fetch it again")
    with Image.open(path) as image:
        return ImageOps.exif_transpose(image).convert("RGB")


def _save_jpeg(image: Image.Image, path: Path) -> None:
    image.save(path, format="JPEG", quality=JPEG_QUALITY)


def _bgr(image: Image.Image) -> Frame:
    return np.ascontiguousarray(cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR))


def _selfie(source: Source, faces_dir: Path, stem: Path, *, fps: int, count: int) -> None:
    """Write ``<stem>.jpg`` (first frame) and ``<stem>.y4m`` (the whole clip)."""
    frames = selfie_frames(_bgr(_load(source, faces_dir)), source.face_box, count=count)
    still = Image.fromarray(cv2.cvtColor(frames[0], cv2.COLOR_BGR2RGB))
    _save_jpeg(still, stem.with_suffix(".jpg"))
    write_y4m(stem.with_suffix(".y4m"), frames, fps=fps)


HAPPY_FILES: Final = {"front": "id-front.jpg", "back": "id-back.jpg"}
"""The happy card keeps the file names the e2e suite has always used."""


def side_file(variant: Variant, side: str) -> str:
    """Where ``variant``'s ``side`` is written, relative to the output directory."""
    if variant.name == "happy":
        return HAPPY_FILES[side]
    return f"{VARIANTS_DIR}/{variant.name}-{side}.jpg"


def side_entry(side: Side, file: str) -> dict[str, Any]:
    """The index entry of one side: its file and what it shows."""
    return {"file": file, **side.truth()}


def _write_variants(variants: Sequence[Variant], out: Path) -> tuple[list[Path], list[Any]]:
    written: list[Path] = []
    entries: list[Any] = []
    (out / VARIANTS_DIR).mkdir()
    for variant in variants:
        sides: dict[str, Any] = {}
        for name, side in (("front", variant.front), ("back", variant.back)):
            if side is None:
                sides[name] = None
                continue
            file = side_file(variant, name)
            (out / file).write_bytes(side.encode())
            written.append(out / file)
            sides[name] = side_entry(side, file)
        entries.append(
            {
                "name": variant.name,
                "group": variant.group,
                "expect": list(variant.expect),
                "description": variant.description,
                "sides": sides,
            }
        )
    return written, entries


def _write_barcodes(out: Path) -> tuple[list[Path], list[Any]]:
    written: list[Path] = []
    entries: list[Any] = []
    (out / AAMVA_DIR).mkdir()
    for vector in load_vectors():
        file = f"{AAMVA_DIR}/{vector.id}.png"
        render_barcode(vector.payload).save(out / file, format="PNG")
        written.append(out / file)
        entries.append({"id": vector.id, "valid": vector.valid, "file": file})
    return written, entries


def portraits(manifest: Path, faces_dir: Path) -> tuple[Portrait, Portrait]:
    """Person A's ID portrait and person B's photo (the swapped-in face), checked against their
    pins. Raises :class:`ManifestShapeError` or :class:`FixtureError`."""
    faces = json.loads(manifest.read_text(encoding="utf-8"))["faces"]
    id_portrait = _select(faces, "A", "id_portrait")
    other = _select(faces, "B", "selfie")
    return (
        Portrait(_load(id_portrait, faces_dir), id_portrait.face_box, id_portrait.name),
        Portrait(_load(other, faces_dir), other.face_box, other.name),
    )


def selfie_sources(manifest: Path, faces_dir: Path) -> tuple[SelfieSource, SelfieSource]:
    """Person A's and person B's selfie photos (BGR), checked against their pins. Raises
    :class:`ManifestShapeError` or :class:`FixtureError`."""
    faces = json.loads(manifest.read_text(encoding="utf-8"))["faces"]
    people = (_select(faces, "A", "selfie"), _select(faces, "B", "selfie"))
    a, b = (
        SelfieSource(source.name, person, _bgr(_load(source, faces_dir)), source.face_box)
        for source, person in zip(people, ("A", "B"), strict=True)
    )
    return a, b


# --- Phase 5: the document sets and the chip's inputs -------------------------------------------

SIDECAR_SUFFIX: Final = ".json"

POA_INDEX_NOTES: Final = {
    "expect_assumes": (
        "a step accepting the five classes, the template's default check config (C51.3), an "
        "inquiry prefilled with each file's inquiry_fields, and the check run on its read_on day"
    ),
    "reasons_semantics": (
        "document_fabrication_detection: the reasons a failure must include (the strong cues); "
        "every other check: its reasons exactly; a null status is left open by C60.6"
    ),
}


def federal_forms(document: dict[str, Any], forms_dir: Path) -> list[FederalForm]:
    """The manifest's pinned federal forms, read from ``forms_dir`` and checked against their
    pins. Raises :class:`ManifestShapeError` or :class:`FixtureError`."""
    entries = document.get("forms") or []
    if not entries:
        raise ManifestShapeError("manifest has no federal forms (C60.7)")
    forms = []
    for entry in entries:
        path = forms_dir / entry["filename"]
        if not path.is_file():
            raise FixtureError(f"{path} is missing; run python3 scripts/fetch_fixtures.py first")
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != entry["sha256"]:
            raise FixtureError(f"{path} does not match its pinned sha256; fetch it again")
        forms.append(FederalForm(entry["form"], data, tuple(entry["pages"])))
    return forms


@functools.lru_cache(maxsize=2)
def _poa_fixtures(day: date) -> tuple[Fixture, ...]:
    """The main and hostile sets: pure functions of the day, built once per process and day."""
    return (*main_set(day), *hostile_set())


@functools.lru_cache(maxsize=2)
def _held_out_fixtures(
    day: date, forms: tuple[FederalForm, ...], identity: tuple[tuple[str, bytes], ...]
) -> tuple[Fixture, ...]:
    return tuple(held_out_set(day, forms, dict(identity)))


def _json(document: Any) -> str:
    return json.dumps(document, indent=2, ensure_ascii=False) + "\n"


def _write_set(
    directory: Path, fixtures: Sequence[Fixture], *, as_of: date, extra: dict[str, Any]
) -> list[Path]:
    """Each file and its sidecar (``<name>.json`` beside it), then the set's index."""
    written: list[Path] = []
    for fixture in fixtures:
        target = directory / fixture.path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(fixture.data)
        sidecar = target.with_suffix(SIDECAR_SUFFIX)
        sidecar.write_text(_json(fixture.sidecar), encoding="utf-8")
        written += [target, sidecar]
    index = {
        "schema_version": 1,
        "generator_version": GENERATOR_VERSION,
        "as_of": as_of.isoformat(),
        **extra,
        "files": [fixture.sidecar for fixture in fixtures],
    }
    (directory / SET_INDEX).write_text(_json(index), encoding="utf-8")
    return [*written, directory / SET_INDEX]


def _write_held_out(directory: Path, fixtures: Sequence[Fixture], as_of: date) -> list[Path]:
    def counts(key: str) -> dict[str, int]:
        return dict(sorted(Counter(str(f.sidecar[key]) for f in fixtures).items()))

    extra = {
        "covered_languages": list(COVERED_LANGUAGES),
        "counts": {
            "by_label": counts("label"),
            "by_language": counts("language"),
            "by_form": counts("form"),
            "by_layout": counts("layout"),
        },
        "answer_semantics": (
            "expected_answer is what C60.5 should answer (unknown for a language the lexicons do "
            "not cover); acceptable_answers lists every answer that is not an error; label is "
            "the truth"
        ),
    }
    return _write_set(directory, fixtures, as_of=as_of, extra=extra)


def _write_nfc(directory: Path, portrait: Portrait, td3_page: Side) -> list[Path]:
    """The TD3 data page with its MRZ record, and person A's chip portrait as the page frames it
    (a JP2 file and a bare J2K codestream), each with its sidecar."""
    directory.mkdir(parents=True)
    page = td3_page.encode()
    portrait_name = "person-a-portrait.jp2"
    records: list[tuple[str, bytes, dict[str, Any]]] = [
        (
            "td3-passport.jpg",
            page,
            {
                "media_type": "image/jpeg",
                "portrait": {"file": f"{NFC_DIR}/{portrait_name}", "source": portrait.name},
                **td3_record(),
            },
        )
    ]
    image = passport_portrait(portrait.photo, portrait.face_box)
    for name, codestream, media_type in (
        (portrait_name, False, "image/jp2"),
        ("person-a-portrait-codestream.j2k", True, "image/j2k"),
    ):
        records.append(
            (
                name,
                encode_jpeg2000(image, codestream=codestream),
                {
                    "media_type": media_type,
                    "width": image.width,
                    "height": image.height,
                    "source": portrait.name,
                    "framing": "the TD3 data page's 3:4 portrait framing",
                },
            )
        )
    written: list[Path] = []
    for name, data, record in records:
        target = directory / name
        target.write_bytes(data)
        sidecar = {
            "schema_version": 1,
            "file": f"{NFC_DIR}/{name}",
            "sha256": hashlib.sha256(data).hexdigest(),
            **record,
        }
        target.with_suffix(SIDECAR_SUFFIX).write_text(_json(sidecar), encoding="utf-8")
        written += [target, target.with_suffix(SIDECAR_SUFFIX)]
    return written


def generator_stamp(constants: CaptureConstants, as_of: date) -> str:
    """What ``--print-version`` prints and the stamp holds: :data:`GENERATOR_VERSION` and the
    first 12 hex digits of the capture constants' SHA-256 (the clips follow that file)."""
    return f"{GENERATOR_VERSION}+{constants.sha256[:12]}+{as_of.isoformat()}"


def today() -> date:
    """The day of the run, in UTC: the documents' dates are relative to it."""
    return datetime.now(UTC).date()


def generate(  # noqa: PLR0913 - the inputs, the two clip options and the selfie set's two
    manifest: Path,
    faces_dir: Path,
    out: Path,
    *,
    fps: int,
    seconds: float,
    kit: SelfieKit,
    constants: CaptureConstants,
    as_of: date | None = None,
    forms_dir: Path | None = None,
) -> list[Path]:
    """Write every output to ``out`` (see the module docstring) and return their paths."""
    day = as_of if as_of is not None else today()
    document = json.loads(manifest.read_text(encoding="utf-8"))
    faces = document["faces"]
    _select(faces, "A", "id_portrait")  # fail on the manifest's shape before writing anything
    selfie_a = _select(faces, "A", "selfie")
    selfie_b = _select(faces, "B", "selfie")
    count = max(1, round(fps * seconds))

    out.mkdir(parents=True, exist_ok=True)
    # A stamp claims a complete set from this version: drop it until every asset is written.
    (out / STAMP_NAME).unlink(missing_ok=True)
    forms = federal_forms(document, forms_dir or manifest.parent / "generated" / FORMS_DIR)
    # The generator owns these: nothing an older version wrote there may survive.
    for directory in (VARIANTS_DIR, AAMVA_DIR, SELFIE_DIR, POA_DIR, HELD_OUT_DIR, NFC_DIR):
        shutil.rmtree(out / directory, ignore_errors=True)
    portrait, other = portraits(manifest, faces_dir)
    every_variant = c36_variants(portrait, other)
    variants, variant_entries = _write_variants(every_variant, out)
    _selfie(selfie_a, faces_dir, out / "selfie-a", fps=fps, count=count)
    _selfie(selfie_b, faces_dir, out / "selfie-b", fps=fps, count=count)
    barcodes, barcode_entries = _write_barcodes(out)
    selfies, _ = generate_selfie_set(selfie_sources(manifest, faces_dir), kit, constants, out)
    index = {
        "generator_version": GENERATOR_VERSION,
        "variants": variant_entries,
        "aamva": barcode_entries,
    }
    (out / INDEX_NAME).write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")
    by_name = {variant.name: variant for variant in every_variant}
    td3_page, td1_front = by_name["td3-passport"].front, by_name["happy"].front
    identity = (("td1-card", td1_front.encode()), ("td3-passport", td3_page.encode()))
    documents = [
        *_write_set(out / POA_DIR, _poa_fixtures(day), as_of=day, extra=POA_INDEX_NOTES),
        *_write_held_out(out / HELD_OUT_DIR, _held_out_fixtures(day, tuple(forms), identity), day),
        *_write_nfc(out / NFC_DIR, portrait, td3_page),
    ]
    (out / STAMP_NAME).write_text(f"{generator_stamp(constants, day)}\n", encoding="utf-8")
    outputs = [out / name for name in OUTPUTS]
    extra = [path for path in variants if path not in outputs]
    return [*outputs, *extra, *barcodes, out / INDEX_NAME, *selfies, *documents]


def main(argv: Sequence[str] | None = None, *, kit: SelfieKit | None = None) -> int:
    """The command line; ``kit`` replaces YuNet and the mesh (tests), else ``--models`` has them."""
    parser = argparse.ArgumentParser(description="Generate synthetic ID and fake-camera assets.")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument(
        "--faces", type=Path, default=None, help="photo directory (default: <manifest dir>/faces)"
    )
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--fps", type=int, default=15, help="the Y4M clips' frame rate")
    parser.add_argument("--seconds", type=float, default=2.0, help="the Y4M clips' length")
    parser.add_argument(
        "--models", type=Path, default=DEFAULT_MODELS, help="YuNet and the canonical face mesh"
    )
    parser.add_argument(
        "--constants",
        type=Path,
        default=CONSTANTS_PATH,
        help="the C40.11 capture constants the head-turn clips follow",
    )
    parser.add_argument(
        "--as-of",
        type=date.fromisoformat,
        default=None,
        help="the day the documents are current on (default: today in UTC)",
    )
    parser.add_argument(
        "--forms",
        type=Path,
        default=None,
        help="the pinned federal forms (default: <manifest dir>/generated/federal-forms)",
    )
    parser.add_argument(
        "--print-version", action="store_true", help="print the generator stamp and exit"
    )
    args = parser.parse_args(argv)
    constants = load_capture_constants(args.constants)
    as_of: date = args.as_of if args.as_of is not None else today()
    if args.print_version:
        print(generator_stamp(constants, as_of))
        return 0
    faces_dir: Path = args.faces if args.faces is not None else args.manifest.parent / "faces"

    try:
        chosen = (
            kit
            if kit is not None
            else ModelKit.from_models(args.models, preview_width=constants.preview_width_px)
        )
        written = generate(
            args.manifest,
            faces_dir,
            args.out,
            fps=args.fps,
            seconds=args.seconds,
            kit=chosen,
            constants=constants,
            as_of=as_of,
            forms_dir=args.forms,
        )
    except ManifestShapeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except (FixtureError, SelfieFixtureError, ClipError, ModelNotAvailableError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    for path in written:
        print(f"wrote {path} ({path.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised through main()
    raise SystemExit(main())
