"""scripts/fetch_fixtures.py --harvest-calibration: building the C49.1 calibration manifest.

The harvest walks the Commons portrait categories, reads each file's licence templates, visible
categories, structured-data depicts (P180) and date, resolves people through Wikidata (an item
that is a human, or a category item whose main topic is one), and keeps a file only when exactly
one person is named and every source agrees. Identities with at least two distinct photos are
downloaded, pinned (SHA-256 from the bytes, Commons' SHA-1 and size checked) and written under
pseudonymous ids.

Everything runs against :class:`CommonsWorld`, a fake of the two APIs and the upload server, served
through the script's own polite opener on a :class:`fetch_script.FakeClock`: no network, no real
waiting. The "people" are invented; payloads are plain bytes, never a photo.
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import threading
import urllib.error
import urllib.parse
from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from http.client import HTTPMessage
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

from fetch_script import FakeClock, FakeWeb, Reply, load_script

COMMONS = "https://commons.wikimedia.org/w/api.php"
WIKIDATA = "https://www.wikidata.org/w/api.php"
MB = 1_000_000


@pytest.fixture(scope="module")
def ff() -> ModuleType:
    return load_script()


def commons_url(name: str) -> str:
    digest = hashlib.md5(name.encode()).hexdigest()  # noqa: S324 - Commons' directory scheme
    return f"https://upload.wikimedia.org/wikipedia/commons/{digest[0]}/{digest[:2]}/{name}"


def payload(title: str) -> bytes:
    return f"harvest test bytes of {title}, not a photo".encode() * 8


# --- the fake world -------------------------------------------------------------------------------


@dataclass
class FakeFile:
    title: str
    templates: tuple[str, ...] = ("PD-USGov-NASA",)
    categories: tuple[str, ...] = ()
    depicts: tuple[str, ...] = ()
    date: str | None = None
    inception: str | None = None
    mime: str = "image/jpeg"
    size: int | None = None
    sha1: str | None = None
    served: bytes | None = None
    """The bytes the upload server sends (default: :func:`payload`)."""

    @property
    def name(self) -> str:
        return self.title.removeprefix("File:").replace(" ", "_")

    @property
    def body(self) -> bytes:
        return self.served if self.served is not None else payload(self.title)

    @property
    def declared_sha1(self) -> str:
        return self.sha1 or hashlib.sha1(payload(self.title)).hexdigest()  # noqa: S324

    @property
    def declared_size(self) -> int:
        return self.size if self.size is not None else len(payload(self.title))


@dataclass
class FakeItem:
    instance_of: tuple[str, ...] = ("Q5",)
    main_topic: tuple[str, ...] = ()
    sex: tuple[str, ...] = ()
    redirect_to: str | None = None


@dataclass
class FakeCategory:
    item: str | None = None
    parents: tuple[str, ...] = ()
    members: tuple[str, ...] = ()
    """Files (``File:``) and subcategories (``Category:``), in order."""


def claim(value: dict[str, Any]) -> dict[str, Any]:
    return {"mainsnak": {"snaktype": "value", "datavalue": {"value": value}}}


def item_claim(qid: str) -> dict[str, Any]:
    return claim({"entity-type": "item", "id": qid})


@dataclass
class CommonsWorld:
    """The two APIs and the upload server, answering the way formatversion=2 does."""

    files: dict[str, FakeFile]
    categories: dict[str, FakeCategory]
    items: dict[str, FakeItem]
    clock: FakeClock
    page_size: int = 2
    """Category members and multi-valued page props come in pages this long (continuation)."""
    maxlag_once: bool = False
    max_url: int = 8000
    """Longer request URLs are refused with 414, as Wikimedia does past about 8 KiB."""
    api_calls: list[dict[str, str]] = field(default_factory=list)
    downloads: list[str] = field(default_factory=list)
    log: list[tuple[str, float]] = field(default_factory=list)
    """Every request: its URL and the clock when it started."""

    @property
    def times(self) -> list[float]:
        return [at for _, at in self.log]

    def __call__(self, url: str, timeout: float) -> io.BytesIO:
        assert timeout > 0
        self.log.append((url, self.clock()))
        if len(url) > self.max_url:
            raise urllib.error.HTTPError(url, 414, "URI Too Long", HTTPMessage(), io.BytesIO())
        base, _, query = url.partition("?")
        if base in (COMMONS, WIKIDATA):
            params = dict(urllib.parse.parse_qsl(query, keep_blank_values=True))
            self.api_calls.append({"base": base, **params})
            if self.maxlag_once:
                self.maxlag_once = False
                return io.BytesIO(json.dumps({"error": {"code": "maxlag", "lag": 3}}).encode())
            answer = self.commons(params) if base == COMMONS else self.wikidata(params)
            return io.BytesIO(json.dumps(answer).encode())
        self.downloads.append(url)
        for fake in self.files.values():
            if commons_url(fake.name) == url:
                return io.BytesIO(fake.body)
        return FakeWeb({})(url, timeout)  # 404

    # --- Commons --------------------------------------------------------------------------------

    def commons(self, params: Mapping[str, str]) -> dict[str, Any]:
        for key in ("format", "formatversion", "maxlag"):
            assert key in params, key
        if params.get("action") == "wbgetentities":
            return self.mediainfo(params["ids"].split("|"))
        if params.get("list") == "categorymembers":
            return self.members(params)
        titles = params["titles"].split("|")
        assert len(titles) <= 50
        if titles[0].startswith("Category:"):
            return self.category_pages(titles, params)
        return self.file_pages(titles, params)

    def members(self, params: Mapping[str, str]) -> dict[str, Any]:
        category = self.categories[params["cmtitle"]]
        start = int(params.get("cmcontinue", "0"))
        chunk = category.members[start : start + self.page_size]
        found = [
            {"ns": 6 if t.startswith("File:") else 14, "title": t,
             "type": "file" if t.startswith("File:") else "subcat"}
            for t in chunk
        ]  # fmt: skip
        answer: dict[str, Any] = {"query": {"categorymembers": found}}
        if start + self.page_size < len(category.members):
            answer["continue"] = {"cmcontinue": str(start + self.page_size), "continue": "-||"}
        return answer

    def file_pages(self, titles: list[str], params: Mapping[str, str]) -> dict[str, Any]:
        props = params["prop"].split("|")
        offset = int(params.get("tlcontinue", "0"))
        pages: list[dict[str, Any]] = []
        more = False
        for title in titles:
            fake = self.files.get(title)
            if fake is None:
                pages.append({"ns": 6, "title": title, "missing": True})
                continue
            page: dict[str, Any] = {"pageid": self.pageid(title), "ns": 6, "title": title}
            templates = [{"ns": 10, "title": f"Template:{t}"} for t in fake.templates]
            templates.append({"ns": 10, "title": "Template:Information"})
            chunk = templates[offset : offset + self.page_size]
            more = more or offset + self.page_size < len(templates)
            page["templates"] = chunk
            if offset == 0:
                if "imageinfo" in props:
                    info: dict[str, Any] = {
                        "size": fake.declared_size,
                        "url": commons_url(fake.name)
                        + "?utm_source=commons.wikimedia.org&utm_campaign=imageinfo",
                        "descriptionurl": f"https://commons.wikimedia.org/wiki/File:{fake.name}",
                        "sha1": fake.declared_sha1,
                        "mime": fake.mime,
                        "extmetadata": {}
                        if fake.date is None
                        else {
                            "DateTimeOriginal": {"value": fake.date, "source": "commons-desc-page"}
                        },
                    }
                    page["imageinfo"] = [info]
                if "categories" in props:
                    assert params.get("clshow") == "!hidden"
                    page["categories"] = [{"ns": 14, "title": c} for c in fake.categories]
                if "revisions" in props:
                    page["revisions"] = [{"revid": 5_000_000 + self.pageid(title)}]
            pages.append(page)
        answer: dict[str, Any] = {"query": {"pages": pages}}
        if more:
            answer["continue"] = {"tlcontinue": str(offset + self.page_size), "continue": "||"}
        return answer

    def pageid(self, title: str) -> int:
        return 100 + list(self.files).index(title)

    def category_pages(self, titles: list[str], params: Mapping[str, str]) -> dict[str, Any]:
        assert params.get("ppprop") == "wikibase_item"
        assert params.get("clshow") == "!hidden"
        pages: list[dict[str, Any]] = []
        for title in titles:
            fake = self.categories.get(title)
            if fake is None:
                pages.append({"ns": 14, "title": title, "missing": True})
                continue
            page: dict[str, Any] = {"ns": 14, "title": title}
            if fake.item is not None:
                page["pageprops"] = {"wikibase_item": fake.item}
            page["categories"] = [{"ns": 14, "title": p} for p in fake.parents]
            pages.append(page)
        return {"query": {"pages": pages}}

    def mediainfo(self, ids: list[str]) -> dict[str, Any]:
        assert len(ids) <= 50
        by_pageid = {f"M{self.pageid(title)}": fake for title, fake in self.files.items()}
        entities: dict[str, Any] = {}
        for mid in ids:
            fake = by_pageid.get(mid)
            if fake is None or (not fake.depicts and fake.inception is None):
                entities[mid] = {"id": mid, "missing": ""}
                continue
            statements: dict[str, Any] = {}
            if fake.depicts:
                statements["P180"] = [item_claim(q) for q in fake.depicts]
            if fake.inception is not None:
                statements["P571"] = [claim({"time": fake.inception, "precision": 9})]
            entities[mid] = {"type": "mediainfo", "id": mid, "statements": statements}
        return {"entities": entities}

    # --- Wikidata -------------------------------------------------------------------------------

    def wikidata(self, params: Mapping[str, str]) -> dict[str, Any]:
        assert params.get("action") == "wbgetentities"
        assert params.get("props") == "claims"
        ids = params["ids"].split("|")
        assert len(ids) <= 50
        entities: dict[str, Any] = {}
        for qid in ids:
            fake = self.items.get(qid)
            if fake is None:
                entities[qid] = {"id": qid, "missing": ""}
                continue
            target, entity_id = fake, qid
            if fake.redirect_to is not None:
                entity_id, target = fake.redirect_to, self.items[fake.redirect_to]
            claims: dict[str, Any] = {"P31": [item_claim(q) for q in target.instance_of]}
            if target.main_topic:
                claims["P301"] = [item_claim(q) for q in target.main_topic]
            if target.sex:
                claims["P21"] = [item_claim(q) for q in target.sex]
            entity: dict[str, Any] = {"type": "item", "id": entity_id, "claims": claims}
            if fake.redirect_to is not None:
                entity["redirects"] = {"from": qid, "to": entity_id}
            entities[entity_id] = entity
        return {"entities": entities}


FEMALE, MALE, NON_BINARY = "Q6581072", "Q6581097", "Q48270"


def world(clock: FakeClock) -> CommonsWorld:
    """Invented people: Alpha (Q100), Bravo (Q200 behind a category item), Charlie (Q300, no
    binary sex), Golf (Q900, seven portraits) and Foxtrot (Q800, one download tampered)."""
    gina = [FakeFile(f"File:Golf portrait {year}.jpg", depicts=("Q900",), date=str(year))
            for year in range(2000, 2007)]  # fmt: skip
    files = [
        FakeFile("File:Alpha 2001.jpg", depicts=("Q100", "Q500"), date="2001-05"),
        FakeFile(
            "File:Alpha 2009.jpg",
            depicts=("Q700",),
            categories=("Category:Alpha Example", "Category:Men looking at viewer"),
            date="<time datetime='2009-03-01'>1 March 2009</time>",
        ),
        FakeFile(
            "File:Alpha 2009 copy.jpg",
            depicts=("Q100",),
            sha1=hashlib.sha1(payload("File:Alpha 2009.jpg")).hexdigest(),  # noqa: S324
            served=payload("File:Alpha 2009.jpg"),
            size=len(payload("File:Alpha 2009.jpg")),
        ),
        FakeFile(
            "File:Bravo 1990.jpg",
            categories=("Category:Bravo Example in 1990",),
            inception="+1990-00-00T00:00:00Z",
        ),
        FakeFile(
            "File:Bravo 1995.jpg",
            categories=("Category:Bravo Example",),
            date="between 1994 and 1995",
            inception="+1995-00-00T00:00:00Z",
        ),
        FakeFile("File:Bravo 1999.jpg", categories=("Category:Men looking at viewer",)),
        FakeFile("File:Charlie 1.jpg", depicts=("Q300",), templates=("PD-USGov-DOS",)),
        FakeFile(
            "File:Charlie 2.jpg",
            depicts=("Q300",),
            templates=("PD-USGov-Military", "PD-USGov-Military-Air Force"),
        ),
        FakeFile(
            "File:Charlie 3.jpg",
            depicts=("Q300",),
            templates=("PD-USGov-DOS", "Personality rights"),
        ),
        FakeFile("File:Alpha meets Echo.jpg", depicts=("Q100", "Q600")),
        FakeFile(
            "File:Echo conflict.jpg", depicts=("Q600",), categories=("Category:Alpha Example",)
        ),
        FakeFile("File:Echo 2.jpg", depicts=("Q600",), templates=("PD-USGov-Congress",)),
        FakeFile("File:Echo 3.jpg", depicts=("Q600",), templates=("PD-USGov-NASA", "Cc-by-sa-4.0")),
        FakeFile("File:Echo 4.jpg", depicts=("Q600",), templates=("PD-USGov-DOD",)),
        FakeFile("File:STS-1 crew portrait.jpg", depicts=("Q100",)),
        FakeFile("File:Alpha 2015.tif", depicts=("Q100",), mime="image/tiff"),
        FakeFile("File:Alpha huge.jpg", depicts=("Q100",), size=41 * MB),
        FakeFile("File:Foxtrot 1.jpg", depicts=("Q800",)),
        FakeFile(
            "File:Foxtrot 2.jpg", depicts=("Q800",), served=b"a re-upload, not the pinned file"
        ),
        *gina,
    ]
    root = [f.title for f in files[:10]] + ["Category:Sub"]
    sub = [f.title for f in files[10:]] + ["Category:Deeper"]
    categories = {
        "Category:Root": FakeCategory(members=(*root,)),
        "Category:Sub": FakeCategory(members=(*sub,), parents=("Category:Root",)),
        "Category:Deeper": FakeCategory(members=("File:Too deep.jpg",)),
        "Category:Alpha Example": FakeCategory(item="Q100", parents=("Category:People",)),
        "Category:Bravo Example in 1990": FakeCategory(
            parents=("Category:Bravo Example by year", "Category:1990 portraits")
        ),
        "Category:Bravo Example by year": FakeCategory(parents=("Category:Bravo Example",)),
        "Category:Bravo Example": FakeCategory(item="Q400", parents=("Category:People",)),
        "Category:Men looking at viewer": FakeCategory(parents=("Category:Men",)),
        "Category:1990 portraits": FakeCategory(item="Q1990"),
    }
    items = {
        "Q100": FakeItem(sex=(FEMALE,)),
        "Q200": FakeItem(sex=(MALE,)),
        "Q300": FakeItem(sex=(NON_BINARY,)),
        "Q400": FakeItem(instance_of=("Q4167836",), main_topic=("Q200",)),
        "Q500": FakeItem(instance_of=("Q11460",)),
        "Q600": FakeItem(sex=(FEMALE,)),
        "Q700": FakeItem(redirect_to="Q100"),
        "Q800": FakeItem(sex=(MALE,)),
        "Q900": FakeItem(sex=(FEMALE,)),
        "Q1990": FakeItem(instance_of=("Q4167836",)),
    }
    files.append(FakeFile("File:Too deep.jpg", depicts=("Q900",)))
    return CommonsWorld({f.title: f for f in files}, categories, items, clock)


def harvest(
    ff: ModuleType, tmp_path: Path, the_world: CommonsWorld, **options: Any
) -> tuple[Any, Path, Path, list[str]]:
    clock = the_world.clock
    limiter = ff.RateLimiter(clock=clock, sleep=clock.sleep)
    polite = ff.PoliteOpener(the_world, limiter)
    api = ff.MediaWikiApi(polite, limiter)
    dest, manifest = tmp_path / "faces" / "calibration", tmp_path / "calibration-manifest.json"
    lines: list[str] = []
    summary = ff.harvest_calibration(
        api,
        polite,
        dest,
        manifest,
        limiter=limiter,
        roots=("Category:Root",),
        depth=1,
        log=lines.append,
        **options,
    )
    return summary, dest, manifest, lines


def groups(manifest: Path) -> dict[frozenset[str], dict[str, Any]]:
    """The manifest's identities by the set of their file names."""
    document = json.loads(manifest.read_text(encoding="utf-8"))
    found = {}
    for identity in document["identities"]:
        names = frozenset(image["url"].rsplit("/", 1)[1] for image in identity["images"])
        found[names] = identity
    return found


