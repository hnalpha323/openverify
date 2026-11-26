"""C60.1 (H10): a PDF page's text layer as lines, each visible or not and why, in the child.

PDFium's text page gives every character with its loose box (page points), its text object and
its font. A character is not visible, in this order of reasons, when:

- its render mode paints nothing (3, invisible, or 7, clip only): ``render_mode_invisible``;
- its centre lies outside the page's box: ``off_page``;
- its centre lies outside a clip path of its text object, or of a form that draws it (each
  read as its bounding box): ``clipped``;
- it is under 2 pt high: ``too_small``;
- an opaque fill, image or shading drawn after it covers nine tenths of its box: ``covered``
  (an image only where its own soft mask, stencil or colour-key mask lets it paint);
- its colour is within 8 levels of what lies behind it (the topmost opaque fill under its
  centre, else the white page), or its fill is transparent: ``background_fill``. Text over an
  image or a shading is never judged by colour.

Characters run into lines in content order: a run breaks where the visibility changes, the
character leaves the run's baseline, goes backwards, or follows a gap over two line heights; runs
on one baseline that touch then join. Each line's text is its characters left to right, with a
space where a gap is wider than a quarter of the line height.

Two things are left to the parent's OCR of each visible line's box, which reads the render: an
annotation drawn over text (its appearance is in the render, not in the page's objects), and a
clip made of text (render modes 4 to 7), which PDFium does not expose. Either makes a line the
text layer calls visible read differently, or as nothing, so its agreement falls. Standard
library and pypdfium2 only.
"""

from __future__ import annotations

import ctypes
import math
import sys
from collections import Counter
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any, Final

import pypdfium2.raw as pdfium_c  # type: ignore[import-untyped]  # likewise

from openverify_vision.guarded.protocol import TaskRefusal
from openverify_vision.guarded.text import clip_text

MIN_VISIBLE_HEIGHT_PT: Final = 2.0
"""C60.1: a character under 2 pt high is not visible."""

HIDDEN_REASONS: Final = (
    "render_mode_invisible",
    "off_page",
    "clipped",
    "too_small",
    "covered",
    "background_fill",
)
"""In the order they are tested: the first that holds is the reason."""

MAX_LINES: Final = 600
MAX_LINE_LENGTH: Final = 300
MAX_LINE_FONTS: Final = 16
MAX_FONTS: Final = 256
MAX_FONT_NAME: Final = 128
MAX_CHARS: Final = 60_000
"""Characters read per page; a page beyond it keeps its first lines."""
MAX_PAGE_OBJECTS: Final = 20_000
"""Page objects examined per page for covering fills. A page with more, or with a form nested
deeper than :data:`MAX_FORM_DEPTH` that draws anything, is refused (``pdf_unprocessable``):
past the walk, neither a cover nor a text object's painting order is known, so no line could
be judged (Workflow 5C review P013)."""
MAX_FORM_DEPTH: Final = 8
MAX_SCENE_CHECKS: Final = 2_000_000
"""Workflow 5C review P014: how many character-against-object tests one page may cost. Each
character meets only the opaque objects indexed over its centre, so a page passes far below it
unless its objects lie over most characters without covering them; such a page is refused
(``pdf_unprocessable``) rather than judged for longer than the child's CPU limit."""
INDEX_GRID: Final = 32
"""The page is indexed as this many columns and rows of cells."""
INDEX_LARGE_CELLS: Final = 32
"""An object over more cells than this is kept apart and met by every character: a large
background or band, of which a page has few."""
OPAQUE_ALPHA: Final = 248
"""Workflow 5C review P015: a pixel of an image covers what is under it from this alpha up
(within 8 levels of opaque, as the colours are compared)."""
MAX_IMAGE_CHECK_PIXELS: Final = 4_000_000
"""An image larger than this on the page (in points, so pixels at 72 dpi) is not rendered to
read its own mask, and covers as an image without one does."""

COVERED_SHARE: Final = 0.9
COLOUR_TOLERANCE: Final = 8
TRANSPARENT_ALPHA: Final = 8
LINE_GAP_HEIGHTS: Final = 2.0
WORD_GAP_HEIGHTS: Final = 0.25

