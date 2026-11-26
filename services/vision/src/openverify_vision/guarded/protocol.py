"""C60.2: how the parent and the guarded child talk, over the child's stdin and stdout.

Both directions are the same framing: the magic ``OVG1``, then frames, each a 4-byte big-endian
length and its bytes. The request is two frames, a JSON header (the task, its parameters and the
limits) and the document; the answer is a JSON header and the binary frames it names (page
rasters, an embedded JPEG). Standard library only: the child imports this module.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import BinaryIO, Final

MAGIC: Final = b"OVG1"

MAX_REQUEST_HEADER_BYTES: Final = 64 * 1024
"""The request header is the parent's own small JSON object."""

OVER_LIMITS_EXIT_STATUS: Final = 3
"""The child's exit status when Python ran out of its address space (``MemoryError`` under
``RLIMIT_AS``): the document took it past its own limits, which a retry cannot lift (Workflow 5C
review P003)."""

_LENGTH_BYTES: Final = 4
_MAX_FRAME: Final = 2**32 - 1


class ProtocolError(ValueError):
    """Bytes that are not a well-formed sequence of frames."""


class TaskRefusal(Exception):  # noqa: N818 - a refusal is an answer, not an error
    """A task refusing its document with ``code`` (the parent's ``REFUSAL_CODES``). It lives
    here, not in the worker: the worker runs as ``__main__``, so a class defined there would be
    a different class from the one the tasks import."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def pack(frames: Sequence[bytes]) -> bytes:
    """``frames`` behind the magic, each with its 4-byte big-endian length."""
    parts = [MAGIC]
    for frame in frames:
        if len(frame) > _MAX_FRAME:
            raise ProtocolError("a frame is longer than 4 GiB")
        parts.append(len(frame).to_bytes(_LENGTH_BYTES, "big"))
        parts.append(bytes(frame))
    return b"".join(parts)


def unpack(data: bytes, *, max_frames: int) -> list[bytes]:
    """The frames of ``data``, refusing a bad magic, a cut frame, trailing bytes or more than
    ``max_frames`` frames."""
    if not data.startswith(MAGIC):
        raise ProtocolError("not a guarded-worker message")
    view = memoryview(data)
    position = len(MAGIC)
    frames: list[bytes] = []
    while position < len(view):
        if len(frames) == max_frames:
            raise ProtocolError(f"more than {max_frames} frames")
        if position + _LENGTH_BYTES > len(view):
            raise ProtocolError("a frame length is cut short")
        length = int.from_bytes(view[position : position + _LENGTH_BYTES], "big")
        position += _LENGTH_BYTES
        if position + length > len(view):
            raise ProtocolError("a frame is cut short")
        frames.append(bytes(view[position : position + length]))
        position += length
    return frames


def _read_exactly(stream: BinaryIO, count: int) -> bytes:
    chunks: list[bytes] = []
    remaining = count
    while remaining:
        chunk = stream.read(remaining)
        if not chunk:
            raise ProtocolError("the stream ended inside a frame")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def read_magic(stream: BinaryIO) -> None:
    """Consume the magic at the start of ``stream``, refusing anything else."""
    if _read_exactly(stream, len(MAGIC)) != MAGIC:
        raise ProtocolError("not a guarded-worker message")


def read_frame(stream: BinaryIO, *, max_bytes: int) -> bytes:
    """The next frame of ``stream``, refusing one longer than ``max_bytes`` before reading it."""
    length = int.from_bytes(_read_exactly(stream, _LENGTH_BYTES), "big")
    if length > max_bytes:
        raise ProtocolError(f"a frame of {length} bytes is over the {max_bytes}-byte limit")
    return _read_exactly(stream, length)