# --- the API client -------------------------------------------------------------------------------


def test_every_api_request_asks_for_json_v2_and_carries_maxlag(ff: ModuleType) -> None:
    url = ff.api_request_url(COMMONS, {"action": "query", "titles": "File:A b.jpg"})

    base, _, query = url.partition("?")
    params = dict(urllib.parse.parse_qsl(query))
    assert base == COMMONS
    assert params == {
        "format": "json",
        "formatversion": "2",
        "maxlag": "5",
        "action": "query",
        "titles": "File:A b.jpg",
    }


def test_the_client_backs_off_and_retries_when_the_servers_lag(ff: ModuleType) -> None:
    clock = FakeClock()
    url = ff.api_request_url(COMMONS, {"action": "query"})
    lagged = json.dumps({"error": {"code": "maxlag", "info": "lagged", "lag": 7}}).encode()
    web = FakeWeb({url: [Reply(body=lagged), Reply(body=b'{"query": {"pages": []}}')]}, clock)
    limiter = ff.RateLimiter(clock=clock, sleep=clock.sleep)
    api = ff.MediaWikiApi(ff.PoliteOpener(web, limiter), limiter)

    assert api(COMMONS, {"action": "query"}) == {"query": {"pages": []}}
    assert len(web.calls) == 2
    assert web.times[1] - web.times[0] >= 7