_INVISIBLE_MODES: Final = frozenset({3, 7})
_STROKE_ONLY_MODES: Final = frozenset({1, 5})
_WHITE: Final = (255, 255, 255)
_SUBSET_LENGTH: Final = 6
_PLUS: Final = 7

Box = tuple[float, float, float, float]
"""``(left, bottom, right, top)`` in page points."""


@dataclass
class FontRegistry:
    """The fonts of the analysed pages, numbered in the order they are first met. Two font
    objects of one name (with its subset tag) and embedding are one font."""

    fonts: list[dict[str, Any]] = field(default_factory=list)
    _ids: dict[tuple[str, bool], int] = field(default_factory=dict)
    _handles: dict[int, int | None] = field(default_factory=dict)

    def id_of(self, font: Any) -> int | None:
        """The id of a PDFium font handle; ``None`` past :data:`MAX_FONTS` or for no font."""
        address = ctypes.cast(font, ctypes.c_void_p).value
        if address is None:
            return None
        if address in self._handles:
            return self._handles[address]
        name = _font_name(font)
        embedded = pdfium_c.FPDFFont_GetIsEmbedded(font) == 1
        key = (name, embedded)
        if key not in self._ids and len(self.fonts) < MAX_FONTS:
            tag = None
            base = name
            if len(name) > _PLUS and name[_SUBSET_LENGTH] == "+" and name[:6].isupper():
                tag, base = name[:_SUBSET_LENGTH], name[_PLUS:]
                if not tag.isalpha() or not tag.isascii():
                    tag, base = None, name
            self._ids[key] = len(self.fonts)
            self.fonts.append(
                {
                    "id": len(self.fonts),
                    "base_name": clip_text(base, MAX_FONT_NAME) or "unnamed",
                    "subset_tag": tag,
                    "embedded": embedded,
                }
            )
        self._handles[address] = self._ids.get(key)
        return self._handles[address]


def _font_name(font: Any) -> str:
    length = pdfium_c.FPDFFont_GetBaseFontName(font, None, 0)
    if length <= 0:
        return ""
    buffer = ctypes.create_string_buffer(length)
    pdfium_c.FPDFFont_GetBaseFontName(font, buffer, length)
    return buffer.value.decode("latin-1")


# --- the page's drawn objects, for covering and background -------------------------------------


@dataclass(frozen=True, slots=True)
class _Drawn:
    z: int
    box: Box
    opaque: bool
    fill: tuple[int, int, int] | None
    """The fill colour of an opaque filled path; ``None`` for an image or a shading."""
    image: Any = field(default=None, compare=False)
    """The PDFium image object, whose own mask decides where it paints (P015)."""


Matrix = tuple[float, float, float, float, float, float]
_IDENTITY: Final[Matrix] = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)


def _compose(inner: Matrix, outer: Matrix) -> Matrix:
    a, b, c, d, e, f = inner
    a2, b2, c2, d2, e2, f2 = outer
    return (
        a * a2 + b * c2,
        a * b2 + b * d2,
        c * a2 + d * c2,
        c * b2 + d * d2,
        e * a2 + f * c2 + e2,
        e * b2 + f * d2 + f2,
    )


def _transform(box: Box, matrix: Matrix) -> Box:
    if matrix == _IDENTITY:
        return box
    a, b, c, d, e, f = matrix
    left, bottom, right, top = box
    xs, ys = [], []
    for x, y in ((left, bottom), (right, bottom), (left, top), (right, top)):
        xs.append(a * x + c * y + e)
        ys.append(b * x + d * y + f)
    return (min(xs), min(ys), max(xs), max(ys))


def _bounds(obj: Any) -> Box | None:
    left, bottom, right, top = (ctypes.c_float() for _ in range(4))
    if not pdfium_c.FPDFPageObj_GetBounds(obj, left, bottom, right, top):
        return None
    return (left.value, bottom.value, right.value, top.value)


def _colour(getter: Any, obj: Any) -> tuple[int, int, int, int] | None:
    red, green, blue, alpha = (ctypes.c_uint() for _ in range(4))
    if not getter(obj, red, green, blue, alpha):
        return None
    return (red.value, green.value, blue.value, alpha.value)


