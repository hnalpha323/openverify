"""C268.2: the sampler (every 5 s during a take).

It records the BullMQ depth and lag of every queue the API registers (read from the code at run
time, `registered_queues`, with the method's `QUEUES` as the minimum), Postgres connections by
application and state with the longest idle-in-transaction gap, each container's memory, the API's
response times from pino's own fields (never a body), the queue metric events of Workflow 11B
(`queue_in_flight`, `queue_at_cap_ms`, `queue_admission_wait_ms`) and pg_stat_statements' top 20.
Its output holds ids, codes, counts and durations only (rule 11): no query parameter, no body, no
address, no token. The queue list is the method's (docs/calibration/load-phase11.md, "What the
sampler watches"), with Workflows 7A's and 7B's queues.

Valkey is read over the Redis protocol (`RespClient`, a minimal RESP2 client: load/ adds no
dependency), Postgres and Docker through `docker` commands against the load project's containers.

Run: python sampler.py loop --env-file /tmp/openverify-load/load.env --duration <s> --out <file>
     python sampler.py statements --env-file ... (--reset | --top <file>)
     python sampler.py server-times --since <iso> --until <iso> --out <file>
     python sampler.py metrics --since <iso> --until <iso> --out <file>
"""

from __future__ import annotations

import argparse
import json
import re
import socket
import subprocess
import sys
import time
from collections.abc import Callable, Iterable, Sequence
from dataclasses import asdict, dataclass, field
from pathlib import Path

#: Seconds between two samples.
SAMPLE_INTERVAL_SECONDS = 5

#: The queues the sampler watches at least, as `apps/api/src/jobs/` names them.
QUEUES: tuple[str, ...] = (
    "process-verification",
    "submitted-verification-sweep",
    "report-run",
    "report-sweep",
    "report-rescreen",
    "webhook-delivery",
    "webhook-failure-alerts",
    "connect-redeem",
    "account-export",
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
    "list-rescreen",
    "graph-index",
    "graph-index-sweep",
    "graph-query",
    "graph-query-sweep",
    "graph-backfill",
    "quota-sweep",
    "quota-recovery",
)

#: BullMQ's default key prefix (the API passes none: apps/api/src/jobs/queue.ts).
BULL_PREFIX = "bull"
#: Workflow 11B's queue metric events (apps/api/src/metrics-registry.ts) the fairness takes read.
QUEUE_METRICS: tuple[str, ...] = (
    "queue_in_flight",
    "queue_in_flight_cap",
    "queue_at_cap_ms",
    "queue_admission_wait_ms",
)
#: The load stack's compose project (Workflow 11D Stage 1a amendment 9).
PROJECT = "openverify-load"
#: How a queue name is declared in the API: one exported constant per queue.
QUEUE_CONSTANT = re.compile(r"export const [A-Z_]*QUEUE[A-Z_]* = '([a-z0-9-]+)'")

REPO = Path(__file__).resolve().parent.parent


def registered_queues(repo: Path = REPO) -> list[str]:
    """Every queue name the API declares (its `*_QUEUE*` constants outside tests), sorted."""
    names: set[str] = set()
    for path in (repo / "apps" / "api" / "src").rglob("*.ts"):
        if ".test." in path.name or "test-support" in path.parts:
            continue
        names.update(QUEUE_CONSTANT.findall(path.read_text(encoding="utf-8")))
    return sorted(names)


def watched_queues(repo: Path = REPO) -> list[str]:
    """The queues a sample reads: the method's minimum and every one the API declares."""
    return sorted(set(QUEUES) | set(registered_queues(repo)))


# --------------------------------------------------------------------------------- RESP2 ----


class RespError(Exception):
    """An error reply from the server (its first word only, never the command)."""


Reply = int | bytes | None | list["Reply"]