def test_the_client_gives_up_on_an_api_error_or_endless_lag(ff: ModuleType) -> None:
    clock = FakeClock()
    url = ff.api_request_url(COMMONS, {"action": "query"})
    lagged = json.dumps({"error": {"code": "maxlag", "lag": 1}}).encode()
    bad = json.dumps({"error": {"code": "badvalue", "info": "Unrecognized value"}}).encode()
    limiter = ff.RateLimiter(clock=clock, sleep=clock.sleep)

    lagging = ff.MediaWikiApi(
        ff.PoliteOpener(FakeWeb({url: Reply(body=lagged)}, clock), limiter), limiter
    )
    with pytest.raises(ff.RateLimitedError, match="lag"):
        lagging(COMMONS, {"action": "query"})
    failing = ff.MediaWikiApi(
        ff.PoliteOpener(FakeWeb({url: Reply(body=bad)}, clock), limiter), limiter
    )
    with pytest.raises(ff.FetchError, match="badvalue"):
        failing(COMMONS, {"action": "query"})


def test_the_client_refuses_an_answer_larger_than_its_limit(ff: ModuleType) -> None:
    clock = FakeClock()
    url = ff.api_request_url(COMMONS, {"action": "query"})
    web = FakeWeb({url: Reply(body=b'{"query": "' + b"x" * 100 + b'"}')}, clock)
    limiter = ff.RateLimiter(clock=clock, sleep=clock.sleep)
    api = ff.MediaWikiApi(ff.PoliteOpener(web, limiter), limiter, max_bytes=50)

    with pytest.raises(ff.FetchError, match="larger"):
        api(COMMONS, {"action": "query"})