def _matrix(obj: Any) -> Matrix:
    matrix = pdfium_c.FS_MATRIX()
    if not pdfium_c.FPDFPageObj_GetMatrix(obj, matrix):
        return _IDENTITY
    return (matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f)


def _drawn_kind(obj: Any, kind: int, transparent: bool) -> tuple[bool, tuple[int, int, int] | None]:
    """Whether ``obj`` hides what is under it, and its fill when it is a filled path."""
    if kind == pdfium_c.FPDF_PAGEOBJ_PATH:
        fill_mode, stroke = ctypes.c_int(), ctypes.c_int()
        if not pdfium_c.FPDFPath_GetDrawMode(obj, fill_mode, stroke) or fill_mode.value == 0:
            return False, None
        colour = _colour(pdfium_c.FPDFPageObj_GetFillColor, obj)
        if colour is None or colour[3] < 255 or transparent:  # noqa: PLR2004 - opaque alpha
            return False, None
        return True, colour[:3]
    if kind in {pdfium_c.FPDF_PAGEOBJ_IMAGE, pdfium_c.FPDF_PAGEOBJ_SHADING}:
        return not transparent, None
    return False, None


@dataclass
class _Scene:
    """Every drawn object in painting order, and the painting position of each text object."""

    drawn: list[_Drawn] = field(default_factory=list)
    text_z: dict[int, int] = field(default_factory=dict)
    clips: dict[int, list[Box]] = field(default_factory=dict)
    count: int = 0

    def walk(
        self, objects: Iterator[Any], matrix: Matrix, depth: int, clips: tuple[Box, ...] = ()
    ) -> None:
        """Record ``objects`` in painting order; past the bounds, refuse the page (P013).
        ``clips`` are the page-space clip boxes of the forms that draw them (P016)."""
        for obj in objects:
            if self.count >= MAX_PAGE_OBJECTS:
                raise TaskRefusal("pdf_unprocessable")
            self.count += 1
            kind = pdfium_c.FPDFPageObj_GetType(obj)
            if kind == pdfium_c.FPDF_PAGEOBJ_FORM:
                if depth >= MAX_FORM_DEPTH:
                    if pdfium_c.FPDFFormObj_CountObjects(obj) > 0:
                        raise TaskRefusal("pdf_unprocessable")
                    continue
                # The clip a form is drawn under clips everything it draws (P016); PDFium
                # gives it in the space the form is drawn in.
                own = tuple(_transform(box, matrix) for box in _clip_boxes(obj))
                inner = _compose(_matrix(obj), matrix)
                self.walk(_form_children(obj), inner, depth + 1, clips + own)
                continue
            z = self.count
            address = ctypes.cast(obj, ctypes.c_void_p).value or 0
            if kind == pdfium_c.FPDF_PAGEOBJ_TEXT:
                self.text_z[address] = z
                own_clips = [_transform(box, matrix) for box in _clip_boxes(obj)]
                self.clips[address] = [*clips, *own_clips]
                continue
            box = _bounds(obj)
            if box is None:
                continue
            transparent = bool(pdfium_c.FPDFPageObj_HasTransparency(obj))
            opaque, fill = _drawn_kind(obj, kind, transparent)
            if opaque:
                image = obj if kind == pdfium_c.FPDF_PAGEOBJ_IMAGE else None
                self.drawn.append(_Drawn(z, _transform(box, matrix), opaque, fill, image))


def _page_children(page: Any) -> Iterator[Any]:
    for index in range(pdfium_c.FPDFPage_CountObjects(page)):
        yield pdfium_c.FPDFPage_GetObject(page, index)


def _form_children(form: Any) -> Iterator[Any]:
    for index in range(max(0, pdfium_c.FPDFFormObj_CountObjects(form))):
        yield pdfium_c.FPDFFormObj_GetObject(form, index)


