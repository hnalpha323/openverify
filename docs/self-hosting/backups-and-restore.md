# Backups and restore

What to back up, how to prove a restore works, and what a backup means for erasure (C277.6). The project runs no backup itself: backups are the operator's (C277.3).

## What to back up

| What | How | Notes |
|---|---|---|
| Postgres | Production: physical base backups with continuous WAL archiving, for point-in-time recovery. Small installs: `pg_dump` | Every sealed column is ciphertext in the backup; the keys that open it are not in the database |
| The KEK and the blind-index key | In your secrets store's own backup, **apart from the database's backups**, with `OPENVERIFY_KEK_PREVIOUS` while a rotation is under way | Without the KEK a backup cannot be read; with the KEK stored beside it, a backup is plain text in effect |
| The other secrets | Your secrets store | The pepper above all: without it every API key stops working |
| S3 | Bucket versioning, and replication or a backup per your provider | A redaction deletes every version of an object (`apps/api/src/storage/index.ts`); a replica or an object lock outlives that |
| Valkey | Its append-only file, if you keep one | Postgres is the record: a lost queue delays work, and the queues fed by an outbox table are re-enqueued by their sweeps; rate-limit counters and login limiter state are lost |

## A restore drill

Run one before you need one, and after every upgrade that changes the schema:

1. Restore Postgres into a fresh server (with pgvector installed), and the bucket.
2. Give the restored install the same KEK (and any previous KEK the backup's data keys were wrapped with) and the same blind-index key.
3. Run `pnpm --filter @openverify/api db:migrate` (`node dist/commands/db-migrate.js`): on a backup of the same release it applies nothing. Then `db:grant-runtime <runtime role>` ([database.md](database.md)).
4. Open one sealed value: sign in to the console and open an inquiry with a document; a sealed field that renders proves the KEK opens the data keys.
5. Download one file: the document's image renders through the API, proving the bucket and its key match.
6. Check `GET /ready`: it answers 200 only when Postgres and Valkey answer.

## Backups and erasure

A redaction (a subject's, or the C16 retention pass) deletes or nulls the rows and deletes every version of the objects in the bucket. **It cannot reach a backup.** Redacted data stays in every backup taken before the redaction until that backup expires, so **your backup retention window is the real erasure delay**. Choose it with that in mind, and state it where you state your erasure times; the compliance guide repeats this (`docs/compliance/README.md`). A restore from a backup older than a redaction brings the redacted data back: nothing replays the redactions made since the backup, so find them in the audit log (`inquiry.redacted`, `account.redacted`, `report.redacted`, `transaction.redacted`, `case.redacted` and the others) and repeat them before you open the restored install to users.
