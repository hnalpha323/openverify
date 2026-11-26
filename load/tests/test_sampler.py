"""The sampler (C268.2): the method's queues and every queue the API declares, read over the Redis
protocol; Postgres, Docker and pino read from recorded fixtures; ids, counts and durations only."""

from __future__ import annotations

import json
import re
import socket
from collections.abc import Sequence
from pathlib import Path

import pytest

import sampler
from sampler import (
    QUEUE_METRICS,
    QUEUES,
    SAMPLE_INTERVAL_SECONDS,
    Admission,
    ConnectionCount,
    RespClient,
    RespError,
    Sampler,
    admissions_sql,
    parse_admissions,
    parse_api_log,
    parse_connections,
    parse_memory,
    parse_metric_events,
    parse_statements,
    read_env_file,
    registered_queues,
    sample_queues,
    watched_queues,
)

REPO = Path(__file__).resolve().parents[2]


def declared_in_git() -> set[str]:
    names: set[str] = set()
    for path in (REPO / "apps" / "api" / "src").rglob("*.ts"):
        if ".test." in path.name:
            continue
        names.update(
            re.findall(
                r"export const [A-Z_]*QUEUE[A-Z_]* = '([a-z0-9-]+)'",
                path.read_text(encoding="utf-8"),
            )
        )
    return names


def test_every_queue_is_one_the_api_registers() -> None:
    assert set(QUEUES) <= set(registered_queues())
    assert len(set(QUEUES)) == len(QUEUES)


def test_the_watched_queues_are_read_from_the_code_at_run_time() -> None:
    declared = declared_in_git()
    assert set(registered_queues()) == declared
    assert len(declared) >= 62
    assert set(watched_queues()) == declared | set(QUEUES)
    assert {
        "workflow-step",
        "analytics-rollup",
        "export",
        "report-bulk",
        "connect-token-expiry",
    } <= declared


def test_a_queue_constant_in_a_new_file_is_watched(tmp_path: Path) -> None:
    src = tmp_path / "apps" / "api" / "src" / "jobs"
    src.mkdir(parents=True)
    (src / "new.ts").write_text("export const NEW_THING_QUEUE = 'new-thing';\n", encoding="utf-8")
    (src / "new.test.ts").write_text("export const TEST_QUEUE = 'test-only';\n", encoding="utf-8")
    assert registered_queues(tmp_path) == ["new-thing"]


def test_the_method_s_queues_are_watched() -> None:
    required = {
        "inquiry-signals",
        "inquiry-signals-sweep",
        "network-refresh",
        "integrity-decode",
        "list-screen",
        "list-screen-sweep",
        "list-import",
        "list-import-sweep",
        "list-item-embed",
        "list-item-embed-sweep",
        "graph-index",
        "graph-index-sweep",
        "graph-query",
        "graph-query-sweep",
        "graph-backfill",
    }
    assert required <= set(QUEUES)
    assert SAMPLE_INTERVAL_SECONDS == 5
    assert QUEUE_METRICS == (
        "queue_in_flight",
        "queue_in_flight_cap",
        "queue_at_cap_ms",
        "queue_admission_wait_ms",
    )


class FakeSocket:
    """Answers each RESP command from a table keyed by the command's words."""

    def __init__(self, answers: dict[tuple[str, ...], bytes]) -> None:
        self.answers = answers
        self.sent: list[list[str]] = []
        self.pending = b""
        self.closed = False

    def sendall(self, data: bytes) -> None:
        for command in self._split(data):
            self.sent.append(command)
            self.pending += self.answers.get(tuple(command), b"$-1\r\n")

    def recv(self, size: int) -> bytes:
        chunk, self.pending = self.pending[:3], self.pending[3:]  # dribble, to test the buffering
        return chunk

    def close(self) -> None:
        self.closed = True

    @staticmethod
    def _split(data: bytes) -> list[list[str]]:
        commands = []
        lines = data.split(b"\r\n")
        i = 0
        while i < len(lines) and lines[i]:
            count = int(lines[i][1:])
            args = [lines[i + 2 + 2 * k].decode() for k in range(count)]
            commands.append(args)
            i += 1 + 2 * count
        return commands


def client_for(
    answers: dict[tuple[str, ...], bytes], password: str | None = None
) -> tuple[RespClient, FakeSocket]:
    fake = FakeSocket(answers)

    def connect(address: tuple[str, int], timeout: float) -> socket.socket:
        assert address == ("127.0.0.1", 26379)
        return fake  # type: ignore[return-value]

    return RespClient("127.0.0.1", 26379, password, connect=connect), fake