# --- the rules, one at a time ---------------------------------------------------------------------


@pytest.mark.parametrize(
    ("templates", "expected"),
    [
        ({"PD-USGov-NASA", "Information"}, "PD-USGov-NASA"),
        ({"PD-USGov-DOS", "PD-USGov-State", "PD-USGov"}, "PD-USGov-DOS"),
        ({"PD-USGov-Military", "PD-USGov-Military-Air Force"}, "PD-USGov-Military-Air Force"),
        (
            {"PD-USGov-Military-Army-USACE", "PD-USGov-Military-Army"},
            "PD-USGov-Military-Army-USACE",
        ),
        ({"PD-USGov-NASA", "PD-USGov-NASA/en", "PD-USGov-NASA/layout"}, "PD-USGov-NASA"),
        ({"PD-USGov-NASA", "Personality rights"}, None),
        ({"PD-USGov-NASA", "PD-USGov-Congress"}, None),
        ({"PD-USGov-NASA", "PD-USGov-Congress-Bioguide"}, None),
        ({"PD-USGov-NASA", "Cc-by-sa-4.0"}, None),
        ({"PD-USGov-NASA", "Delete"}, None),
        ({"PD-USGov-DOD"}, None),
        ({"PD-USGov-State"}, None),
        ({"PD-USGov"}, None),
        (set(), None),
    ],
)
def test_only_nasa_state_and_military_portraits_without_a_restriction_qualify(
    ff: ModuleType, templates: set[str], expected: str | None
) -> None:
    assert ff.licence_template_of(frozenset(templates)) == expected