def _clip_boxes(obj: Any) -> list[Box]:
    """The bounding box of each path of ``obj``'s clip (page or form space)."""
    clip = pdfium_c.FPDFPageObj_GetClipPath(obj)
    if not clip:
        return []
    boxes = []
    for path in range(max(0, pdfium_c.FPDFClipPath_CountPaths(clip))):
        xs, ys = [], []
        for index in range(max(0, pdfium_c.FPDFClipPath_CountPathSegments(clip, path))):
            segment = pdfium_c.FPDFClipPath_GetPathSegment(clip, path, index)
            x, y = ctypes.c_float(), ctypes.c_float()
            if segment and pdfium_c.FPDFPathSegment_GetPoint(segment, x, y):
                xs.append(x.value)
                ys.append(y.value)
        if xs:
            boxes.append((min(xs), min(ys), max(xs), max(ys)))
    return boxes


# --- characters --------------------------------------------------------------------------------


@dataclass(slots=True)
class _Char:
    text: str
    box: Box
    font: int | None
    size: float
    hidden: str | None

    @property
    def height(self) -> float:
        return self.box[3] - self.box[1]

    @property
    def centre(self) -> tuple[float, float]:
        return ((self.box[0] + self.box[2]) / 2, (self.box[1] + self.box[3]) / 2)


def _inside(point: tuple[float, float], box: Box) -> bool:
    return box[0] <= point[0] <= box[2] and box[1] <= point[1] <= box[3]


def _covered_share(box: Box, cover: Box) -> float:
    width = min(box[2], cover[2]) - max(box[0], cover[0])
    height = min(box[3], cover[3]) - max(box[1], cover[1])
    area = (box[2] - box[0]) * (box[3] - box[1])
    if width <= 0 or height <= 0 or area <= 0:
        return 0.0
    return width * height / area


@dataclass(frozen=True, slots=True)
class _Alpha:
    """Where an image paints, read from its render with its own mask (``/SMask``, ``/Mask``,
    ``/ImageMask``) at 72 dpi: one alpha byte a pixel, top row first; ``None`` when it paints
    everywhere."""

    width: int
    height: int
    plane: bytes | None


def _alpha_of(document: Any, page: Any, image: Any) -> _Alpha | None:
    """The image's :class:`_Alpha`; ``None`` when PDFium cannot render it."""
    rendered = pdfium_c.FPDFImageObj_GetRenderedBitmap(document, page, image)
    if not rendered:
        return None
    try:
        width = pdfium_c.FPDFBitmap_GetWidth(rendered)
        height = pdfium_c.FPDFBitmap_GetHeight(rendered)
        stride = pdfium_c.FPDFBitmap_GetStride(rendered)
        if pdfium_c.FPDFBitmap_GetFormat(rendered) != pdfium_c.FPDFBitmap_BGRA or width <= 0:
            return _Alpha(max(width, 1), max(height, 1), None)
        pixels = ctypes.string_at(pdfium_c.FPDFBitmap_GetBuffer(rendered), stride * height)
    finally:
        pdfium_c.FPDFBitmap_Destroy(rendered)
    plane = b"".join(
        pixels[row * stride + 3 : row * stride + 4 * width : 4] for row in range(height)
    )
    return _Alpha(width, height, None if min(plane) >= OPAQUE_ALPHA else plane)


def _image_share(box: Box, cover: Box, alpha: _Alpha) -> float:
    """The share of ``box`` under the pixels of ``cover`` (an image's box) that paint."""
    if alpha.plane is None:
        return _covered_share(box, cover)
    left, bottom, right, top = cover
    x0, x1 = max(box[0], left), min(box[2], right)
    y0, y1 = max(box[1], bottom), min(box[3], top)
    area = (box[2] - box[0]) * (box[3] - box[1])
    if x1 <= x0 or y1 <= y0 or area <= 0 or right <= left or top <= bottom:
        return 0.0
    fx, fy = alpha.width / (right - left), alpha.height / (top - bottom)
    first_column = min(alpha.width - 1, int((x0 - left) * fx))
    last_column = min(alpha.width, max(first_column + 1, math.ceil((x1 - left) * fx)))
    first_row = min(alpha.height - 1, int((top - y1) * fy))
    last_row = min(alpha.height, max(first_row + 1, math.ceil((top - y0) * fy)))
    painted = total = 0
    for row in range(first_row, last_row):
        start = row * alpha.width
        cells = alpha.plane[start + first_column : start + last_column]
        painted += sum(1 for value in cells if value >= OPAQUE_ALPHA)
        total += len(cells)
    return painted / total * (x1 - x0) * (y1 - y0) / area if total else 0.0


