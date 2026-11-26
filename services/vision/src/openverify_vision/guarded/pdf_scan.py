"""C60.1: the bounded raw-byte scanner of a PDF, run in the guarded child beside PDFium and pypdf.

It lexes the file as bytes, skipping comments, strings and stream data, and reads what the two
libraries hide or normalise: the ``%%EOF`` markers and what follows the last one, the ``startxref``
sections (incremental updates), a ``/Linearized`` first object, ``/Encrypt``, object streams,
``#xx``-escaped names (``/J#53``) and keys in objects nothing references, the catalog's XMP
stream, and which objects each increment after a signature adds. Objects inside a FlateDecode
object stream are read too. Every pass is bounded (tokens, depth, kept values, decoded bytes).
Standard library only.

What it cannot see: anything inside encrypted streams (an encrypted document's object streams
and metadata are read only when stored in the clear), and object streams with another filter or
a predictor.
"""

from __future__ import annotations

import bisect
import re
import zlib
from dataclasses import dataclass, field
from typing import Any, Final

INTERESTING_NAMES: Final = frozenset(
    {
        "AA",
        "EmbeddedFile",
        "EmbeddedFiles",
        "Encrypt",
        "GoToR",
        "JBIG2Decode",
        "JS",
        "JavaScript",
        "Launch",
        "Linearized",
        "ObjStm",
        "OpenAction",
        "Prev",
        "RichMedia",
        "RichMediaExecute",
        "SubmitForm",
        "URI",
        "XFA",
        "XRefStm",
    }
)
"""The names counted wherever they appear outside strings, comments and stream data."""

MAX_TOKENS: Final = 3_000_000
MAX_OBJECTS: Final = 200_000
MAX_DEPTH: Final = 32
MAX_ITEMS: Final = 512
"""Items one array or dictionary keeps (a dictionary keeps 256 entries)."""
MAX_STRING_KEPT: Final = 256
MAX_METADATA_BYTES: Final = 64 * 1024
MAX_OBJECT_STREAM_BYTES: Final = 20 * 1024 * 1024
MAX_DECODED_TOTAL: Final = 64 * 1024 * 1024
MAX_OBJECTS_PER_STREAM: Final = 100_000
LINEARIZED_WINDOW: Final = 1024
"""A linearization dictionary is the first object, within the file's first 1,024 bytes."""
MAX_NUMBER_DIGITS: Final = 18
"""Workflow 5C review P017: an integer of more digits is kept as no value (``None``). No PDF
needs one: offsets, lengths and object numbers fit in 18 digits, which stay under a C
``ssize_t`` and far under CPython's 4,300-digit limit for ``int()``."""

_TOKEN: Final = re.compile(
    rb"""
    (?P<ws>[\x00\t\n\x0c\r ]+)
  | (?P<comment>%[^\r\n]*)
  | (?P<name>/[^\x00\t\n\x0c\r ()<>\[\]{}/%]*)
  | (?P<dopen><<)
  | (?P<dclose>>>)
  | (?P<hex><[0-9A-Fa-f\x00\t\n\x0c\r ]*>)
  | (?P<string>\()
  | (?P<aopen>\[)
  | (?P<aclose>\])
  | (?P<number>[+-]?(?:\d+(?:\.\d*)?|\.\d+))
  | (?P<keyword>[A-Za-z_][A-Za-z0-9_.-]{0,63})
  | (?P<other>.)
    """,
    re.VERBOSE | re.DOTALL,
)
_STRING_SPECIAL: Final = re.compile(rb"[()\\]")
_NAME_ESCAPE: Final = re.compile(rb"#([0-9A-Fa-f]{2})")
_END_OF_STREAM: Final = re.compile(rb"[\x00\t\n\x0c\r ]{0,8}endstream")
_TRAILING_WHITESPACE: Final = b"\x00\t\n\x0c\r "
_HASH_NAME: Final = re.compile(r"/[0-9A-Fa-f]{32,128}")

_BACKSLASH: Final = ord("\\")
_OPEN_PAREN: Final = ord("(")

_DISCARD: Final = object()
"""A container past the depth bound: its tokens are lexed, not kept."""


@dataclass(frozen=True, slots=True)
class Ref:
    """An indirect reference ``number generation R``."""

    number: int
    generation: int


