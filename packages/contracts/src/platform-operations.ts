/**
 * C249.4, C250 (Phase 11, Workflow 11B Stage 1a, checkpoint (P)): what the platform's operations
 * answer, frozen for `foundation-11b` and `platform-ops`.
 *
 * - `GET /ready` (C250.1), plugin-registered beside `/health`, never rate-limited, out of the
 *   public OpenAPI document as `/health`'s sibling: Postgres `SELECT 1` and Valkey `PING`, each
 *   within `READINESS_CHECK_TIMEOUT_MS`; 200 `readyResponseSchema` or 503 `notReadyResponseSchema`,
 *   which names each store `ok` or `unavailable` and never an error's text. Readiness only, never
 *   liveness: it says the process reaches its stores now, nothing about vision or a provider.
 * - The worker's heartbeat (C250.2): a file written every `intervalMs` from the event loop, stale
 *   after `maxAgeMs`; `node dist/worker-health.js` exits 0 while it is fresh, else 1. No port.
 * - The migrate lock (C249.4): `db:migrate` holds the session advisory lock `key` (the first eight
 *   bytes of the SHA-256 of `label`, as a signed 64-bit integer) around the migrations and the
 *   event-id backfill, waits at most `OPENVERIFY_MIGRATE_LOCK_TIMEOUT_SECONDS` and then exits
 *   `exitCode` with the log code `code`; a second run waits and then finds nothing to do.
 * - `org:create` (C250.5): an organisation with both environments, the default template and
 *   `require-mfa: true`, and a single-use invitation of `invitationTtlSeconds` for its first admin,
 *   sent by SMTP when the mailer is configured and printed only on an interactive terminal with
 *   `--print-invitation` (review P22); `--slug` (ours, amendment 10) sets the sign-in name.
 */
import { z } from 'zod';

/** C250.1: the stores `/ready` checks, in order. */
export const READINESS_CHECKS = Object.freeze(['postgres', 'valkey'] as const);
/** C250.1: each check's own deadline (the plan's 1 s). */
export const READINESS_CHECK_TIMEOUT_MS = 1000;

const checkStateSchema = z.enum(['ok', 'unavailable']);

/** C250.1: 200 from `GET /ready`. */
export const readyResponseSchema = z.strictObject({ status: z.literal('ready') });
/** C250.1: 503 from `GET /ready`, each store's state and no error text. */
export const notReadyResponseSchema = z.strictObject({
  status: z.literal('not_ready'),
  checks: z.strictObject({ postgres: checkStateSchema, valkey: checkStateSchema }),
});
export type NotReadyResponse = z.infer<typeof notReadyResponseSchema>;

/** C250.2: the worker heartbeat (`OPENVERIFY_WORKER_HEARTBEAT_FILE` overrides the file). */
export const WORKER_HEARTBEAT = Object.freeze({
  intervalMs: 10_000,
  maxAgeMs: 30_000,
  defaultFile: '/tmp/openverify-worker-heartbeat',
});

/** C249.4: the migrate lock (`OPENVERIFY_MIGRATE_LOCK_TIMEOUT_SECONDS`, 1 to the max). */
export const MIGRATE_LOCK = Object.freeze({
  label: 'openverify:migrate',
  /** `pg_advisory_lock`'s bigint, as text (a JavaScript number cannot hold it). */
  key: '1480802125763551134',
  timeoutSecondsDefault: 600,
  timeoutSecondsMax: 3600,
  /** EX_TEMPFAIL: another run holds the lock; run it again. */
  exitCode: 75,
  code: 'migrate_lock_timeout',
});

/** C250.5: `pnpm --filter @openverify/api org:create` (ours: `--slug`). */
export const ORG_CREATE = Object.freeze({
  invitationTtlSeconds: 86_400,
  flags: Object.freeze(['--name', '--admin-email', '--slug', '--print-invitation'] as const),
});
