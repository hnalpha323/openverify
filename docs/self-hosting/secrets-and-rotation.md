# Secrets and rotation

Where each secret lives and how it rotates (C277.5). This page names variables and commands, never a value. Every secret's algorithm, length, reader and usage limit is in the cryptographic inventory, `docs/security/crypto-inventory.md`; which process reads which secret is [configuration.md](configuration.md).

## Where secrets live

- **On Kubernetes**: one Secret per process (`secrets.<process>.existingSecret` in the chart), mounted as files at `0440` with the pod's `fsGroup`, each read through its `<NAME>_FILE` variable ([install-kubernetes.md](install-kubernetes.md#secrets)). The chart creates none.
- **With compose**: `.env`, read into each service's environment; or files you mount yourself with the `_FILE` names ([install-compose.md](install-compose.md#what-the-profile-is)).
- Every secret also has its `_FILE` form in every process that reads it. Setting both forms stops the start; a world-readable file is a warning (`secret_file_readable`), a group-readable one is not. In production mode a `change-me` placeholder is refused.
- **Back up the KEK and the blind-index key apart from the database's backups**: a backup without them cannot be read, and a backup stored with them is plain text in effect ([backups-and-restore.md](backups-and-restore.md)).

## The KEK (`OPENVERIFY_KEK`)

Every sealed column's data key is wrapped by the KEK (C16; the sealed columns are `packages/db/src/encrypted-columns.ts`).

1. Put the current key in `OPENVERIFY_KEK_PREVIOUS` (comma-separated, it may hold more than one) and the new key in `OPENVERIFY_KEK`, for the API, the worker and migrate.
2. Roll every one of those processes, so each can open both.
3. Run `pnpm --filter @openverify/api kek:rewrap` (in an image: `node dist/commands/kek-rewrap.js`). It rewraps every stored data key in batches without decrypting a payload, saves its position after every batch (an interrupted run resumes; `--restart` ignores the saved position), prints counts only, and reads the migration role's URL when set. `--dry-run` counts what would change and writes nothing.
4. When it reports `done`, remove the old key from `OPENVERIFY_KEK_PREVIOUS` and roll again.

## The blind-index key (`OPENVERIFY_BLIND_INDEX_KEY`)

The blind index (C31.8) keys every searchable HMAC: identification numbers, OTP destinations, wallet addresses, chip reads, device HMACs (Workflow 7A), list keys, transaction field keys (Workflow 7B), case field keys, the audit explorer's address index, the graph's rows and the report index. It has no previous form: a change makes every existing index miss until it is rebuilt.

1. Set the new key for the API, the worker and migrate, and roll them.
2. At once run `pnpm --filter @openverify/api blind-index:rebuild [--batch-size=<1-10000>]` (`node dist/commands/blind-index-rebuild.js`), before the worker processes more verifications. It decrypts with the KEK and recomputes every index; redacted rows have none and stay as they are. Two devices that meet under the new key are merged (`docs/network/README.md`); the graph and transaction field keys are re-keyed with the rest.
3. Until it finishes, a list item whose `key_id` is not the current key reads `key_rotated` (`docs/lists/README.md`), and lookups by the old key miss.

## The API-key pepper (`OPENVERIFY_API_KEY_PEPPER`)

API keys are stored as an HMAC under the pepper (C247.1).

1. Move the current pepper to `OPENVERIFY_API_KEY_PEPPER_PREVIOUS` (at most two, comma-separated), set the new one, and roll the API and the worker. A key found under a previous pepper is re-hashed under the current one in the same request, so the rotation completes as keys are used.
2. `pnpm --filter @openverify/api api-keys:pepper-status` (`node dist/commands/api-keys-pepper-status.js`) prints how many keys each pepper still holds, never a key or a hash.
3. Remove the previous pepper when its count is zero, or accept that the keys still under it stop working.

## Tokens between processes

| Token | Shared by | Previous form | Order |
|---|---|---|---|
| `OPENVERIFY_FLOW_SERVER_TOKEN` | the API and the flow server | `OPENVERIFY_FLOW_SERVER_TOKEN_PREVIOUS` (the API) | set the new token and the old one as previous in the API, roll the API; give the flow server the new token, roll it; remove the previous |
| `OPENVERIFY_VISION_SERVICE_TOKEN` | the API, the worker and vision | none | change all three together; requests to vision fail between the rolls |
| `OPENVERIFY_DASHBOARD_BFF_TOKEN` | the API and the console | none | change both together; console requests fail between the rolls |
| `OPENVERIFY_CODE_RUNNER_TOKEN` | the worker and the code runner (`tcp:` only) | none | change both together; code steps fail between the rolls |

## Other secrets

- **Webhook secrets**: `POST /api/v1/webhooks/:id/rotate-secret` answers the new secret once; the previous one keeps signing beside it for up to 7 days (24 hours by default), so receivers accept either until it ends (`docs/settings/webhooks.md#secret-rotation`).
- **API keys**: one-call rotation, expiry, notes and age warnings (`docs/settings/api-keys.md#rotation`).
- **Workflow secrets**: sealed values with a previous value kept up to 24 hours for a signing secret (`docs/workflows/secrets.md`).
- **OIDC client secrets**: stored sealed per provider; replace one through the console or the API ([sso.md](sso.md)).
- **TOTP secrets and recovery codes**: per user, through the console (`docs/settings/mfa.md`); an operator resets a locked-out user with `user:reset-mfa` ([break-glass.md](break-glass.md)).
- **The Play Integrity service account** (`OPENVERIFY_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON`, the worker only): create a new key in your Google Cloud project, replace the worker's file, roll the worker, then delete the old key there (`docs/android/device-integrity.md`).
- **Provider credentials** (Twilio, Companies House, Smarty and the others in [configuration.md](configuration.md)): replace and roll the process that reads each.
- **Database, Valkey and S3 credentials**: create the new credential beside the old (a second Postgres password or role, a second Valkey ACL user, a second S3 key), give it to the processes, roll them, then remove the old one. The migration role's credential is read only by the migrate Job and the commands that need it.