class RespClient:
    """A minimal RESP2 client: AUTH once, then pipelined commands. `connect` returns a socket-like
    object (tests pass a fake); the password is sent once and never logged or kept in an error."""

    def __init__(
        self,
        host: str,
        port: int,
        password: str | None = None,
        *,
        timeout: float = 5.0,
        connect: Callable[[tuple[str, int], float], socket.socket] = socket.create_connection,
    ) -> None:
        self._sock = connect((host, port), timeout)
        self._buffer = b""
        if password:
            self.pipeline([("AUTH", password)])

    def close(self) -> None:
        self._sock.close()

    @staticmethod
    def encode(args: Sequence[str]) -> bytes:
        parts = [f"*{len(args)}\r\n".encode()]
        for arg in args:
            data = arg.encode()
            parts.append(b"$%d\r\n%s\r\n" % (len(data), data))
        return b"".join(parts)

    def pipeline(self, commands: Sequence[Sequence[str]]) -> list[Reply]:
        """Sends every command, then reads one reply each, in order."""
        if not commands:
            return []
        self._sock.sendall(b"".join(self.encode(c) for c in commands))
        return [self._reply() for _ in commands]

    def _line(self) -> bytes:
        while b"\r\n" not in self._buffer:
            chunk = self._sock.recv(65536)
            if not chunk:
                raise ConnectionError("the Redis-protocol server closed the connection")
            self._buffer += chunk
        line, self._buffer = self._buffer.split(b"\r\n", 1)
        return line

    def _exact(self, size: int) -> bytes:
        while len(self._buffer) < size + 2:
            chunk = self._sock.recv(65536)
            if not chunk:
                raise ConnectionError("the Redis-protocol server closed the connection")
            self._buffer += chunk
        data, self._buffer = self._buffer[:size], self._buffer[size + 2 :]
        return data

    def _reply(self) -> Reply:
        line = self._line()
        kind, rest = line[:1], line[1:]
        if kind == b"+":
            return rest
        if kind == b"-":
            raise RespError(rest.split(b" ", 1)[0].decode(errors="replace"))
        if kind == b":":
            return int(rest)
        if kind == b"$":
            size = int(rest)
            return None if size < 0 else self._exact(size)
        if kind == b"*":
            count = int(rest)
            return None if count < 0 else [self._reply() for _ in range(count)]
        raise RespError("unknown reply type")


# ---------------------------------------------------------------------------- samples ----


@dataclass(frozen=True, slots=True)
class QueueSample:
    """One queue at one instant: jobs waiting and active, and the oldest waiting job's age."""

    queue: str
    waiting: int
    active: int
    lag_ms: float
    delayed: int = 0


def _int(reply: Reply) -> int:
    return reply if isinstance(reply, int) else 0


def sample_queues(client: RespClient, queues: Sequence[str], now_ms: float) -> list[QueueSample]:
    """Each queue's waiting (wait list plus prioritized), active and delayed counts, and the lag
    of its oldest waiting job (the wait list's right end: BullMQ pushes on the left)."""
    first: list[list[str]] = []
    for q in queues:
        key = f"{BULL_PREFIX}:{q}"
        first += [
            ["LLEN", f"{key}:wait"],
            ["ZCARD", f"{key}:prioritized"],
            ["LLEN", f"{key}:active"],
            ["ZCARD", f"{key}:delayed"],
            ["LINDEX", f"{key}:wait", "-1"],
        ]
    replies = client.pipeline(first)
    oldest: dict[str, str] = {}
    for i, q in enumerate(queues):
        job = replies[i * 5 + 4]
        if isinstance(job, bytes):
            oldest[q] = job.decode()
    stamps = client.pipeline(
        [["HGET", f"{BULL_PREFIX}:{q}:{job}", "timestamp"] for q, job in oldest.items()]
    )
    lag = {
        q: max(0.0, now_ms - float(stamp))
        for q, stamp in zip(oldest, stamps, strict=True)
        if isinstance(stamp, bytes) and stamp.isdigit()
    }
    return [
        QueueSample(
            queue=q,
            waiting=_int(replies[i * 5]) + _int(replies[i * 5 + 1]),
            active=_int(replies[i * 5 + 2]),
            lag_ms=lag.get(q, 0.0),
            delayed=_int(replies[i * 5 + 3]),
        )
        for i, q in enumerate(queues)
    ]


