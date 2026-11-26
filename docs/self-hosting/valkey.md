# Valkey

The queues (BullMQ), the rate limiters, the login limiter and a few caches use a Redis-protocol store (C277.7). The project develops and tests against Valkey 9.1 (`valkey/valkey:9.1`, pinned by digest in compose and the Testcontainers suites); the code speaks only the Redis protocol.

## Settings

- **Persistence on (AOF).** Compose starts its Valkey with `--appendonly yes`. Postgres remains the record: a lost queue delays work, and the queues fed by an outbox table are re-enqueued by their sweeps, but limiter counters and login-limiter state are lost.
- **`maxmemory-policy noeviction`.** An evicted job key loses a queued job until a sweep finds it. The worker reads `CONFIG GET maxmemory-policy` at start and logs an error unless it is `noeviction`; it does not refuse to start (`apps/api/src/workflows/engine/valkey-check.ts`). Valkey's default policy is `noeviction`; keep it, and give Valkey enough memory for the deepest queues you expect.
- **TLS across hosts**: `rediss://` in `REDIS_URL`, with `OPENVERIFY_REDIS_CA_FILE` for a private CA (C249.1). In production mode a plain `redis://` URL logs one `insecure_transport` warning at start.
- **The login limiter fails closed.** When Valkey does not answer, a console sign-in answers 503 `login_unavailable`; the API's other rate limits let the request through uncounted. Both count `metric: rate_limiter_store_unavailable` ([monitoring.md](monitoring.md)). The handoff send budget fails closed too (`metric: handoff_send_budget_unavailable`).

## ACL users

`REDIS_URL` may carry a username, and the ACL user reaches every client (ioredis and BullMQ) unchanged (C249.5). Workflow 11B tested this user (`apps/api/src/config/valkey-user.integration.test.ts`; Workflow 11B Stage 2 amendments, platform-ops item 4):

```
ACL SETUSER openverify on >pw ~* &* +@all -flushall -flushdb -config +config|get -debug -keys
```

Replace `pw` with the user's password (prefix `>`). The rules give every key and channel, every command but `FLUSHALL`, `FLUSHDB`, `CONFIG` (keeping `CONFIG GET`, which the worker's eviction-policy check reads), `DEBUG` and `KEYS`. One user per process is possible with the same rules; the code needs no finer split. Where no ACL user is set, the single password of `requirepass` (as compose uses) is an accepted risk of the threat model (`docs/security/threat-model.md`).
