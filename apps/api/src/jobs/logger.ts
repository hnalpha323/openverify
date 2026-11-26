/**
 * Logging for the background workers: pino with the API's redaction paths, plus the
 * worker's own sensitive keys. Worker code logs ids, statuses, check names and error
 * classes only; the extra paths are a second line of defence against an image, an
 * embedding or a secret reaching a log line.
 */
import { pino, type DestinationStream } from 'pino';
import { PERSONAL_LOG_KEYS, REDACT_PATHS, REDACTED } from '../logger.js';

/** The logging calls workers make: a context object and a message. */
export interface WorkerLogger {
  info(object: Record<string, unknown>, message: string): void;
  warn(object: Record<string, unknown>, message: string): void;
  error(object: Record<string, unknown>, message: string): void;
}

/**
 * Images, embeddings, secrets and bodies; and the selfie's biometric and device data (C40.5,
 * C41.6): the sealed device snapshot and its camera label (which can carry a person's name),
 * face landmarks, background layouts and face templates.
 */
const SENSITIVE_KEYS = [
  'embedding',
  'bytes',
  'ciphertext',
  'secret',
  'serviceToken',
  'body',
  'device',
  'label',
  'landmarks',
  'layout',
  'template',
  // C53.8: Phase 5's specific personal names (OTP codes and destinations, challenge and signed
  // messages, entered values, wallet addresses, chip files and AA responses).
  ...PERSONAL_LOG_KEYS,
];

/** Redacted wherever they appear, up to four levels deep. */
export const WORKER_REDACT_PATHS: readonly string[] = SENSITIVE_KEYS.flatMap((key) => [
  key,
  `*.${key}`,
  `*.*.${key}`,
  `*.*.*.${key}`,
]);

export interface WorkerLoggerSettings {
  /** Defaults to `openverify-worker`; the API process logs outside a request as `openverify-api`. */
  name?: string;
  level?: string;
  /** Defaults to stdout. Tests pass an in-memory stream. */
  destination?: DestinationStream;
}

export function createWorkerLogger(settings: WorkerLoggerSettings = {}): WorkerLogger {
  const options = {
    name: settings.name ?? 'openverify-worker',
    level: settings.level ?? 'info',
    redact: { paths: [...REDACT_PATHS, ...WORKER_REDACT_PATHS], censor: REDACTED },
  };
  return settings.destination === undefined ? pino(options) : pino(options, settings.destination);
}