@dataclass(frozen=True, slots=True)
class PdfObject:
    """One indirect object as the scan read it."""

    number: int
    generation: int
    offset: int
    """Where ``number generation obj`` starts; for an object inside an object stream, where
    that stream's object starts."""
    in_object_stream: int | None
    value: Any
    """Its value: a dict for a dictionary (names are ``"/Name"`` strings, references
    :class:`Ref`), as deep as the scan keeps."""
    is_stream: bool
    metadata: bytes | None
    """For a ``/Type /Metadata`` stream: its first 64 KiB, decoded when FlateDecode."""


# --- what an increment after a signature may hold ----------------------------------------------

_ACROFORM_KEYS: Final = frozenset({"/Fields", "/SigFlags", "/DR", "/DA", "/NeedAppearances", "/Q"})
_VRI_KEYS: Final = frozenset({"/Cert", "/CRL", "/OCSP", "/TU", "/TS", "/Type"})
_DATA_STREAM_KEYS: Final = frozenset({"/Length", "/Filter", "/DecodeParms", "/DL"})
_DSS_KINDS: Final = frozenset({"structure", "catalog", "dss", "vri", "data_stream"})
_TIMESTAMP_KINDS: Final = frozenset(
    {"structure", "catalog", "doc_timestamp", "signature_field", "acroform", "page", "empty_form"}
)


def _zero_area(box: Any) -> bool:
    if not isinstance(box, list) or len(box) != 4:  # noqa: PLR2004 - a rectangle
        return False
    if not all(isinstance(value, int | float) for value in box):
        return False
    return bool(box[2] - box[0] == 0 or box[3] - box[1] == 0)


def _kind(obj: PdfObject) -> str:  # noqa: PLR0911 - one answer per kind
    """What one object of an increment is, for :meth:`PdfScan.edits_after`."""
    value = obj.value
    if not isinstance(value, dict):
        return "structure" if isinstance(value, int | float) or value is None else "other"
    kind_of = value.get("/Type")
    keys = set(value)
    if kind_of in {"/XRef", "/ObjStm"}:
        return "structure"
    if kind_of == "/Catalog":
        return "catalog"
    if kind_of == "/DSS" or (kind_of is None and keys & {"/Certs", "/OCSPs", "/CRLs", "/VRI"}):
        return "dss"
    if kind_of in {None, "/VRI"} and keys and (keys <= _VRI_KEYS or _all_hash_names(keys)):
        return "vri"
    if kind_of == "/DocTimeStamp" or value.get("/SubFilter") == "/ETSI.RFC3161":
        return "doc_timestamp"
    if value.get("/FT") == "/Sig":
        return "signature_field"
    if obj.is_stream and keys <= _DATA_STREAM_KEYS:
        return "data_stream"
    if obj.is_stream and value.get("/Subtype") == "/Form" and _zero_area(value.get("/BBox")):
        return "empty_form"
    if kind_of == "/Page":
        return "page"
    if "/Fields" in keys and keys <= _ACROFORM_KEYS:
        return "acroform"
    return "other"


def _all_hash_names(keys: set[str]) -> bool:
    """A VRI map: every key is a signature's hash written as a name."""
    return all(_HASH_NAME.fullmatch(key) for key in keys)


def _references(value: Any) -> set[int]:
    if isinstance(value, Ref):
        return {value.number}
    if isinstance(value, list):
        return {item.number for item in value if isinstance(item, Ref)}
    return set()


def _timestamp_only(objects: list[PdfObject], kinds: list[str]) -> bool:
    """An increment that only adds a document timestamp."""
    if "doc_timestamp" not in kinds or not all(kind in _TIMESTAMP_KINDS for kind in kinds):
        return False
    added = {obj.number for obj in objects}
    # A page rewritten to hold the timestamp's widget keeps its content: its /Contents must
    # name nothing this increment adds.
    return not any(
        _references(obj.value.get("/Contents")) & added
        for obj, kind in zip(objects, kinds, strict=True)
        if kind == "page"
    )


# --- a later signature (K11, Workflow 5C review; amends C60.4) -----------------------------------

Versions = dict[int, PdfObject]
"""The latest version of each object number, by offset."""