def test_the_client_authenticates_once_and_parses_every_reply_type() -> None:
    client, fake = client_for(
        {
            ("AUTH", "synthetic-password"): b"+OK\r\n",
            ("LLEN", "a"): b":3\r\n",
            ("GET", "b"): b"$5\r\nhello\r\n",
            ("GET", "c"): b"$-1\r\n",
            ("LRANGE", "d", "0", "1"): b"*2\r\n$1\r\nx\r\n:7\r\n",
            ("LRANGE", "e", "0", "1"): b"*-1\r\n",
        },
        password="synthetic-password",  # noqa: S106 - a fake server's synthetic password
    )
    assert fake.sent == [["AUTH", "synthetic-password"]]
    assert client.pipeline(
        [
            ["LLEN", "a"],
            ["GET", "b"],
            ["GET", "c"],
            ["LRANGE", "d", "0", "1"],
            ["LRANGE", "e", "0", "1"],
        ]
    ) == [3, b"hello", None, [b"x", 7], None]
    assert client.pipeline([]) == []
    client.close()
    assert fake.closed


def test_an_error_reply_names_its_kind_never_the_command() -> None:
    client, _ = client_for(
        {("AUTH", "wrong-synthetic"): b"-WRONGPASS invalid username-password pair\r\n"}
    )
    with pytest.raises(RespError) as error:
        client.pipeline([["AUTH", "wrong-synthetic"]])
    assert str(error.value) == "WRONGPASS"


def test_an_unknown_reply_and_a_closed_connection() -> None:
    client, _fake = client_for({("X",): b"?\r\n"})
    with pytest.raises(RespError, match="unknown"):
        client.pipeline([["X"]])
    client2, _fake2 = client_for({("GET", "big"): b"$10\r\nabc"})
    with pytest.raises(ConnectionError):
        client2.pipeline([["GET", "big"]])
    client3, _ = client_for({("PING",): b""})
    with pytest.raises(ConnectionError):
        client3.pipeline([["PING"]])


def test_a_queue_s_depth_and_its_oldest_waiting_job_s_lag() -> None:
    client, _ = client_for(
        {
            ("LLEN", "bull:report-run:wait"): b":4\r\n",
            ("ZCARD", "bull:report-run:prioritized"): b":1\r\n",
            ("LLEN", "bull:report-run:active"): b":2\r\n",
            ("ZCARD", "bull:report-run:delayed"): b":3\r\n",
            ("LINDEX", "bull:report-run:wait", "-1"): b"$2\r\n17\r\n",
            ("HGET", "bull:report-run:17", "timestamp"): b"$13\r\n1700000000000\r\n",
            ("LLEN", "bull:list-screen:wait"): b":0\r\n",
            ("ZCARD", "bull:list-screen:prioritized"): b":0\r\n",
            ("LLEN", "bull:list-screen:active"): b":0\r\n",
            ("ZCARD", "bull:list-screen:delayed"): b":0\r\n",
        }
    )
    samples = sample_queues(client, ["report-run", "list-screen"], 1700000002500.0)
    assert samples[0] == sampler.QueueSample("report-run", 5, 2, 2500.0, 3)
    assert samples[1] == sampler.QueueSample("list-screen", 0, 0, 0.0, 0)


POSTGRES = "c0ffee"


def fake_run(outputs: dict[str, str]):  # type: ignore[no-untyped-def]
    calls: list[list[str]] = []

    def run(args: Sequence[str]) -> str:
        calls.append(list(args))
        joined = " ".join(args)
        for key, value in outputs.items():
            if key in joined:
                return value
        return ""

    return run, calls


def recorded_sampler() -> tuple[Sampler, list[list[str]]]:
    client, _ = client_for(
        {
            ("LLEN", "bull:report-run:wait"): b":1\r\n",
            ("LINDEX", "bull:report-run:wait", "-1"): b"$-1\r\n",
        }
    )
    run, calls = fake_run(
        {
            "ps -q postgres": f"{POSTGRES}\n",
            "ps -q": "c0ffee\nbeef\n",
            "current_database() group": "api\tactive\t172.30.240.5\t3\nworker\tidle\tlocal\t7\n",
            "docker inspect": "/openverify-load-api-1 172.30.240.5 \n",
            "idle in transaction": "1.25\n",
            "docker stats": "openverify-load-api-1\t312.5MiB / 1GiB\n"
            "openverify-load-worker-1\t1.2GiB / 1.5GiB\n",
            "pg_stat_statements order by": "123\t40\t812.3\t20.31\t95.1\t"
            "select * from inquiries where id = $1\n",
            "--since": '{"reqId":"r1","req":{"method":"GET","route":"/api/v1/inquiries/:id"}}\n'
            '{"reqId":"r1","res":{"statusCode":200},"responseTime":12.5}\n',
        }
    )
    return Sampler(redis=client, run=run, queues=["report-run"], wall=lambda: 1700000000.0), calls