@pytest.mark.parametrize(
    ("date", "inception", "year"),
    [
        ("1962-02", None, 1962),
        ("<time class='dtstart' datetime='2009-03-01'>1 March 2009</time>", None, 2009),
        ("2019-09-04 10:12:00", 1990, 2019),
        ("between 1994 and 1995", 1995, 1995),
        ("circa 1970", None, 1970),
        ("1970s", 1972, 1972),
        ("unknown date", 1988, 1988),
        (None, None, None),
        ("1850", None, None),
    ],
)
def test_the_year_comes_from_the_date_field_else_the_structured_inception(
    ff: ModuleType, date: str | None, inception: int | None, year: int | None
) -> None:
    assert ff.year_of(date, inception) == year


def test_a_person_is_a_human_item_or_the_main_topic_of_a_category_item(ff: ModuleType) -> None:
    items = {
        "Q1": ff.WikidataItem("Q1", frozenset({"Q5"}), (), ()),
        "Q2": ff.WikidataItem("Q2", frozenset({"Q4167836"}), ("Q1",), ()),
        "Q3": ff.WikidataItem("Q3", frozenset({"Q4167836"}), ("Q9",), ()),
        "Q4": ff.WikidataItem("Q4", frozenset({"Q11460"}), (), ()),
        "Q5x": ff.WikidataItem("Q5x", frozenset({"Q4167836"}), ("Q1", "Q4"), ()),
    }

    assert ff.person_of_item("Q1", items) == "Q1"
    assert ff.person_of_item("Q2", items) == "Q1"
    assert ff.person_of_item("Q3", items) is None
    assert ff.person_of_item("Q4", items) is None
    assert ff.person_of_item("Q5x", items) is None
    assert ff.person_of_item(None, items) is None
    assert ff.person_of_item("Q404", items) is None


def test_a_category_names_a_person_itself_or_through_an_ancestor_it_names(ff: ModuleType) -> None:
    link = ff.CategoryLink
    links = {
        "Category:Bravo Example in 1990": link(
            None, ("Category:Bravo Example by year", "Category:1990")
        ),
        "Category:Bravo Example by year": link(None, ("Category:Bravo Example",)),
        "Category:Bravo Example": link("Q2", ()),
        "Category:Bravo Examples Jr": link(None, ("Category:Bravo Example",)),
        "Category:Mission 7": link(None, ("Category:Bravo Example",)),
        "Category:Bravo Example and Alpha Example": link(
            None, ("Category:Bravo Example", "Category:Alpha Example")
        ),
        "Category:Alpha Example": link("Q1", ()),
        "Category:1990": link(None, ()),
        "Category:Bravo Example in June 1990": link(None, ("Category:Bravo Example in 1990",)),
        "Category:Official portraits of Bravo Example": link(None, ("Category:Bravo Example",)),
        "Category:Bravo Example administration personnel": link(
            None, ("Category:Bravo Example administration",)
        ),
        "Category:Bravo Example administration": link(None, ("Category:Bravo Example",)),
        "Category:Bravo Example with Alpha Example in 1990": link(
            None, ("Category:Bravo Example in 1990", "Category:Alpha Example")
        ),
    }
    items = {
        "Q1": ff.WikidataItem("Q1", frozenset({"Q5"}), (), ()),
        "Q2": ff.WikidataItem("Q2", frozenset({"Q5"}), (), ()),
    }

    def persons(title: str) -> frozenset[str]:
        found: frozenset[str] = ff.category_persons(title, links, items)
        return found

    def mentions(title: str) -> frozenset[str]:
        found: frozenset[str] = ff.category_mentions(title, links, items)
        return found

    assert persons("Category:Bravo Example") == {"Q2"}
    assert persons("Category:Bravo Example in 1990") == {"Q2"}
    assert persons("Category:Bravo Example in June 1990") == {"Q2"}  # three levels up
    assert persons("Category:Official portraits of Bravo Example") == {"Q2"}
    assert persons("Category:Bravo Examples Jr") == frozenset()
    assert persons("Category:Mission 7") == frozenset()
    # a category about the person's administration, or naming two people, names no one person
    assert persons("Category:Bravo Example administration personnel") == frozenset()
    assert persons("Category:Bravo Example and Alpha Example") == frozenset()
    assert persons("Category:Bravo Example with Alpha Example in 1990") == frozenset()
    assert persons("Category:1990") == frozenset()
    assert persons("Category:Unknown") == frozenset()
    # ...but it mentions every person whose category it names: two mean several people
    assert mentions("Category:Bravo Example and Alpha Example") == {"Q1", "Q2"}
    assert mentions("Category:Bravo Example with Alpha Example in 1990") == {"Q1", "Q2"}
    assert mentions("Category:Bravo Example administration personnel") == {"Q2"}
    assert mentions("Category:Mission 7") == frozenset()