def _latest(objects: list[PdfObject]) -> Versions:
    versions: Versions = {}
    for obj in objects:
        known = versions.get(obj.number)
        if known is None or obj.offset >= known.offset:
            versions[obj.number] = obj
    return versions


def _is_signature_value(value: Any) -> bool:
    """A signature dictionary (``/Type`` is optional there), not a document timestamp."""
    if not isinstance(value, dict) or value.get("/SubFilter") == "/ETSI.RFC3161":
        return False
    return value.get("/Type") == "/Sig" or {"/ByteRange", "/Contents", "/Filter"} <= set(value)


def _is_signature_field(value: Any) -> bool:
    return isinstance(value, dict) and value.get("/FT") == "/Sig"


def _resolve(value: Any, *versions: Versions) -> Any:
    """``value``, or the object a reference names, looked up in ``versions`` in order."""
    if not isinstance(value, Ref):
        return value
    for known in versions:
        if value.number in known:
            return known[value.number].value
    return None


def _refs_in(value: Any) -> set[int]:
    """Every object number ``value`` references, however deep (the scan bounds the depth)."""
    found: set[int] = set()
    pending = [value]
    while pending:
        item = pending.pop()
        if isinstance(item, Ref):
            found.add(item.number)
        elif isinstance(item, dict):
            pending.extend(item.values())
        elif isinstance(item, list):
            pending.extend(item)
    return found


def _same_except(new: Any, old: Any, keys: frozenset[str]) -> bool:
    """Two dictionaries that differ in ``keys`` at most."""
    if not isinstance(new, dict) or not isinstance(old, dict):
        return False
    return {k: v for k, v in new.items() if k not in keys} == {
        k: v for k, v in old.items() if k not in keys
    }


def _gains_only(new: Any, old: Any, allowed: set[int]) -> bool:
    """An array that keeps every item it had and gains only references to ``allowed``."""
    if not isinstance(new, list):
        return False
    try:
        kept, had = set(new), set(old if isinstance(old, list) else [])
    except TypeError:  # an inline dictionary or array where references belong
        return False
    return had <= kept and all(
        isinstance(item, Ref) and item.number in allowed for item in kept - had
    )