class _Index:
    """The opaque objects of a page by where they lie (Workflow 5C review P014): a grid of
    cells over the page box, each holding the objects over it in painting order, and the few
    objects over many cells apart. Every test of a character against an object is counted, and
    a page past :data:`MAX_SCENE_CHECKS` is refused. An image covers only where its own mask
    lets it paint (P015), read once, when a character first meets it."""

    def __init__(
        self, drawn: list[_Drawn], page_box: Box, page: Any = None, document: Any = None
    ) -> None:
        self.page, self.document = page, document
        self.alphas: dict[int, _Alpha | None] = {}
        self.left, self.bottom = page_box[0], page_box[1]
        self.cell_width = max((page_box[2] - page_box[0]) / INDEX_GRID, 1e-6)
        self.cell_height = max((page_box[3] - page_box[1]) / INDEX_GRID, 1e-6)
        self.cells: dict[tuple[int, int], list[_Drawn]] = {}
        self.large: list[_Drawn] = []
        self.checks = 0
        for item in drawn:  # in painting order, so every list is in rising z
            first, last = self._cell(item.box[0], item.box[1]), self._cell(item.box[2], item.box[3])
            columns = range(first[0], last[0] + 1)
            rows = range(first[1], last[1] + 1)
            if len(columns) * len(rows) > INDEX_LARGE_CELLS:
                self.large.append(item)
                continue
            for column in columns:
                for row in rows:
                    self.cells.setdefault((column, row), []).append(item)

    def _cell(self, x: float, y: float) -> tuple[int, int]:
        column = int((x - self.left) / self.cell_width)
        row = int((y - self.bottom) / self.cell_height)
        return (min(INDEX_GRID - 1, max(0, column)), min(INDEX_GRID - 1, max(0, row)))

    def _over(self, point: tuple[float, float]) -> tuple[list[_Drawn], list[_Drawn]]:
        return self.cells.get(self._cell(*point), []), self.large

    def _check(self) -> None:
        self.checks += 1
        if self.checks > MAX_SCENE_CHECKS:
            raise TaskRefusal("pdf_unprocessable")

    def covered(self, box: Box, centre: tuple[float, float], z: int) -> bool:
        """Whether an opaque object drawn after ``z`` covers nine tenths of ``box``; such an
        object holds the box's centre, so only the objects over the centre's cell are met."""
        for group in self._over(centre):
            for item in reversed(group):
                self._check()
                if item.z <= z:
                    break
                if self._share(box, item) >= COVERED_SHARE:
                    return True
        return False

    def _share(self, box: Box, item: _Drawn) -> float:
        if item.image is None or self.document is None:
            return _covered_share(box, item.box)
        cover = item.box
        if (cover[2] - cover[0]) * (cover[3] - cover[1]) > MAX_IMAGE_CHECK_PIXELS:
            return _covered_share(box, cover)
        if item.z not in self.alphas:
            self.alphas[item.z] = _alpha_of(self.document, self.page, item.image)
        alpha = self.alphas[item.z]
        return _covered_share(box, cover) if alpha is None else _image_share(box, cover, alpha)

    def behind(self, centre: tuple[float, float], z: int) -> _Drawn | None:
        """The topmost opaque object drawn before ``z`` under ``centre``."""
        best: _Drawn | None = None
        for group in self._over(centre):
            for item in reversed(group):
                self._check()
                if item.z >= z:
                    continue
                if best is not None and item.z <= best.z:
                    break
                if _inside(centre, item.box):
                    best = item
                    break
        return best