def test_one_sample_of_the_stack() -> None:
    sample_, calls = recorded_sampler()
    sample = sample_.sample()
    assert sample.queues[0].waiting == 1
    assert sample.connections == [
        ConnectionCount("api", "active", 3, "openverify-load-api-1"),
        ConnectionCount("worker", "idle", 7, "local"),
    ]
    assert sample.idle_in_transaction_seconds == 1.25
    assert sample.memory_mib == {"openverify-load-api-1": 312.5, "openverify-load-worker-1": 1228.8}
    psql = next(c for c in calls if "psql" in c)
    assert psql[:3] == ["docker", "exec", POSTGRES]
    assert psql[psql.index("-d") + 1] == "openverify_load"


def test_statements_reset_and_top() -> None:
    sample_, calls = recorded_sampler()
    assert sample_.statements(reset=True) == []
    assert any("pg_stat_statements_reset" in " ".join(c) for c in calls)
    top = sample_.statements(reset=False)
    assert top[0].queryid == "123"
    assert top[0].calls == 40
    assert top[0].max_ms == 95.1


def test_a_missing_service_is_named() -> None:
    client, _ = client_for({})
    run, _ = fake_run({})
    with pytest.raises(RuntimeError, match="no running postgres"):
        Sampler(redis=client, run=run, queues=[]).container("postgres")


def test_the_loop_writes_one_line_per_interval(tmp_path: Path) -> None:
    sample_, _ = recorded_sampler()
    now = [0.0]
    sample_._wall = lambda: now[0]
    slept: list[float] = []

    def sleep(seconds: float) -> None:
        slept.append(seconds)
        now[0] += seconds

    out = tmp_path / "samples.jsonl"
    assert sample_.loop(10.0, out, sleep=sleep) == 3
    lines = [json.loads(line) for line in out.read_text(encoding="utf-8").splitlines()]
    assert len(lines) == 3
    assert set(lines[0]) == {
        "at",
        "queues",
        "connections",
        "idle_in_transaction_seconds",
        "memory_mib",
    }
    assert slept == [5.0, 5.0]


def test_parsers_over_recorded_output() -> None:
    assert parse_connections("\n") == []
    assert parse_statements("") == []
    assert parse_memory(
        "no-tab-line\nx\tnot a size\nopenverify-load-flow-1\t900KiB / 256MiB\n"
    ) == {"openverify-load-flow-1": 0.9}


def test_server_times_from_pino_fields_only() -> None:
    lines = [
        "not json",
        "[1, 2]",
        '{"reqId":"a","req":{"method":"POST","route":"/api/v1/inquiries"},"msg":"incoming"}',
        '{"reqId":"b","req":{"method":"GET","route":null}}',
        '{"reqId":"a","res":{"statusCode":201},"responseTime":41.5,"msg":"request completed"}',
        '{"reqId":"b","res":{"statusCode":404},"responseTime":1}',
        '{"reqId":"c","res":{"statusCode":200},"responseTime":2}',
        '{"reqId":"d","res":{"statusCode":"x"},"responseTime":2}',
    ]
    times = parse_api_log(lines)
    assert [(t.route, t.status, t.ms) for t in times] == [
        ("POST /api/v1/inquiries", 201, 41.5),
        ("GET (none)", 404, 1.0),
        ("(unknown)", 200, 2.0),
    ]


def test_the_api_s_request_id_label_is_read_too() -> None:
    lines = [
        '{"requestId":"r9","req":{"method":"GET","route":"/ready"},"msg":"incoming request"}',
        '{"requestId":"r9","res":{"statusCode":200},"responseTime":3.5,"msg":"request completed"}',
    ]
    assert [(t.route, t.status, t.ms) for t in parse_api_log(lines)] == [("GET /ready", 200, 3.5)]


def test_connections_by_application_state_and_client_container() -> None:
    rows = parse_connections("(none)\tidle\t172.30.240.5\t4\npsql\tactive\tlocal\t1\n")
    names = {"172.30.240.5": "openverify-load-api-1"}
    assert [(c.application, c.state, c.client, c.count) for c in rows] == [
        ("(none)", "idle", "172.30.240.5", 4),
        ("psql", "active", "local", 1),
    ]
    assert sampler.name_clients(rows, names)[0].client == "openverify-load-api-1"
    assert sampler.name_clients(rows, names)[1].client == "local"
    assert sampler.parse_container_addresses(
        "/openverify-load-api-1 172.30.240.5 \n/openverify-load-vision-1  \n"
    ) == {"172.30.240.5": "openverify-load-api-1"}