@dataclass(frozen=True, slots=True)
class _LaterSignature:
    """One increment read as a later signature, against the versions before it."""

    current: Versions
    earlier: Versions
    catalog: PdfObject | None
    """The latest catalog before the increment."""

    def check(self) -> bool:
        """An increment that adds only a later signature and what that signature needs: its
        signature dictionary; its field and widget, with what they reference that is new (the
        appearance and its fonts and images, a field lock, seed values); the AcroForm gaining
        the field; the page gaining the widget. Any other added or changed object, the document
        information and the XMP metadata included, is an edit."""
        values = {
            number
            for number, obj in self.current.items()
            if _is_signature_value(obj.value) and number not in self.earlier
        }
        fields = self._fields()
        signed = _refs_in([self.current[n].value.get("/V") for n in fields])
        if not values or not values <= signed:
            return False
        reach = self._reach(fields)
        parts = fields | {n for n in reach if self._is_signature_widget(n)}
        return all(self._allowed(number, obj, reach, parts) for number, obj in self.current.items())

    def _reach(self, roots: set[int]) -> set[int]:
        """The new objects of this increment the signature fields reference, transitively."""
        seen = set(roots)
        pending = list(roots)
        while pending:
            for number in _refs_in(self.current[pending.pop()].value):
                if number in self.current and number not in self.earlier and number not in seen:
                    seen.add(number)
                    pending.append(number)
        return seen

    def _is_signature_widget(self, number: int) -> bool:
        value = self.current[number].value
        if not isinstance(value, dict) or value.get("/Subtype") != "/Widget":
            return False
        if "/FT" in value:
            return bool(value["/FT"] == "/Sig")
        return _is_signature_field(_resolve(value.get("/Parent"), self.current, self.earlier))

    def _part_of_signature(self, number: int) -> bool:
        """A new object the signature reaches: never another field, annotation or page."""
        value = self.current[number].value
        if not isinstance(value, dict):
            return True
        if "/FT" in value:
            return bool(value["/FT"] == "/Sig")
        if value.get("/Subtype") == "/Widget":
            return self._is_signature_widget(number)
        if value.get("/Type") in {"/Annot", "/Page", "/Pages", "/Catalog"}:
            return False
        return self.current[number].is_stream or "/Rect" not in value

    def _acroform(self, value: Any) -> bool:
        """The AcroForm as before, its fields gaining only the new signature fields."""
        old = None if self.catalog is None else self.catalog.value.get("/AcroForm")
        before = _resolve(old, self.earlier)
        before = before if isinstance(before, dict) else {}
        if not _same_except(value, before, frozenset({"/Fields", "/SigFlags"})):
            return False
        fields = _resolve(value.get("/Fields"), self.current, self.earlier)
        return _gains_only(fields, _resolve(before.get("/Fields"), self.earlier), self._fields())

    def _fields(self) -> set[int]:
        """The signature fields this increment writes."""
        return {n for n, obj in self.current.items() if _is_signature_field(obj.value)}

    def _allowed(  # noqa: PLR0911 - one answer per kind of object
        self, number: int, obj: PdfObject, reach: set[int], parts: set[int]
    ) -> bool:
        """Whether one object of the increment is the signature's, or changed only for it."""
        kind = _kind(obj)
        before = self.earlier.get(number)
        if kind == "structure":
            return True
        if kind == "catalog":
            if self.catalog is None or not _same_except(
                obj.value, self.catalog.value, frozenset({"/AcroForm"})
            ):
                return False
            form = _resolve(obj.value.get("/AcroForm"), self.current, self.earlier)
            return obj.value.get("/AcroForm") == self.catalog.value.get(
                "/AcroForm"
            ) or self._acroform(form)
        if kind == "acroform":
            return self._acroform(obj.value)
        if before is None:
            return number in reach and self._part_of_signature(number)
        if _is_signature_field(before.value) and number in parts:
            return True  # an empty signature field, now signed
        if _kind(before) == "page":
            annots = _resolve(obj.value.get("/Annots"), self.current, self.earlier)
            return _same_except(obj.value, before.value, frozenset({"/Annots"})) and _gains_only(
                annots, _resolve(before.value.get("/Annots"), self.earlier), parts
            )
        if isinstance(before.value, list):
            return _gains_only(obj.value, before.value, parts)  # an /Annots or /Fields array
        return False


def _dss_only(objects: list[PdfObject], kinds: list[str], earlier: Versions) -> bool:
    """An increment that only adds or updates a document security store: its DSS and VRI
    dictionaries (new, or replacing earlier ones), the new streams they name (certificates,
    CRLs, OCSP responses), the catalog and structure. A stream that replaces an object the
    document had, or that neither the DSS nor a VRI names, is an edit, as is an earlier object
    rewritten to look like a VRI (Workflow 5C review P011)."""
    if "dss" not in kinds or not all(kind in _DSS_KINDS for kind in kinds):
        return False
    stores = [obj.value for obj, kind in zip(objects, kinds, strict=True) if kind in {"dss", "vri"}]
    named = _refs_in(stores)
    for obj, kind in zip(objects, kinds, strict=True):
        before = earlier.get(obj.number)
        if kind == "data_stream" and (before is not None or obj.number not in named):
            return False
        if kind in {"dss", "vri"} and before is not None and _kind(before) not in {"dss", "vri"}:
            return False
    return True


def _benign(objects: list[PdfObject], earlier: Versions, catalog: PdfObject | None) -> bool:
    """An increment that only adds a DSS, only a document timestamp, or only a later signature
    (K11)."""
    kinds = [_kind(obj) for obj in objects]
    if _dss_only(objects, kinds, earlier):
        return True
    if _timestamp_only(objects, kinds):
        return True
    return _LaterSignature(_latest(objects), earlier, catalog).check()