@dataclass(frozen=True, slots=True)
class ConnectionCount:
    """Postgres backends of one application in one state."""

    application: str
    state: str
    count: int
    #: The client: the container its address belongs to, or `local` (a socket in the container).
    client: str = ""


CONNECTIONS_SQL = (
    "select coalesce(nullif(application_name, ''), '(none)'), coalesce(state, '(none)'),"
    " coalesce(host(client_addr), 'local'), count(*) from pg_stat_activity"
    " where datname = current_database() group by 1, 2, 3 order by 1, 2, 3"
)
IDLE_IN_TRANSACTION_SQL = (
    "select coalesce(max(extract(epoch from now() - state_change)), 0) from pg_stat_activity"
    " where datname = current_database() and state like 'idle in transaction%'"
)
STATEMENTS_TOP_SQL = (
    "select queryid, calls, round(total_exec_time::numeric, 1), round(mean_exec_time::numeric, 2),"
    " round(max_exec_time::numeric, 1), left(regexp_replace(query, '\\s+', ' ', 'g'), 120)"
    " from pg_stat_statements order by total_exec_time desc limit 20"
)
STATEMENTS_RESET_SQL = "select pg_stat_statements_reset()"


def parse_container_addresses(text: str) -> dict[str, str]:
    """`docker inspect` lines `/<name> <address> ...` as address to container name."""
    names: dict[str, str] = {}
    for line in text.splitlines():
        parts = line.split()
        for address in parts[1:]:
            names[address] = parts[0].lstrip("/")
    return names


def name_clients(rows: Sequence[ConnectionCount], names: dict[str, str]) -> list[ConnectionCount]:
    """The rows with each client address replaced by its container's name, where known."""
    return [
        ConnectionCount(row.application, row.state, row.count, names.get(row.client, row.client))
        for row in rows
    ]


def parse_connections(text: str) -> list[ConnectionCount]:
    """psql's unaligned, tab-separated rows of `CONNECTIONS_SQL`."""
    rows = []
    for line in text.splitlines():
        if line.strip():
            application, state, client, count = line.split("\t")
            rows.append(ConnectionCount(application, state, int(count), client))
    return rows


@dataclass(frozen=True, slots=True)
class Statement:
    """One pg_stat_statements row: its normalised text (parameters as $n, so no value) cut short."""

    queryid: str
    calls: int
    total_ms: float
    mean_ms: float
    max_ms: float
    query: str


def parse_statements(text: str) -> list[Statement]:
    """psql's unaligned, tab-separated rows of `STATEMENTS_TOP_SQL`."""
    rows = []
    for line in text.splitlines():
        if line.strip():
            queryid, calls, total, mean, largest, query = line.split("\t", 5)
            rows.append(
                Statement(queryid, int(calls), float(total), float(mean), float(largest), query)
            )
    return rows


_SIZE = re.compile(r"([0-9.]+)\s*([KMGT]?i?B)")
_UNIT_MIB = {
    "B": 1 / 1048576,
    "KiB": 1 / 1024,
    "KB": 1000 / 1048576,
    "MiB": 1.0,
    "MB": 1e6 / 1048576,
    "GiB": 1024.0,
    "GB": 1e9 / 1048576,
    "TiB": 1048576.0,
    "TB": 1e12 / 1048576,
}