@dataclass
class _Judge:
    scene: _Scene
    page_box: Box
    page: Any = None
    document: Any = None
    """The PDFium page and document, to render an image with its own mask (P015)."""
    objects: dict[int, tuple[int, tuple[int, int, int, int] | None]] = field(default_factory=dict)
    index: _Index = field(init=False)

    def __post_init__(self) -> None:
        self.index = _Index(self.scene.drawn, self.page_box, self.page, self.document)

    def text_object(self, obj: Any) -> tuple[int, tuple[int, int, int, int] | None]:
        """Its render mode and the colour it paints with (stroke for stroke-only modes)."""
        address = ctypes.cast(obj, ctypes.c_void_p).value or 0
        if address not in self.objects:
            mode = pdfium_c.FPDFTextObj_GetTextRenderMode(obj)
            getter = (
                pdfium_c.FPDFPageObj_GetStrokeColor
                if mode in _STROKE_ONLY_MODES
                else pdfium_c.FPDFPageObj_GetFillColor
            )
            self.objects[address] = (mode, _colour(getter, obj))
        return self.objects[address]

    def hidden(self, obj: Any, box: Box) -> str | None:  # noqa: PLR0911 - one answer per reason
        mode, colour = self.text_object(obj)
        if mode in _INVISIBLE_MODES:
            return "render_mode_invisible"
        centre = ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)
        if not _inside(centre, self.page_box):
            return "off_page"
        address = ctypes.cast(obj, ctypes.c_void_p).value or 0
        if any(not _inside(centre, clip) for clip in self.scene.clips.get(address, [])):
            return "clipped"
        if box[3] - box[1] < MIN_VISIBLE_HEIGHT_PT:
            return "too_small"
        z = self.scene.text_z.get(address, 0)
        if self.index.covered(box, centre, z):
            return "covered"
        if colour is not None and self._blends_in(colour, centre, z):
            return "background_fill"
        return None

    def _blends_in(
        self, colour: tuple[int, int, int, int], centre: tuple[float, float], z: int
    ) -> bool:
        if colour[3] < TRANSPARENT_ALPHA:
            return True
        under = self.index.behind(centre, z)
        behind = _WHITE if under is None else under.fill
        if behind is None:  # an image or a shading: its colour there is unknown
            return False
        return all(abs(a - b) <= COLOUR_TOLERANCE for a, b in zip(colour[:3], behind, strict=True))


def _characters(text_page: Any, judge: _Judge, fonts: FontRegistry) -> list[_Char]:
    rect = pdfium_c.FS_RECTF()
    chars: list[_Char] = []
    for index in range(min(pdfium_c.FPDFText_CountChars(text_page), MAX_CHARS)):
        if pdfium_c.FPDFText_IsGenerated(text_page, index) == 1:
            continue
        code = pdfium_c.FPDFText_GetUnicode(text_page, index)
        if code in {0, 0xFFFE, 0xFFFF} or (code < 0x20 and code != 0x09):  # noqa: PLR2004
            continue
        if code > sys.maxunicode:  # a broken ToUnicode map: no character
            continue
        obj = pdfium_c.FPDFText_GetTextObject(text_page, index)
        if not obj or not pdfium_c.FPDFText_GetLooseCharBox(text_page, index, ctypes.byref(rect)):
            continue
        box = (rect.left, rect.bottom, rect.right, rect.top)
        font = pdfium_c.FPDFTextObj_GetFont(obj)
        chars.append(
            _Char(
                text=" " if code == 0x09 else chr(code),  # noqa: PLR2004 - a tab is a space
                box=box,
                font=fonts.id_of(font) if font else None,
                size=round(pdfium_c.FPDFText_GetFontSize(text_page, index), 1),
                hidden=judge.hidden(obj, box),
            )
        )
    return chars


# --- lines -------------------------------------------------------------------------------------


@dataclass
class _Run:
    chars: list[_Char]

    @property
    def hidden(self) -> str | None:
        return self.chars[0].hidden

    @property
    def box(self) -> Box:
        return (
            min(c.box[0] for c in self.chars),
            min(c.box[1] for c in self.chars),
            max(c.box[2] for c in self.chars),
            max(c.box[3] for c in self.chars),
        )

    @property
    def height(self) -> float:
        return max(*(c.height for c in self.chars), 1e-3)


def _continues(run: _Run, char: _Char) -> bool:
    last = run.chars[-1]
    height = max(last.height, char.height, 1e-3)
    if char.hidden != run.hidden:
        return False
    if abs(char.box[1] - last.box[1]) > height / 2:
        return False
    gap = char.box[0] - last.box[2]
    return -height / 2 <= gap <= LINE_GAP_HEIGHTS * height