@dataclass(frozen=True, slots=True)
class PdfScan:
    """What the raw bytes say."""

    file_length: int
    eof_offsets: tuple[int, ...]
    """The offset just after each ``%%EOF`` marker outside stream data."""
    bytes_after_last_eof: int
    """Bytes after the last marker, not counting trailing whitespace."""
    startxref_count: int
    linearized: bool
    encrypted: bool
    object_streams: int
    names: dict[str, int]
    """How often each of :data:`INTERESTING_NAMES` appears (escapes decoded)."""
    objects: tuple[PdfObject, ...]
    truncated: bool
    """The scan stopped at one of its bounds before the end of the file, or kept fewer objects
    than it read: what it did not read must not be measured as clean, so the analysis refuses
    such a document (Workflow 5C review P012)."""

    @property
    def eof_markers(self) -> int:
        return len(self.eof_offsets)

    @property
    def revisions(self) -> int:
        """Incremental-update sections (one ``startxref`` each), without the first-page section
        of a linearized file; at least 1."""
        return max(1, self.startxref_count - (1 if self.linearized else 0))

    def _latest(self, number: int) -> PdfObject | None:
        found = [obj for obj in self.objects if obj.number == number]
        return max(found, key=lambda obj: obj.offset) if found else None

    def metadata_packet(self) -> bytes | None:
        """The catalog's ``/Metadata`` stream, at most 64 KiB of it; ``None`` without one."""
        catalogs = [
            obj
            for obj in self.objects
            if isinstance(obj.value, dict) and obj.value.get("/Type") == "/Catalog"
        ]
        if not catalogs:
            return None
        catalog = max(catalogs, key=lambda obj: obj.offset)
        reference = catalog.value.get("/Metadata")
        if not isinstance(reference, Ref):
            return None
        metadata = self._latest(reference.number)
        return None if metadata is None else metadata.metadata

    def edits_after(self, offset: int) -> bool:
        """Whether an increment that starts at or after ``offset`` changes the document: one
        that only adds a document security store (DSS), a document timestamp or a later
        signature (K11) is not an edit. An increment is the objects up to the next ``%%EOF``,
        each judged against the versions of the objects before it."""
        later = [obj for obj in self.objects if obj.offset >= offset]
        if not later:
            return False
        ends = sorted(end for end in self.eof_offsets if end > offset)
        increments: dict[int, list[PdfObject]] = {}
        for obj in later:
            increments.setdefault(bisect.bisect_left(ends, obj.offset), []).append(obj)
        ordered = sorted(self.objects, key=lambda obj: obj.offset)
        earlier: Versions = {}
        catalog: PdfObject | None = None
        cursor = 0
        for key in sorted(increments):
            objects = increments[key]
            start = min(obj.offset for obj in objects)
            while cursor < len(ordered) and ordered[cursor].offset < start:
                obj = ordered[cursor]
                earlier[obj.number] = obj
                if isinstance(obj.value, dict) and obj.value.get("/Type") == "/Catalog":
                    catalog = obj
                cursor += 1
            if not _benign(objects, earlier, catalog):
                return True
        return False


# --- the lexer ------------------------------------------------------------------------------------


def _name(raw: bytes) -> str:
    if b"#" in raw:
        raw = _NAME_ESCAPE.sub(lambda found: bytes([int(found.group(1), 16)]), raw)
    return raw.decode("latin-1")


def _number(token: bytes) -> int | float | None:
    """A numeric token's value; ``None`` for an integer of more than
    :data:`MAX_NUMBER_DIGITS` digits."""
    if b"." in token:
        return float(token)
    return int(token) if len(token.lstrip(b"+-")) <= MAX_NUMBER_DIGITS else None


def _skip_string(data: bytes, start: int, end: int) -> int:
    """The position after the literal string whose ``(`` is at ``start - 1``."""
    depth = 1
    position = start
    while depth:
        found = _STRING_SPECIAL.search(data, position, end)
        if found is None:
            return end
        char = data[found.start()]
        if char == _BACKSLASH:  # it escapes the next byte
            position = found.start() + 2
            continue
        depth += 1 if char == _OPEN_PAREN else -1
        position = found.start() + 1
    return position


@dataclass
class _Container:
    items: list[Any] | object
    is_dict: bool


def _close(container: _Container) -> Any:
    items = container.items
    if items is _DISCARD or not isinstance(items, list):
        return None
    if not container.is_dict:
        return items
    pairs: dict[str, Any] = {}
    for index in range(0, len(items) - 1, 2):
        key = items[index]
        if isinstance(key, str) and key.startswith("/"):
            pairs[key] = items[index + 1]
    return pairs