def parse_memory(text: str) -> dict[str, float]:
    """`docker stats --no-stream --format '{{.Name}}\\t{{.MemUsage}}'` as MiB used per container."""
    usage: dict[str, float] = {}
    for line in text.splitlines():
        if "\t" not in line:
            continue
        name, mem = line.split("\t", 1)
        match = _SIZE.match(mem.strip())
        if match is not None:
            usage[name.strip()] = round(float(match.group(1)) * _UNIT_MIB[match.group(2)], 1)
    return usage


@dataclass(frozen=True, slots=True)
class ServerTime:
    """One request as the API logged it: its route pattern, status and pino's responseTime."""

    route: str
    status: int
    ms: float


def parse_api_log(lines: Iterable[str]) -> list[ServerTime]:
    """Pairs pino's "incoming request" ({req: {method, route}}) with its "request completed"
    ({res: {statusCode}, responseTime}) by reqId. Reads those fields alone, never a body."""
    routes: dict[str, str] = {}
    times: list[ServerTime] = []
    for line in lines:
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if not isinstance(entry, dict):
            continue
        req_id = str(entry.get("reqId") or entry.get("requestId") or "")
        req = entry.get("req")
        if isinstance(req, dict) and req_id:
            routes[req_id] = f"{req.get('method', '?')} {req.get('route') or '(none)'}"
        res = entry.get("res")
        response_time = entry.get("responseTime")
        if isinstance(res, dict) and isinstance(response_time, int | float) and req_id:
            status = res.get("statusCode")
            if isinstance(status, int):
                route = routes.pop(req_id, "(unknown)")
                times.append(ServerTime(route, status, float(response_time)))
    return times


@dataclass(frozen=True, slots=True)
class MetricEvent:
    """A queue metric event (C250.7): its name, value and labels (an environment id, a queue)."""

    metric: str
    value: float
    queue: str | None
    environment_id: str | None


def parse_metric_events(
    lines: Iterable[str], names: Sequence[str] = QUEUE_METRICS
) -> list[MetricEvent]:
    """The metric events of `names` in pino lines; labels are ids and queue names only."""
    events = []
    for line in lines:
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if isinstance(entry, dict) and entry.get("metric") in names:
            value = entry.get("value")
            if isinstance(value, int | float):
                queue = entry.get("queue")
                env = entry.get("environmentId")
                events.append(
                    MetricEvent(
                        str(entry["metric"]),
                        float(value),
                        queue if isinstance(queue, str) else None,
                        env if isinstance(env, str) else None,
                    )
                )
    return events


@dataclass(frozen=True, slots=True)
class Admission:
    """C251.5's evidence per environment for a window: the report runs created in it, how many of
    them waited for a slot (admitted more than a second after they were created: the cap was
    reached) and the longest such wait. Ids and counts only."""

    environment: str
    runs: int
    waited: int
    max_wait_ms: float


#: A window bound: an ISO-8601 UTC timestamp, the only text `admissions_sql` puts in its statement.
TIMESTAMP = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z")


def admissions_sql(since: str, until: str) -> str:
    """C251.5's evidence: the report runs created in [since, until), per environment."""
    for bound in (since, until):
        if not TIMESTAMP.fullmatch(bound):
            raise ValueError(f"{bound!r} is not a timestamp")
    # Both bounds are checked against TIMESTAMP above; no other text enters the statement.
    return (
        "select environment_id, count(*), "  # noqa: S608
        "count(*) filter (where admitted_at > created_at + interval '1 second'), "
        "coalesce(round(extract(epoch from max(admitted_at - created_at)) * 1000, 1), 0) "
        f"from report_runs where created_at >= '{since}' and created_at < '{until}' "
        "group by environment_id order by environment_id"
    )


def parse_admissions(text: str) -> list[Admission]:
    """psql's unaligned, tab-separated rows of `admissions_sql`."""
    rows = []
    for line in text.splitlines():
        if not line.strip():
            continue
        environment, runs, waited, wait = line.split("\t")
        rows.append(Admission(environment, int(runs), int(waited), float(wait)))
    return rows


