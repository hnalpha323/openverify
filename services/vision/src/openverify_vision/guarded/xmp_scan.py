"""C60.1, C60.2: the fields of an XMP packet, read by a bounded byte scan, never by an XML parser.

At most :data:`MAX_XMP_SCAN_BYTES` of the packet are read. A packet that declares a document type
or an entity (``<!DOCTYPE``, ``<!ENTITY``) is refused, so no entity is ever expanded or fetched;
only the five predefined XML entities and character references are decoded. Each field is read
in either RDF form, as an attribute (``xmp:CreatorTool="…"``) or as a simple element
(``<pdf:Producer>…</pdf:Producer>``), whatever the namespace prefix; the first occurrence wins,
except for the history's software agents, which are all read in order. Every pattern is linear
(bounded repetitions, no nesting). Standard library only.
"""

from __future__ import annotations

import re
from typing import Any, Final

from openverify_vision.guarded.text import SURROGATES, clip_text, xmp_date

MAX_XMP_SCAN_BYTES: Final = 64 * 1024
MAX_XMP_HISTORY: Final = 32
MAX_XMP_STRING_LENGTH: Final = 256

_DECLARATION: Final = re.compile(r"<!\s*(?:DOCTYPE|ENTITY)", re.IGNORECASE)
_PACKET_MARKERS: Final = ("xmpmeta", "rdf:RDF", "<rdf:")
_ENTITY: Final = re.compile(r"&(?:(lt|gt|amp|quot|apos)|#(\d{1,7})|#x([0-9A-Fa-f]{1,6}));")
_PREDEFINED: Final = {"lt": "<", "gt": ">", "amp": "&", "quot": '"', "apos": "'"}
_MAX_CODE_POINT: Final = 0x10FFFF

_TEXT_FIELDS: Final = {
    "creator_tool": "CreatorTool",
    "producer": "Producer",
    "document_id": "DocumentID",
    "instance_id": "InstanceID",
}
_DATE_FIELDS: Final = {
    "create_date": "CreateDate",
    "modify_date": "ModifyDate",
    "metadata_date": "MetadataDate",
}


def _property(local: str) -> re.Pattern[str]:
    """``prefix:local`` as an attribute or as a simple element, capturing its value."""
    prefix = r"(?<![\w:.-])[A-Za-z][\w.-]{0,31}:" + local
    return re.compile(
        prefix + r"\s{0,16}=\s{0,16}(?:\"([^\"]{0,4096})\"|'([^']{0,4096})')"
        r"|<" + prefix + r"(?:\s[^>]{0,512})?>([^<]{0,4096})</"
    )


_PATTERNS: Final = {
    local: _property(local) for local in (*_TEXT_FIELDS.values(), *_DATE_FIELDS.values())
}
_AGENT: Final = _property("softwareAgent")


def _decode(data: bytes) -> str:
    """The packet's text: UTF-16 by its byte-order mark or its first ``<``, else UTF-8."""
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return data.decode("utf-16", errors="replace")
    if data.startswith(b"<\x00"):
        return data.decode("utf-16-le", errors="replace")
    if data.startswith(b"\x00<"):
        return data.decode("utf-16-be", errors="replace")
    return data.decode("utf-8", errors="replace").removeprefix("﻿")


def _unescape(value: str) -> str:
    def replace(found: re.Match[str]) -> str:
        named, decimal, hexadecimal = found.groups()
        if named:
            return _PREDEFINED[named]
        code = int(decimal) if decimal else int(hexadecimal, 16)
        if code > _MAX_CODE_POINT or code in SURROGATES:
            return ""
        return chr(code)

    return _ENTITY.sub(replace, value)


def _value(found: re.Match[str]) -> str | None:
    raw = next((group for group in found.groups() if group is not None), "")
    return clip_text(_unescape(raw), MAX_XMP_STRING_LENGTH)


def _first(text: str, local: str) -> str | None:
    found = _PATTERNS[local].search(text)
    return None if found is None else _value(found)


def scan_xmp(packet: bytes) -> dict[str, Any] | None:
    """The contract's ``XmpFields`` of the first 64 KiB of ``packet``; ``None`` when it is not
    an XMP packet or declares a document type or an entity."""
    text = _decode(packet[:MAX_XMP_SCAN_BYTES])
    if _DECLARATION.search(text) or not any(marker in text for marker in _PACKET_MARKERS):
        return None
    fields: dict[str, Any] = {name: _first(text, local) for name, local in _TEXT_FIELDS.items()}
    for name, local in _DATE_FIELDS.items():
        raw = _first(text, local)
        fields[name] = None if raw is None else xmp_date(raw)
    agents: list[str] = []
    for found in _AGENT.finditer(text):
        agent = _value(found)
        if agent is not None:
            agents.append(agent)
        if len(agents) == MAX_XMP_HISTORY:
            break
    fields["history_agents"] = agents
    order = (
        "creator_tool",
        "producer",
        "create_date",
        "modify_date",
        "metadata_date",
        "document_id",
        "instance_id",
        "history_agents",
    )
    return {name: fields[name] for name in order}
