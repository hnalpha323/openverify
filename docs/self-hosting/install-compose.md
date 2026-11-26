# Install with Docker Compose

One host, the compose file's `app` profile on the five production images (C257.3; `infra/docker-compose.yml`). It is how the project runs the whole stack in containers and how Workflow 11D's load stack ran (`docs/calibration/load-phase11.md`). Read what it is before you rely on it: its defaults are a development install.

## What the profile is

- Five images built from this repository, tagged `11c-local`: `openverify/api` (the API, the worker, `migrate` and every operator command), `openverify/dashboard`, `openverify/flow`, `openverify/vision` and `openverify/code-runner`. Each Node service runs read-only with a 256 MiB `/tmp`, `cap_drop: ALL` and `no-new-privileges`; vision runs as uid 10001 on its own internal network (no gateway) with a 4 GiB limit; the code runner has no network at all (`network_mode: none`) and is reached over a Unix socket on a shared volume (`OPENVERIFY_WORKFLOW_CODE_RUNNER=socket:/run/code-runner/code-runner.sock`).
- The data stores are the development ones: Postgres with pgvector, Valkey, RustFS and Mailpit, pinned by digest. Every host port binds to `OPENVERIFY_BIND_ADDRESS` (`127.0.0.1` by default), so nothing is reachable from the network until you put a TLS proxy in front.
- Secrets reach the services as environment variables from `.env` (`x-api-environment` in the compose file), not as `_FILE` mounts. The images read each secret's `<NAME>_FILE` form too ([configuration.md](configuration.md)): to use files, mount them yourself (compose `secrets:`) and set the `_FILE` names instead.
- `OPENVERIFY_MODE` defaults to `development` in the compose file. Production mode refuses `change-me` placeholders and test-only behaviour; set `OPENVERIFY_MODE=production` in `.env` for any real data.
- The profile runs `db:migrate` with `DATABASE_URL`, one role for both migration and run time: it does not run `db:grant-runtime`, and `db:migrate` warns about it in production mode. This is deliberate (Workflow 11F, KP11-83). The compose Postgres is created by its image with one owner role, and every developer command (`db:migrate` and `seed:dev` from the host, the test runs) uses that one `DATABASE_URL`. A second role would need an init script that runs only on an empty data directory, so an existing volume would never get it. A production install uses two roles ([database.md](database.md)), as the chart's migrate Job does.

## Steps

```bash
cp .env.example .env                      # then replace every change-me-* value
python3 scripts/fetch_models.py && python3 scripts/fetch_data.py
pnpm --filter @openverify/watchlist build:variant-groups
docker compose -f infra/docker-compose.yml --env-file .env --profile app up -d --wait --build
```

`up` starts `migrate` first (`node dist/commands/db-migrate.js`), which applies every pending migration and exits 0, then the API on `OPENVERIFY_API_PORT`, the flow on `OPENVERIFY_FLOW_PORT` and the console on `OPENVERIFY_DASHBOARD_PORT`, each on the bind address. The images can also be built one by one (CLAUDE.md's commands: `docker build -f infra/docker/<api|dashboard|flow|code-runner>.Dockerfile -t openverify/<name>:11c-local .` and `docker build --build-context repo=. -t openverify/vision:11c-local services/vision`).

A development install seeds with the compiled dev seed, which refuses production mode and prints a new API key once:

```bash
docker compose -f infra/docker-compose.yml --env-file .env --profile app run --rm migrate node dist/commands/seed-dev.js
```

A production install creates its first organisation with `org:create` instead ([first-run.md](first-run.md)). Any other operator command runs the same way, as `node dist/commands/<command with - for :>.js` in the `migrate` service (for example `node dist/commands/kek-rewrap.js --dry-run`).

## What to change for production on one host

- `OPENVERIFY_MODE=production`, real secrets ([secrets-and-rotation.md](secrets-and-rotation.md)), and your own Postgres, Valkey and S3 with TLS and backups, or the compose ones with their volumes backed up ([backups-and-restore.md](backups-and-restore.md)).
- A TLS proxy in front of the API, the flow and the console, sending HSTS, and `OPENVERIFY_TRUST_PROXY` set to that proxy's address ([requirements.md](requirements.md#the-client-address)).
- An SMTP relay in place of Mailpit (`OPENVERIFY_SMTP_URL`, `OPENVERIFY_MAIL_FROM`).
- The IP reputation file, when bound, goes in `data/ip-reputation/` (git-ignored), mounted read-only at `/var/lib/openverify/ip-reputation` in the API and the worker; `OPENVERIFY_IP_REPUTATION_MMDB_PATH` names it there.
- A separate migration role and `db:grant-runtime` after every `db:migrate` ([database.md](database.md)).

## Pins

Every image the compose file pulls is pinned by digest, and every base image of the five builds too (`infra/docker/*.Dockerfile` build arguments). A pin is refreshed by hand with `infra/scripts/refresh-digests.sh <image>:<tag>`, which asks the registry and prints the reference with its date; a new pin must be at least 14 days old on its adoption day (C258.3), which the script does not check. `infra/tests/compose.test.sh` holds the compose file's contract.

## Not proven here

- The e2e suite's images mode (`e2e/README.md`) starts these images on host networking, which Docker Desktop serves to the host only with its host networking turned on; its spec runs on this project's machine are open (KP11-40, the owner's).
- The production images carry Debian base and Node 22.22.1 findings that `release.yml`'s image gate fails on (KP11-42, Workflow 11G), and the vision image's licence check fails on what `opencv-python-headless` bundles (KP11-39, the owner's): see `docs/release/checklist.md`.