# ---------------------------------------------------------------------------- sampler ----

Runner = Callable[[Sequence[str]], str]


def run_command(args: Sequence[str]) -> str:
    """Runs a command and returns its stdout (its stderr is discarded: it may echo a value)."""
    return subprocess.run(  # noqa: S603 - arguments are the sampler's own, never a shell string
        list(args), check=True, capture_output=True, text=True, timeout=60
    ).stdout


@dataclass(frozen=True, slots=True)
class Sample:
    """One sample of the load stack."""

    at: float
    queues: list[QueueSample]
    connections: list[ConnectionCount]
    idle_in_transaction_seconds: float
    memory_mib: dict[str, float] = field(default_factory=dict)


class Sampler:
    """Reads the load stack's Valkey, Postgres and Docker every `SAMPLE_INTERVAL_SECONDS`."""

    def __init__(  # noqa: PLR0913 - the sampler's injectable parts, keyword-only
        self,
        *,
        redis: RespClient,
        run: Runner = run_command,
        project: str = PROJECT,
        postgres_user: str = "openverify",
        postgres_db: str = "openverify_load",
        queues: Sequence[str] | None = None,
        wall: Callable[[], float] = time.time,
    ) -> None:
        self._redis = redis
        self._run = run
        self._project = project
        self._user = postgres_user
        self._db = postgres_db
        self._queues = list(queues) if queues is not None else watched_queues()
        self._wall = wall
        self._containers: dict[str, str] = {}
        self._addresses: dict[str, str] | None = None

    def container(self, service: str) -> str:
        """The id of the load project's container of `service` (cached)."""
        if service not in self._containers:
            ids = self._run(["docker", "compose", "-p", self._project, "ps", "-q", service]).split()
            if not ids:
                raise RuntimeError(f"the load project has no running {service} container")
            self._containers[service] = ids[0]
        return self._containers[service]

    def psql(self, sql: str) -> str:
        """Runs one statement in the load database as the Postgres superuser, in its container."""
        return self._run(
            [
                "docker",
                "exec",
                self.container("postgres"),
                "psql",
                "-X",
                "-q",
                "-At",
                "-F",
                "\t",
                "-U",
                self._user,
                "-d",
                self._db,
                "-c",
                sql,
            ]
        )

    def sample(self) -> Sample:
        at = self._wall()
        queues = sample_queues(self._redis, self._queues, at * 1000.0)
        connections = name_clients(parse_connections(self.psql(CONNECTIONS_SQL)), self.addresses())
        idle = float(self.psql(IDLE_IN_TRANSACTION_SQL).strip() or 0)
        memory = parse_memory(
            self._run(
                [
                    "docker",
                    "stats",
                    "--no-stream",
                    "--format",
                    "{{.Name}}\t{{.MemUsage}}",
                    *self._project_containers(),
                ]
            )
        )
        return Sample(at, queues, connections, idle, memory)

    def addresses(self) -> dict[str, str]:
        """Each load container's network addresses to its name (cached for the sampler's life)."""
        if self._addresses is None:
            containers = self._project_containers()
            text = (
                self._run(
                    [
                        "docker",
                        "inspect",
                        "--format",
                        "{{.Name}} {{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}",
                        *containers,
                    ]
                )
                if containers
                else ""
            )
            self._addresses = parse_container_addresses(text)
        return self._addresses

    def _project_containers(self) -> list[str]:
        return self._run(["docker", "compose", "-p", self._project, "ps", "-q"]).split()

    def statements(self, *, reset: bool) -> list[Statement]:
        """pg_stat_statements' top 20 by total time, or (with `reset`) an empty reset."""
        if reset:
            self.psql(STATEMENTS_RESET_SQL)
            return []
        return parse_statements(self.psql(STATEMENTS_TOP_SQL))

    def admissions(self, since: str, until: str) -> list[Admission]:
        """The report runs created in the window, per environment (`admissions_sql`)."""
        return parse_admissions(self.psql(admissions_sql(since, until)))

    def logs(self, service: str, since: str, until: str) -> list[str]:
        """The service's log lines between two RFC 3339 instants."""
        return self._run(
            ["docker", "logs", "--since", since, "--until", until, self.container(service)]
        ).splitlines()

    def loop(
        self,
        duration_seconds: float,
        out: Path,
        *,
        interval: float = SAMPLE_INTERVAL_SECONDS,
        sleep: Callable[[float], None] = time.sleep,
    ) -> int:
        """Samples every `interval` for `duration_seconds`, a JSON line each; returns the count."""
        count = 0
        end = self._wall() + duration_seconds
        with out.open("a", encoding="utf-8") as sink:
            while True:
                started = self._wall()
                sink.write(json.dumps(asdict(self.sample()), sort_keys=True) + "\n")
                sink.flush()
                count += 1
                if started + interval > end:
                    return count
                sleep(max(0.0, started + interval - self._wall()))