@pytest.mark.parametrize(
    ("depicts", "from_categories", "identity"),
    [
        (("Q1", "Q4"), set(), "Q1"),
        ((), {"Q2"}, "Q2"),
        (("Q2",), {"Q2"}, "Q2"),
        (("Q7",), set(), "Q1"),
        (("Q1", "Q2"), set(), None),
        (("Q1",), {"Q2"}, None),
        ((), {"Q1", "Q2"}, None),
        (("Q4",), set(), None),
        ((), set(), None),
    ],
)
def test_a_file_has_an_identity_only_when_every_source_names_the_same_one_person(
    ff: ModuleType, depicts: tuple[str, ...], from_categories: set[str], identity: str | None
) -> None:
    items = {
        "Q1": ff.WikidataItem("Q1", frozenset({"Q5"}), (), ()),
        "Q2": ff.WikidataItem("Q2", frozenset({"Q5"}), (), ()),
        "Q4": ff.WikidataItem("Q4", frozenset({"Q11460"}), (), ()),
    }
    items["Q7"] = items["Q1"]  # a redirect to Q1

    assert ff.identity_of(depicts, frozenset(from_categories), items) == identity


def test_more_portraits_than_the_cap_keep_the_span_of_the_years(ff: ModuleType) -> None:
    years = [2003, None, 2000, 2006, 2001, 2005, 2002, 2004]
    candidates = [(f"File:{i}.jpg", year) for i, year in enumerate(years)]

    picked = ff.spread(candidates, key=lambda c: (c[1] is None, c[1] or 0, c[0]), cap=5)

    assert [year for _, year in picked] == [2000, 2002, 2004, 2005, None]
    assert ff.spread(candidates[:3], key=lambda c: c[0], cap=5) == candidates[:3]


# --- the harvest ----------------------------------------------------------------------------------


def test_the_harvest_writes_a_manifest_the_fetcher_accepts(ff: ModuleType, tmp_path: Path) -> None:
    summary, dest, manifest, _ = harvest(ff, tmp_path, world(FakeClock()))

    images = ff.load_calibration_manifest(manifest)
    found = groups(manifest)
    expected = {
        frozenset({"Alpha_2001.jpg", "Alpha_2009.jpg"}): ("female", [2001, 2009]),
        frozenset({"Bravo_1990.jpg", "Bravo_1995.jpg"}): ("male", [1990, 1995]),
        frozenset({"Charlie_1.jpg", "Charlie_2.jpg"}): ("unknown", [None, None]),
        frozenset(f"Golf_portrait_{y}.jpg" for y in (2000, 2002, 2003, 2005, 2006)): (
            "female",
            [2000, 2002, 2003, 2005, 2006],
        ),
    }
    assert set(found) == set(expected)
    for names, (sex, years) in expected.items():
        identity = found[names]
        assert identity["sex"] == sex, names
        assert [image["year"] for image in identity["images"]] == years, names
    assert sorted(identity["id"] for identity in found.values()) == [
        "p0001",
        "p0002",
        "p0003",
        "p0004",
    ]
    assert summary.identities == 4
    assert summary.images == len(images) == 11
    for image in images:
        assert "?" not in image.url
        assert image.source_page.startswith("https://commons.wikimedia.org/wiki/File:")
        data = (dest / image.filename).read_bytes()
        assert hashlib.sha256(data).hexdigest() == image.sha256
        assert hashlib.sha1(data).hexdigest() == image.sha1  # noqa: S324
        assert len(data) == image.size
    charlie = next(i for n, i in found.items() if "Charlie_2.jpg" in n)
    assert {image["license_template"] for image in charlie["images"]} == {
        "PD-USGov-DOS",
        "PD-USGov-Military-Air Force",
    }