def _fold_reference(items: list[Any]) -> None:
    """``number generation R`` at the end of ``items`` becomes one :class:`Ref`."""
    if len(items) >= 2 and type(items[-1]) is int and type(items[-2]) is int:  # noqa: PLR2004
        generation = items.pop()
        number = items.pop()
        items.append(Ref(number, generation))


@dataclass
class _Lexer:
    """Values from tokens, with the names of interest counted; shared by the file and the
    object streams."""

    data: bytes
    names: dict[str, int]
    budget: list[int]
    """The tokens left, shared with every nested pass."""
    stack: list[_Container] = field(default_factory=list)

    def exhausted(self) -> bool:
        return self.budget[0] <= 0

    def _push_value(self, values: list[Any], value: Any) -> None:
        """Into the open container (kept up to :data:`MAX_ITEMS`), else to ``values``."""
        if not self.stack:
            values.append(value)
            return
        target = self.stack[-1].items
        if isinstance(target, list) and len(target) < MAX_ITEMS:
            target.append(value)

    def close_all(self, values: list[Any]) -> None:
        """Close every open container, as a malformed object ends."""
        while self.stack:
            self._push_value_after_close(values)

    def feed(self, kind: str, token: bytes, values: list[Any]) -> None:
        """Take one token; a value completed at the top level goes to ``values``."""
        self.budget[0] -= 1
        if kind == "name":
            name = _name(token[1:])
            if name in INTERESTING_NAMES:
                self.names[name] += 1
            self._push_value(values, "/" + name)
        elif kind == "number":
            self._push_value(values, _number(token))
        elif kind in {"dopen", "aopen"}:
            depth_left = len(self.stack) < MAX_DEPTH
            items: list[Any] | object = [] if depth_left else _DISCARD
            self.stack.append(_Container(items, kind == "dopen"))
        elif kind in {"dclose", "aclose"}:
            if self.stack:
                self._push_value_after_close(values)
        elif kind == "keyword":
            if token == b"R":
                target = self.stack[-1].items if self.stack else values
                if isinstance(target, list):
                    _fold_reference(target)
            elif token in {b"true", b"false"}:
                self._push_value(values, token == b"true")
            elif token == b"null":
                self._push_value(values, None)
        elif kind == "hex":
            self._push_value(values, token[1:-1][:MAX_STRING_KEPT])

    def _push_value_after_close(self, values: list[Any]) -> None:
        container = self.stack.pop()
        self._push_value(values, _close(container))

    def string(self, start: int, end: int, values: list[Any]) -> int:
        """Skip a literal string starting after its ``(``; it is kept as (a prefix of) bytes."""
        after = _skip_string(self.data, start, end)
        self.budget[0] -= 1
        self._push_value(values, self.data[start : min(after - 1, start + MAX_STRING_KEPT)])
        return after

    def values_in(self, start: int, end: int) -> list[Any]:
        """Every top-level value between ``start`` and ``end`` (no streams there)."""
        values: list[Any] = []
        self.stack = []
        position = start
        while position < end and not self.exhausted():
            found = _TOKEN.match(self.data, position, end)
            if found is None:  # pragma: no cover - the pattern matches any byte
                break
            kind = found.lastgroup or "other"
            position = found.end()
            if kind == "string":
                position = self.string(position, end, values)
            elif kind in {"comment", "other"}:
                self.budget[0] -= 1  # stepped over one by one, so never free (P012)
            elif kind != "ws":
                self.feed(kind, found.group(), values)
        self.close_all(values)
        return values


# --- streams ------------------------------------------------------------------------------------


def _stream_span(data: bytes, start: int, length: Any) -> tuple[int, int, int, bool]:
    """Where a stream's data starts and ends, where scanning resumes after ``endstream``, and
    whether ``endstream`` was found; ``start`` is just after the ``stream`` keyword."""
    if data.startswith(b"\r\n", start):
        begin = start + 2
    elif data[start : start + 1] in {b"\n", b"\r"}:
        begin = start + 1
    else:
        begin = start
    if type(length) is int and 0 <= length <= len(data) - begin:
        found = _END_OF_STREAM.match(data, begin + length)
        if found is not None:
            return begin, begin + length, found.end(), True
    marker = data.find(b"endstream", begin)
    if marker < 0:
        return begin, len(data), len(data), False
    finish = marker
    if data[finish - 2 : finish] == b"\r\n":
        finish -= 2
    elif data[finish - 1 : finish] in {b"\n", b"\r"}:
        finish -= 1
    return begin, max(begin, finish), marker + len(b"endstream"), True