def test_queue_metric_events() -> None:
    lines = [
        "{bad",
        '{"metric":"queue_admission_wait_ms","value":250,"queue":"report-run","environmentId":"env_1"}',
        '{"metric":"queue_in_flight","value":50,"queue":"report-run"}',
        '{"metric":"queue_in_flight","value":"x"}',
        '{"metric":"something_else","value":1}',
    ]
    events = parse_metric_events(lines)
    assert [(e.metric, e.value, e.queue, e.environment_id) for e in events] == [
        ("queue_admission_wait_ms", 250.0, "report-run", "env_1"),
        ("queue_in_flight", 50.0, "report-run", None),
    ]


def test_the_env_file(tmp_path: Path) -> None:
    env = tmp_path / "load.env"
    env.write_text(
        "# comment\n\nREDIS_PORT=26379\nREDIS_PASSWORD='synthetic'\nBAD\n", encoding="utf-8"
    )
    assert read_env_file(env) == {"REDIS_PORT": "26379", "REDIS_PASSWORD": "synthetic"}


def cli(tmp_path: Path, *argv: str) -> tuple[int, list[list[str]]]:
    env = tmp_path / "load.env"
    env.write_text("REDIS_PORT=26379\nREDIS_PASSWORD=synthetic-password\n", encoding="utf-8")
    fake = FakeSocket({("AUTH", "synthetic-password"): b"+OK\r\n"})
    run, calls = fake_run(
        {
            "ps -q postgres": "c0ffee\n",
            "ps -q api": "a1\n",
            "ps -q worker": "w1\n",
            "--since": '{"metric":"queue_in_flight","value":3}\n'
            '{"reqId":"x","res":{"statusCode":200},"responseTime":4}\n',
            "pg_stat_statements order by": "1\t2\t3.0\t1.5\t2.0\tselect 1\n",
        }
    )
    code = sampler.main(
        [argv[0], "--env-file", str(env), *argv[1:]],
        run=run,
        connect=lambda address, timeout: fake,  # type: ignore[arg-type,return-value]
    )
    return code, calls


def test_the_command_line(tmp_path: Path) -> None:
    out = tmp_path / "out.json"
    assert cli(tmp_path, "statements", "--reset")[0] == 0
    assert cli(tmp_path, "statements", "--top", str(out))[0] == 0
    assert json.loads(out.read_text(encoding="utf-8"))[0]["query"] == "select 1"
    assert cli(tmp_path, "server-times", "--since", "a", "--until", "b", "--out", str(out))[0] == 0
    assert json.loads(out.read_text(encoding="utf-8")) == [
        {"route": "(unknown)", "status": 200, "ms": 4.0}
    ]
    code, calls = cli(tmp_path, "metrics", "--since", "a", "--until", "b", "--out", str(out))
    assert code == 0
    assert ["docker", "logs", "--since", "a", "--until", "b", "w1"] in calls
    assert json.loads(out.read_text(encoding="utf-8"))[0]["metric"] == "queue_in_flight"


def test_admissions_per_environment_for_a_window() -> None:
    """P001: the report runs created in a take's window, per environment, with those that waited
    for a slot (admitted over a second after they were created) and the longest wait."""
    sql = admissions_sql("2026-11-17T10:00:00Z", "2026-11-17T10:07:30Z")
    assert "from report_runs" in sql
    assert "admitted_at > created_at + interval '1 second'" in sql
    assert "'2026-11-17T10:00:00Z'" in sql
    with pytest.raises(ValueError, match="not a timestamp"):
        admissions_sql("2026-11-17'; drop table x; --", "2026-11-17T10:07:30Z")
    rows = parse_admissions("env_a\t500\t312\t21000.5\nenv_b\t150\t0\t0\n")
    assert rows == [Admission("env_a", 500, 312, 21000.5), Admission("env_b", 150, 0, 0.0)]


def test_the_admissions_command(tmp_path: Path) -> None:
    out = tmp_path / "admissions.json"
    code, calls = cli(
        tmp_path,
        "admissions",
        "--since",
        "2026-11-17T10:00:00Z",
        "--until",
        "2026-11-17T10:07:30Z",
        "--out",
        str(out),
    )
    assert code == 0
    assert any("from report_runs" in " ".join(c) for c in calls)
    assert isinstance(json.loads(out.read_text(encoding="utf-8")), list)