def test_the_manifest_names_no_one_and_carries_no_wikidata_id(
    ff: ModuleType, tmp_path: Path
) -> None:
    _, _, manifest, _ = harvest(ff, tmp_path, world(FakeClock()))
    text = manifest.read_text(encoding="utf-8")
    document = json.loads(text)

    assert re.search(r"\bQ[0-9]+\b", text) is None
    assert "wikidata.org/" not in text
    assert set(document) == {"schema_version", "description", "purpose", "takedown", "identities"}
    assert all(set(identity) == {"id", "sex", "images"} for identity in document["identities"])
    for identity in document["identities"]:
        for image in identity["images"]:
            assert set(image) <= {
                "id", "url", "source_page", "revision_id", "sha256", "sha1", "size",
                "license_template", "year",
            }  # fmt: skip


def test_the_harvest_counts_why_each_file_was_left_out(ff: ModuleType, tmp_path: Path) -> None:
    summary, _, _, lines = harvest(ff, tmp_path, world(FakeClock()))

    assert summary.files == 26
    assert dict(summary.left_out) == {
        "title": 1,  # a crew portrait
        "format": 1,  # a TIFF
        "size": 1,  # over 40 MB
        "licence": 4,  # Congress, a CC licence, DOD-only, personality rights
        "no_single_person": 3,  # two people, a conflict, nobody named
        "duplicate": 1,  # the same SHA-1 under another name
        "over_cap": 2,  # Golf's seven portraits, five kept
        "download": 1,  # Foxtrot's re-upload
        "single_photo": 1,  # Foxtrot, left with one photo
    }
    assert any("4 identities" in line for line in lines)


def test_files_deeper_than_the_depth_are_not_harvested(ff: ModuleType, tmp_path: Path) -> None:
    the_world = world(FakeClock())

    harvest(ff, tmp_path, the_world)

    titles = {t for call in the_world.api_calls for t in call.get("titles", "").split("|")}
    assert "File:Too deep.jpg" not in titles
    assert all(call.get("cmtitle") != "Category:Deeper" for call in the_world.api_calls)


def test_the_harvest_is_polite_and_survives_a_lagged_answer(ff: ModuleType, tmp_path: Path) -> None:
    the_world = world(FakeClock())
    the_world.maxlag_once = True

    harvest(ff, tmp_path, the_world, jobs=1)

    assert len(the_world.times) > 20
    gaps = [b - a for a, b in zip(the_world.times, the_world.times[1:], strict=False)]
    assert min(gaps) >= 1.0
    assert all(call["maxlag"] == "5" for call in the_world.api_calls)


def test_downloads_are_paced_to_the_bandwidth_limit(ff: ModuleType, tmp_path: Path) -> None:
    the_world = world(FakeClock())
    big = the_world.files["File:Alpha 2001.jpg"]
    big.served = b"x" * (5 * MB)
    big.size = 5 * MB
    big.sha1 = hashlib.sha1(big.served).hexdigest()  # noqa: S324

    harvest(ff, tmp_path, the_world, jobs=1)

    urls = [url for url, _ in the_world.log]
    position = urls.index(commons_url(big.name))
    started, following = the_world.times[position], the_world.times[position + 1]
    assert following - started >= 5 * MB * 8 / ff.MAX_DOWNLOAD_BITS_PER_SECOND
    assert ff.MAX_DOWNLOAD_BITS_PER_SECOND == 25_000_000


def big_original(ff: ModuleType, name: str, body: bytes) -> Any:
    return ff.CommonsFile(
        title=f"File:{name}",
        pageid=1,
        url=commons_url(name),
        source_page=f"https://commons.wikimedia.org/wiki/File:{name}",
        sha1=hashlib.sha1(body).hexdigest(),  # noqa: S324 - Commons pins SHA-1
        size=len(body),
        mime="image/jpeg",
        revision_id=1,
        templates=frozenset({"PD-USGov-NASA"}),
        categories=(),
        date=None,
    )


def test_two_downloads_at_once_hold_the_next_request_for_both(
    ff: ModuleType, tmp_path: Path
) -> None:
    """H010 (Workflow 4B review): each finished download held the next request back by its own
    bits only, as a deadline (``max``), so two downloads in flight together were held back by one
    of them and the average could reach twice the cap. The holds now add up."""
    clock = FakeClock()
    limiter = ff.RateLimiter(clock=clock, sleep=clock.sleep)
    bodies = {f"Big {index}.jpg": bytes([index]) * (5 * MB) for index in range(2)}
    files = [big_original(ff, name, body) for name, body in bodies.items()]
    # The two downloads wait for each other to open: they are in flight at the same time.
    web = FakeWeb(
        {commons_url(name): Reply(body=body) for name, body in bodies.items()},
        clock,
        barrier=threading.Barrier(2, timeout=10),
    )
    polite = ff.PoliteOpener(web, limiter)

    with ThreadPoolExecutor(max_workers=2) as pool:
        staged = list(
            pool.map(lambda file: ff._download_original(file, tmp_path, polite, limiter), files)
        )
    started = min(web.times)
    limiter.wait()

    assert [path.stat().st_size for path in staged] == [5 * MB, 5 * MB]
    assert web.max_in_flight == 2
    assert clock() - started >= 2 * 5 * MB * 8 / ff.MAX_DOWNLOAD_BITS_PER_SECOND - 1e-9


