"""The seed record a scenario plans from (C268.3): what `seed:load` wrote to its 0600 secrets file.

`pnpm --filter @openverify/api seed:load ... --secrets-file /tmp/openverify-load/seed.json` writes
one JSON object (schema `openverify/load-seed@1`): the API keys of each scenario's pool with the
environment each belongs to, the console users (email, password, TOTP secret, organisation and the
one documentation address each signs in from), the ids each scenario reads or acts on, and single
references (a template, a connection, a list). Every value is synthetic; the file is mode 0600 under
/tmp and is never copied, printed or committed. `Seed.load` refuses a file other users can read.
"""

from __future__ import annotations

import json
import stat
from dataclasses import dataclass
from pathlib import Path

SEED_SCHEMA = "openverify/load-seed@1"


@dataclass(frozen=True, slots=True, repr=False)
class Key:
    """An API key's token (a secret: in memory only) and the environment it belongs to."""

    token: str
    environment: str

    def __repr__(self) -> str:  # never print a token
        return f"Key(environment={self.environment!r})"


@dataclass(frozen=True, slots=True, repr=False)
class User:
    """A console user: its email at example.com, password and TOTP secret (secrets), organisation
    and the documentation address it signs in from."""

    email: str
    password: str
    totp_secret: str
    organisation: str
    address: str

    def __repr__(self) -> str:
        return f"User(organisation={self.organisation!r})"


class SeedError(ValueError):
    """The seed record is missing, unreadable, too open, or lacks what a scenario needs."""


@dataclass(frozen=True, slots=True)
class Seed:
    """The seed record."""

    scale: str
    keys: dict[str, tuple[Key, ...]]
    users: tuple[User, ...]
    ids: dict[str, tuple[str, ...]]
    refs: dict[str, str]

    @staticmethod
    def from_json(data: object) -> Seed:
        if not isinstance(data, dict) or data.get("schema") != SEED_SCHEMA:
            raise SeedError(f"the seed record is not {SEED_SCHEMA}")
        keys = {
            str(pool): tuple(Key(str(k["token"]), str(k["environment"])) for k in entries)
            for pool, entries in dict(data.get("keys", {})).items()
        }
        users = tuple(
            User(
                str(u["email"]),
                str(u["password"]),
                str(u["totp-secret"]),
                str(u["organisation"]),
                str(u["address"]),
            )
            for u in list(data.get("users", []))
        )
        ids = {
            str(k): tuple(str(v) for v in values) for k, values in dict(data.get("ids", {})).items()
        }
        refs = {str(k): str(v) for k, v in dict(data.get("refs", {})).items()}
        return Seed(str(data.get("scale", "")), keys, users, ids, refs)

    @staticmethod
    def load(path: Path) -> Seed:
        """Reads the record, refusing a file any other user may read or write (it holds secrets)."""
        try:
            mode = path.stat().st_mode
        except FileNotFoundError as error:
            raise SeedError(f"no seed record at {path}: run seed:load first") from error
        if mode & (stat.S_IRWXG | stat.S_IRWXO):
            raise SeedError(f"{path} must be mode 0600: it holds the seed's secrets")
        return Seed.from_json(json.loads(path.read_text(encoding="utf-8")))

    def pool(self, name: str) -> tuple[Key, ...]:
        found = self.keys.get(name, ())
        if not found:
            raise SeedError(f"the seed has no key pool {name}")
        return found

    def id_pool(self, name: str) -> tuple[str, ...]:
        found = self.ids.get(name, ())
        if not found:
            raise SeedError(f"the seed has no ids {name}")
        return found

    def ref(self, name: str) -> str:
        if name not in self.refs:
            raise SeedError(f"the seed has no reference {name}")
        return self.refs[name]
