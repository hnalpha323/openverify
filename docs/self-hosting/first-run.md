# First run

The steps after the first `db:migrate` of a production install (C277.8, hardening H21). Each command runs on the host as `pnpm --filter @openverify/api <command>` or in the API image as `node dist/commands/<command with - for :>.js` (in compose, `docker compose ... --profile app run --rm migrate node dist/commands/<name>.js`).

## 1. The schema and the grant

`db:migrate` as the migration role, then `db:grant-runtime <runtime role>` ([database.md](database.md#two-roles)). The chart's migrate Job does both.

## 2. The first organisation

```bash
pnpm --filter @openverify/api org:create --name <name> --admin-email <email> [--slug <sign-in name>] [--print-invitation]
```

`org:create` (`node dist/commands/org-create.js`; C250.5) creates the organisation with `require-mfa` on, its sandbox and production environments, the built-in roles and the default inquiry template in each, and a single-use invitation for the first admin that lives 24 hours. No demo user and no API key. It writes one system audit entry, `organization.created`, in each environment; a second run with the same `--name` refuses and writes nothing. The invitation goes by SMTP when `OPENVERIFY_SMTP_URL` is set (it needs `OPENVERIFY_DASHBOARD_PUBLIC_URL`, where the link points); without SMTP it creates nothing unless `--print-invitation` is given on an interactive terminal.

**Never run it as a logged Job with `--print-invitation`.** A Kubernetes Job's or a CI runner's output lands in a log store, where the link would let anyone claim the organisation. The command prints the link only on an interactive terminal anyway; run it there, or let SMTP carry the invitation.

`seed:dev` refuses production mode: it is for development installs only. `face-scan:benchmark` and `seed:load` are development tools that the API image does not contain (Workflow 11F, KP11-71). From a source checkout, `face-scan:benchmark` writes a scratch organisation and refuses nothing about production, and `seed:load` refuses any database not named `openverify_load`. Never point either at a production database.

The first admin then signs in, enrols MFA (new organisations require it) and meets the step-up on sensitive actions (`docs/settings/mfa.md`). Single sign-on is optional ([sso.md](sso.md)).

## 3. Providers, per environment

Bind each A-tier provider kind per environment kind with `OPENVERIFY_PROVIDER_{KIND}_{MODE}` (`SANDBOX` or `PRODUCTION`; [configuration.md](configuration.md#names-composed-at-run-time)), each process receiving only the kinds it reads. A sandbox environment uses the deterministic sandbox providers; a production environment needs your licensed providers and their credentials. Leave a kind unbound to turn it off. The `deviceIntegrity` binding stays unset unless you use Play Integrity ([requirements.md](requirements.md#optional-parts-and-what-each-needs)).

## 4. The first list syncs

```bash
pnpm --filter @openverify/api watchlists:sync          # every enabled watchlist source
pnpm --filter @openverify/api pep:sync                 # the wikidata-pep source, with OPENVERIFY_WIKIDATA_USER_AGENT
```

Watch the first real syncs of each source (H21): each prints counts and outcomes only, and exits 1 unless every source applied, stayed unchanged or was re-keyed. A refusal names its guard (a mass removal, an older publication); read it before overriding with `--allow-mass-removal` or `--accept-older-publication`. The EU list needs `OPENVERIFY_EU_FSF_TOKEN`. `OPENVERIFY_WATCHLIST_REFRESH` turns on the worker's periodic refresh (off by default).

- **The UN Security Council list is opt-in per environment** (C254.1; Q10 granted 2026-11-21): `OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED` is true by default (no image bakes a value, and no seed opts an environment in), so an environment admin (`settings:write` and `settings:privacy`, with a second factor verified within the step-up window) may enable `un-sc` for that environment with `POST /api/v1/dashboard/watchlist-sources/un-sc/opt-in` and an acknowledgement naming the UN's terms link from `watchlists/sources.json`; the acceptance is stored with the user and time and audited, and `DELETE` on the same path withdraws it. The next `watchlists:sync` (or the API's or the worker's start, or the refresh tick) enables the row and downloads the list, and only the environments that opted in screen it. The UN site's terms grant personal, non-commercial use: whether your use fits is yours to decide before you opt in. Set the variable to `false` to lock the list on this install (every opt-in then answers 409 `watchlist_source_locked`).
- **Conditional requests**: only `uk-sanctions-list` sends them. A 304 is the publisher's statement that nothing changed; the platform's own proof is the SHA-256 comparison of a full download at least every `watchlist-full-check-hours` (24 by default), so a 304 never outlasts it. A changed conditional list is fetched twice (KP11-29, Workflow 11F).
- **Network data** (`docs/network/README.md#syncing`): `pnpm --filter @openverify/api network:sync` once, then by hand or with `OPENVERIFY_NETWORK_REFRESH` (off by default). A refusal is recorded on the source and counts toward its back-off; the sync's finished line names the source and the code.

## 5. Trust anchors (NFC)

`pnpm --filter @openverify/api trust-anchors:sync` fills the CSCA trust store from `trust-anchors/manifest.json`, verifying each master list against its pinned root; it exits 1 when a source was refused. `OPENVERIFY_TRUST_ANCHOR_REFRESH` turns on the worker's refresh. A sandbox environment's test chip needs the Utopia test anchor: `pnpm --filter @openverify/api trust:sandbox-utopia` installs it (`seed:dev` does too, and it refuses production); without it the sandbox chip answers 409 `sandbox_chip_anchor_missing` (`docs/android/nfc.md`).

## 6. Retention

Set each environment's retention settings before real data arrives (`docs/settings/README.md` lists every setting, its default and its range). The C16 pass runs daily in the worker; `pnpm --filter @openverify/api retention:run [--now=<ISO-8601>] [--json]` runs it once and prints counts only. Remember that backups keep redacted data until they expire ([backups-and-restore.md](backups-and-restore.md#backups-and-erasure)).

## 7. Then

Set up alerts ([monitoring.md](monitoring.md)), run a restore drill ([backups-and-restore.md](backups-and-restore.md#a-restore-drill)) and walk the [hardening checklist](hardening-checklist.md).
