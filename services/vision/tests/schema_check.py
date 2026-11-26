"""A small JSON Schema (2020-12) checker for the keywords the contract schemas here use.

``jsonschema`` is not a dependency of the vision service, and Workflow 4A Stage 2 adds none, so the
tests check documents against ``contracts/fixtures/**/*.schema.json`` with this: ``type``,
``const``, ``enum``, ``required``, ``properties``, ``additionalProperties``, ``items``,
``pattern``, ``minimum``, ``maximum`` and ``minLength``. Annotations (``$schema``, ``$id``,
``title``, ``description``, ``format``) are ignored. An unknown keyword fails loudly, so a schema
that grows past this checker cannot pass silently.
"""

from __future__ import annotations

import re
from typing import Any

_ANNOTATIONS = frozenset({"$schema", "$id", "title", "description", "format"})
_TYPES: dict[str, tuple[type, ...]] = {
    "object": (dict,),
    "array": (list,),
    "string": (str,),
    "boolean": (bool,),
    "null": (type(None),),
}


def _is(instance: object, kind: str) -> bool:
    if kind == "integer":
        return isinstance(instance, int) and not isinstance(instance, bool)
    if kind == "number":
        return isinstance(instance, int | float) and not isinstance(instance, bool)
    return isinstance(instance, _TYPES[kind])


def errors(instance: object, schema: dict[str, Any], path: str = "$") -> list[str]:  # noqa: PLR0912 - one branch per keyword
    """Every way ``instance`` breaks ``schema``, as ``path: problem`` strings."""
    found: list[str] = []
    for keyword, value in schema.items():
        if keyword in _ANNOTATIONS:
            continue
        if keyword == "type":
            kinds = value if isinstance(value, list) else [value]
            if not any(_is(instance, kind) for kind in kinds):
                found.append(f"{path}: not of type {value}")
        elif keyword == "const":
            if instance != value or type(instance) is not type(value):
                found.append(f"{path}: not {value!r}")
        elif keyword == "enum":
            if instance not in value:
                found.append(f"{path}: {instance!r} not one of {value}")
        elif keyword == "required":
            if isinstance(instance, dict):
                found += [f"{path}: missing {key!r}" for key in value if key not in instance]
        elif keyword == "properties":
            if isinstance(instance, dict):
                for key, sub in value.items():
                    if key in instance:
                        found += errors(instance[key], sub, f"{path}.{key}")
        elif keyword == "additionalProperties":
            if isinstance(instance, dict):
                known = set(schema.get("properties", {}))
                for key, item in instance.items():
                    if key in known:
                        continue
                    if value is False:
                        found.append(f"{path}: unexpected {key!r}")
                    elif isinstance(value, dict):
                        found += errors(item, value, f"{path}.{key}")
        elif keyword == "items":
            if isinstance(instance, list):
                for index, item in enumerate(instance):
                    found += errors(item, value, f"{path}[{index}]")
        elif keyword == "pattern":
            if isinstance(instance, str) and re.search(value, instance) is None:
                found.append(f"{path}: {instance!r} does not match {value}")
        elif keyword == "minimum":
            if _is(instance, "number") and float(str(instance)) < value:
                found.append(f"{path}: {instance} < {value}")
        elif keyword == "maximum":
            if _is(instance, "number") and float(str(instance)) > value:
                found.append(f"{path}: {instance} > {value}")
        elif keyword == "minLength":
            if isinstance(instance, str) and len(instance) < value:
                found.append(f"{path}: shorter than {value}")
        else:
            raise NotImplementedError(f"schema_check does not know the keyword {keyword!r}")
    return found