def _filters(dictionary: dict[str, Any]) -> list[str] | None:
    """The stream's filter names; ``None`` when they are not plain names."""
    value = dictionary.get("/Filter")
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, list) and all(isinstance(item, str) for item in value):
        return list(value)
    return None


def _has_predictor(dictionary: dict[str, Any]) -> bool:
    parms = dictionary.get("/DecodeParms")
    if isinstance(parms, list):
        parms = parms[0] if parms else None
    return isinstance(parms, dict) and parms.get("/Predictor", 1) not in {1, None}


def _decoded(data: bytes, dictionary: dict[str, Any], limit: int) -> bytes | None:
    """At most ``limit`` bytes of a stream with no filter or FlateDecode alone; ``None`` for
    any other filter or data that does not inflate."""
    filters = _filters(dictionary)
    if filters == []:
        return data[:limit]
    if filters != ["/FlateDecode"] or _has_predictor(dictionary):
        return None
    try:
        return zlib.decompressobj().decompress(data, limit)
    except zlib.error:
        return None


@dataclass
class _Scan:
    data: bytes
    names: dict[str, int] = field(default_factory=lambda: dict.fromkeys(INTERESTING_NAMES, 0))
    budget: list[int] = field(default_factory=lambda: [MAX_TOKENS])
    objects: list[PdfObject] = field(default_factory=list)
    eof_offsets: list[int] = field(default_factory=list)
    startxref_count: int = 0
    encrypted: bool = False
    decoded_total: int = 0
    truncated: bool = False

    def add(self, obj: PdfObject) -> None:
        if len(self.objects) < MAX_OBJECTS:
            self.objects.append(obj)
        else:
            self.truncated = True
        value = obj.value
        if isinstance(value, dict) and "/Encrypt" in value and value.get("/Type") == "/XRef":
            self.encrypted = True

    def object_stream(
        self, number: int, offset: int, dictionary: dict[str, Any], raw: bytes
    ) -> None:
        """The objects inside an object stream, read with their offsets."""
        room = min(MAX_OBJECT_STREAM_BYTES, MAX_DECODED_TOTAL - self.decoded_total)
        decoded = _decoded(raw, dictionary, room) if room > 0 else None
        count, first = dictionary.get("/N"), dictionary.get("/First")
        if decoded is None or type(count) is not int or type(first) is not int:
            return
        self.decoded_total += len(decoded)
        header = re.findall(rb"\d+", decoded[: max(0, first)])
        if any(len(number) > MAX_NUMBER_DIGITS for number in header):
            self.truncated = True  # no such offset or number exists: the stream is not read
            return
        entries = [
            (int(header[i]), int(header[i + 1]))
            for i in range(0, min(len(header) - 1, 2 * min(count, MAX_OBJECTS_PER_STREAM)), 2)
        ]
        lexer = _Lexer(decoded, self.names, self.budget)
        bounds = [first + position for _, position in entries] + [len(decoded)]
        for index, (inner, _) in enumerate(entries):
            begin, end = bounds[index], max(bounds[index], min(bounds[index + 1], len(decoded)))
            values = lexer.values_in(begin, end)
            self.add(
                PdfObject(inner, 0, offset, number, values[0] if values else None, False, None)
            )
            if lexer.exhausted():
                self.truncated = True
                return

    def stream(self, header: tuple[int, int, int], dictionary: Any, position: int) -> int:
        """Skip one stream's data; read its metadata or object-stream content. Returns where
        scanning resumes."""
        number, generation, offset = header
        entries = dictionary if isinstance(dictionary, dict) else {}
        begin, end, resume, complete = _stream_span(self.data, position, entries.get("/Length"))
        raw = self.data[begin:end]
        metadata = None
        if entries.get("/Type") == "/Metadata":
            metadata = _decoded(raw, entries, MAX_METADATA_BYTES)
        self.add(PdfObject(number, generation, offset, None, dictionary, True, metadata))
        if entries.get("/Type") == "/ObjStm":
            self.object_stream(number, offset, entries, raw)
        if not complete:
            self.truncated = True
        return resume