def _runs(chars: list[_Char]) -> list[_Run]:
    runs: list[_Run] = []
    for char in chars:
        if char.text == " " and (not runs or not _continues(runs[-1], char)):
            continue
        if runs and _continues(runs[-1], char):
            runs[-1].chars.append(char)
        else:
            runs.append(_Run([char]))
    return runs


def _joins(left: _Run, right: _Run) -> bool:
    if left.hidden != right.hidden:
        return False
    a, b = left.box, right.box
    height = max(left.height, right.height)
    if abs(a[1] - b[1]) > height / 2:
        return False
    gap = b[0] - a[2]
    return -height / 4 <= gap <= LINE_GAP_HEIGHTS * height


def _merge(runs: list[_Run]) -> list[_Run]:
    """Runs on one baseline that touch become one, left to right."""
    ordered = sorted(runs, key=lambda run: (-round(run.box[1], 1), run.box[0]))
    merged: list[_Run] = []
    for run in ordered:
        target = next((m for m in reversed(merged[-8:]) if _joins(m, run)), None)
        if target is None:
            merged.append(_Run(list(run.chars)))
        else:
            target.chars.extend(run.chars)
    return merged


def _line_text(run: _Run) -> str:
    chars = sorted(run.chars, key=lambda c: c.box[0])
    parts: list[str] = []
    previous: _Char | None = None
    for char in chars:
        if previous is not None:
            gap = char.box[0] - previous.box[2]
            if gap > WORD_GAP_HEIGHTS * run.height and " " not in {char.text, previous.text}:
                parts.append(" ")
        parts.append(char.text)
        previous = char
    return "".join(parts)


def _to_raster(page: Any, box: Box, raster_size: tuple[int, int]) -> tuple[float, ...]:
    """``box`` (page points) as ``(x, y, width, height)`` in raster pixels."""
    width, height = raster_size
    xs, ys = [], []
    for x, y in ((box[0], box[1]), (box[2], box[3])):
        dx, dy = ctypes.c_int(), ctypes.c_int()
        pdfium_c.FPDF_PageToDevice(page, 0, 0, width, height, 0, x, y, dx, dy)
        xs.append(dx.value)
        ys.append(dy.value)
    left, right = min(xs), max(xs)
    top, bottom = min(ys), max(ys)
    return (float(left), float(top), float(max(1, right - left)), float(max(1, bottom - top)))


def page_lines(
    page: Any, fonts: FontRegistry, raster_size: tuple[int, int], document: Any = None
) -> list[dict[str, Any]]:
    """The contract's ``TextLayerLine`` dicts of a PDFium page (raw handle), boxes in the pixels
    of its raster of ``raster_size``, top to bottom and left to right, at most 600. With its
    ``document`` (raw handle), an image covers only where its own mask lets it paint."""
    scene = _Scene()
    scene.walk(_page_children(page), _IDENTITY, 0)
    rect = pdfium_c.FS_RECTF()
    if pdfium_c.FPDF_GetPageBoundingBox(page, rect):
        page_box = (rect.left, rect.bottom, rect.right, rect.top)
    else:  # pragma: no cover - PDFium answers it for every loaded page
        page_box = (0.0, 0.0, pdfium_c.FPDF_GetPageWidthF(page), pdfium_c.FPDF_GetPageHeightF(page))
    judge = _Judge(scene, page_box, page, document)
    text_page = pdfium_c.FPDFText_LoadPage(page)
    try:
        chars = _characters(text_page, judge, fonts)
    finally:
        pdfium_c.FPDFText_ClosePage(text_page)
    lines: list[dict[str, Any]] = []
    for run in _merge(_runs(chars)):
        text = clip_text(_line_text(run), MAX_LINE_LENGTH)
        if text is None:
            continue
        font_ids = sorted({c.font for c in run.chars if c.font is not None})[:MAX_LINE_FONTS]
        sizes = Counter(c.size for c in run.chars if c.text != " " and c.size > 0)
        lines.append(
            {
                "text": text,
                "box": list(_to_raster(page, run.box, raster_size)),
                "font_ids": font_ids,
                "font_size_pt": sizes.most_common(1)[0][0] if sizes else None,
                "visible": run.hidden is None,
                "hidden_reason": run.hidden,
            }
        )
        if len(lines) == MAX_LINES:
            break
    return lines