# -------------------------------------------------------------------------------- CLI ----


def read_env_file(path: Path) -> dict[str, str]:
    """KEY=value lines of the load env file (comments and blanks skipped; no shell expansion)."""
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip("'\"")
    return values


def main(
    argv: Sequence[str] | None = None,
    *,
    run: Runner = run_command,
    connect: Callable[[tuple[str, int], float], socket.socket] = socket.create_connection,
) -> int:
    parser = argparse.ArgumentParser(prog="sampler.py")
    sub = parser.add_subparsers(dest="command", required=True)
    loop = sub.add_parser("loop")
    loop.add_argument("--env-file", type=Path, required=True)
    loop.add_argument("--duration", type=float, required=True)
    loop.add_argument("--out", type=Path, required=True)
    statements = sub.add_parser("statements")
    statements.add_argument("--env-file", type=Path, required=True)
    group = statements.add_mutually_exclusive_group(required=True)
    group.add_argument("--reset", action="store_true")
    group.add_argument("--top", type=Path)
    for name in ("server-times", "metrics", "admissions"):
        logs = sub.add_parser(name)
        logs.add_argument("--env-file", type=Path, required=True)
        logs.add_argument("--since", required=True)
        logs.add_argument("--until", required=True)
        logs.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    env = read_env_file(args.env_file)
    redis = RespClient(
        env.get("OPENVERIFY_BIND_ADDRESS", "127.0.0.1"),
        int(env.get("REDIS_PORT", "26379")),
        env.get("REDIS_PASSWORD"),
        connect=connect,
    )
    sampler = Sampler(
        redis=redis,
        run=run,
        postgres_user=env.get("POSTGRES_USER", "openverify"),
        postgres_db=env.get("POSTGRES_DB", "openverify_load"),
    )
    try:
        if args.command == "loop":
            print(f"samples: {sampler.loop(args.duration, args.out)}")
        elif args.command == "statements":
            if args.reset:
                sampler.statements(reset=True)
            else:
                rows = [asdict(s) for s in sampler.statements(reset=False)]
                args.top.write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")
        elif args.command == "admissions":
            admitted = sampler.admissions(args.since, args.until)
            args.out.write_text(json.dumps([asdict(a) for a in admitted]) + "\n", encoding="utf-8")
            print(f"admissions: {len(admitted)} environments")
        elif args.command == "server-times":
            times = parse_api_log(sampler.logs("api", args.since, args.until))
            args.out.write_text(json.dumps([asdict(t) for t in times]) + "\n", encoding="utf-8")
            print(f"server times: {len(times)}")
        else:
            events = parse_metric_events(sampler.logs("worker", args.since, args.until))
            args.out.write_text(json.dumps([asdict(e) for e in events]) + "\n", encoding="utf-8")
            print(f"metric events: {len(events)}")
    finally:
        redis.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