def test_group_photos_and_titles_naming_several_people_are_left_out(
    ff: ModuleType, tmp_path: Path
) -> None:
    the_world = world(FakeClock())
    added = {
        "File:Alpha at the reunion.jpg": ("Category:Group portrait photographs with 6 persons",),
        "File:Alpha at the pad.jpg": ("Category:2 men in Florida",),
        "File:Alpha at the dinner.jpg": ("Category:5 men and 1 woman",),
        "File:Alpha with Bravo in 2010.jpg": ("Category:Alpha Example and Bravo Example",),
        "File:Alpha, Bravo and Charlie.jpg": (),
        "File:Alpha & Bravo.jpg": (),
        "File:Kilo portrait.jpg": ("Category:Joe Example administration personnel",),
    }
    for title, categories in added.items():
        depicts = () if title.startswith("File:Kilo") else ("Q100",)
        the_world.files[title] = FakeFile(title, depicts=depicts, categories=categories)
    the_world.categories["Category:Alpha Example and Bravo Example"] = FakeCategory(
        parents=("Category:Alpha Example", "Category:Bravo Example")
    )
    the_world.categories["Category:Joe Example administration personnel"] = FakeCategory(
        parents=("Category:Joe Example administration",)
    )
    the_world.categories["Category:Joe Example administration"] = FakeCategory(
        parents=("Category:Joe Example",)
    )
    the_world.categories["Category:Joe Example"] = FakeCategory(item="Q950")
    the_world.items["Q950"] = FakeItem(sex=(MALE,))
    root = the_world.categories["Category:Root"]
    root.members = (*root.members, *added)

    summary, _, manifest, _ = harvest(ff, tmp_path, the_world)

    assert summary.left_out["several_people"] == 4  # three group categories, a two-person one
    assert summary.left_out["title"] == 1 + 2  # the crew portrait, "and", "&"
    assert summary.left_out["no_single_person"] == 3 + 1  # Kilo: the administration names no one
    names = {image.url.rsplit("/", 1)[1] for image in ff.load_calibration_manifest(manifest)}
    assert not any(name.startswith(("Alpha_at", "Alpha_with", "Kilo")) for name in names)


def test_the_walk_up_follows_only_ancestors_that_can_name_the_person(
    ff: ModuleType, tmp_path: Path
) -> None:
    the_world = world(FakeClock())
    the_world.categories["Category:1990 portraits"].parents = ("Category:Photographs by year",)
    the_world.categories["Category:Photographs by year"] = FakeCategory(
        parents=("Category:Photographs",)
    )

    harvest(ff, tmp_path, the_world)

    titles = {t for call in the_world.api_calls for t in call.get("titles", "").split("|")}
    assert "Category:Bravo Example by year" in titles  # "Bravo ...": it may lead to Bravo
    assert "Category:Bravo Example" in titles
    assert "Category:1990 portraits" not in titles  # neither "Bravo ..." nor named
    assert "Category:Photographs by year" not in titles


def test_long_titles_are_batched_so_no_request_exceeds_the_url_limit(
    ff: ModuleType, tmp_path: Path
) -> None:
    the_world = world(FakeClock())
    long_titles = [
        f"File:Officielles Porträt eines erfundenen Offiziers der Übung {'é' * 40} {n}.jpg"
        for n in range(60)
    ]
    for number, title in enumerate(long_titles):
        the_world.files[title] = FakeFile(
            title,
            depicts=("Q900",),
            categories=(f"Category:{title[5:-4]} Übersicht",),
            date=str(1950 + number),
        )
    root = the_world.categories["Category:Root"]
    root.members = (*root.members, *long_titles)

    summary, _, manifest, _ = harvest(ff, tmp_path, the_world)

    assert summary.files == 26 + 60
    assert max(len(url) for url, _ in the_world.log) <= ff.MAX_API_URL_LENGTH < the_world.max_url
    golf = next(
        i for i in json.loads(manifest.read_text("utf-8"))["identities"] if len(i["images"]) == 5
    )
    assert golf["images"][0]["year"] == 1950


def test_a_second_harvest_reuses_the_downloads(ff: ModuleType, tmp_path: Path) -> None:
    first = world(FakeClock())
    harvest(ff, tmp_path, first)
    again = world(FakeClock())

    harvest(ff, tmp_path, again)

    assert first.downloads
    assert again.downloads == [commons_url("Foxtrot_2.jpg")]


def test_the_command_line_harvests_into_the_given_manifest(
    ff: ModuleType, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    clock = FakeClock()
    the_world = world(clock)
    monkeypatch.setattr(ff, "HARVEST_ROOTS", ("Category:Root",))
    monkeypatch.setattr(ff, "HARVEST_DEPTH", 1)
    manifest = tmp_path / "out" / "calibration-manifest.json"

    code = ff.main(
        ["--harvest-calibration", "--manifest", str(manifest), "--dest", str(tmp_path / "d")],
        opener=the_world,
        clock=clock,
        sleep=clock.sleep,
    )

    assert code == 0
    assert len(ff.load_calibration_manifest(manifest)) == 11
    assert len(list((tmp_path / "d").glob("p*.jpg"))) == 11