def scan_pdf(data: bytes) -> PdfScan:  # noqa: PLR0912, PLR0915 - one lexing loop
    """Scan ``data``: every object, marker and name of interest, within the bounds."""
    scan = _Scan(data)
    lexer = _Lexer(data, scan.names, scan.budget)
    values: list[Any] = []
    starts: list[int] = []
    """Where each top-level value of ``values`` started."""
    current: tuple[int, int, int] | None = None
    """The object being read: number, generation, offset."""
    expect_trailer = False
    position = 0
    end = len(data)
    while position < end:
        if lexer.exhausted():
            scan.truncated = True
            break
        found = _TOKEN.match(data, position)
        if found is None:  # pragma: no cover - the pattern matches any byte
            break
        kind = found.lastgroup or "other"
        token_start, position = found.start(), found.end()
        if kind == "ws":
            continue
        if kind in {"comment", "other"}:
            # Stepped over one by one, so they count against the budget too (Workflow 5C
            # review P012); a run of whitespace is one match.
            lexer.budget[0] -= 1
            if kind == "comment" and found.group().startswith(b"%%EOF"):
                scan.eof_offsets.append(token_start + 5)
            continue
        if kind == "string":
            before = len(values)
            position = lexer.string(position, end, values)
            if len(values) > before:
                starts.append(token_start)
            continue
        if kind == "keyword" and current is not None and found.group() in {b"stream", b"endobj"}:
            lexer.close_all(values)  # a malformed object ends with its containers open
            starts.extend([token_start] * (len(values) - len(starts)))
        if kind == "keyword" and not lexer.stack:
            word = found.group()
            if word == b"obj":
                numbers = values[-2:]
                if len(numbers) == 2 and all(type(n) is int for n in numbers):  # noqa: PLR2004
                    current = (numbers[0], numbers[1], starts[-2])
                values, starts = [], []
                continue
            if word == b"stream" and current is not None:
                position = scan.stream(current, values[-1] if values else None, position)
                current, values, starts = None, [], []
                continue
            if word == b"endobj":
                if current is not None:
                    value = values[-1] if values else None
                    scan.add(PdfObject(*current, None, value, False, None))
                current, values, starts = None, [], []
                continue
            if word == b"startxref":
                scan.startxref_count += 1
            if word == b"trailer":
                expect_trailer = True
            if word in {b"startxref", b"xref", b"trailer"}:
                current, values, starts = None, [], []
                continue
        before = len(values)
        lexer.feed(kind, found.group(), values)
        if len(values) > before:
            starts.append(token_start)
        elif len(values) < before:  # a reference folded two numbers into one value
            del starts[len(values) - 1 :]
            starts.append(token_start)
        if expect_trailer and not lexer.stack and values and isinstance(values[-1], dict):
            scan.encrypted = scan.encrypted or "/Encrypt" in values[-1]
            expect_trailer = False
        if len(values) > MAX_ITEMS:  # only the last few top-level values are ever read
            del values[:-2]
            del starts[:-2]
    eof = scan.eof_offsets[-1] if scan.eof_offsets else len(data)
    after = len(data[eof:].strip(_TRAILING_WHITESPACE)) if scan.eof_offsets else 0
    first = min(scan.objects, key=lambda obj: obj.offset, default=None)
    linearized = (
        first is not None
        and first.offset < LINEARIZED_WINDOW
        and isinstance(first.value, dict)
        and "/Linearized" in first.value
    )
    streams = sum(
        1
        for obj in scan.objects
        if isinstance(obj.value, dict) and obj.value.get("/Type") == "/ObjStm"
    )
    return PdfScan(
        file_length=len(data),
        eof_offsets=tuple(scan.eof_offsets),
        bytes_after_last_eof=after,
        startxref_count=scan.startxref_count,
        linearized=linearized,
        encrypted=scan.encrypted,
        object_streams=streams,
        names=scan.names,
        objects=tuple(scan.objects),
        truncated=scan.truncated,
    )
