/**
 * C249.1, C249.2 (Workflow 11B Stage 1b common; foundation-11b): what a process warns about once at
 * start, read from its configuration. A warning names a store or a variable and its reason, never
 * a value: no URL, path content or secret reaches it. The API, the worker and migrate log each one
 * at `warn` (`logStartupWarnings`); the configuration only collects them.
 */

/** One start-up warning. `code` is stable; `reason` is a sentence for the operator. */
export interface StartupWarning {
  /** For example `insecure_transport` (C249.1) or `secret_file_readable` (C249.2). */
  readonly code: string;
  /** The store a transport warning is about (`postgres`, `redis`, `s3`, `vision`), if any. */
  readonly store?: string;
  /** The variable a warning is about, if any (its name only). */
  readonly variable?: string;
  readonly reason: string;
}

/** The part of a pino logger the warnings need. */
export interface StartupWarningLogger {
  warn(object: Record<string, unknown>, message: string): void;
}

/** Logs each warning once at `warn`, with its code and store or variable as fields. */
export function logStartupWarnings(
  logger: StartupWarningLogger,
  warnings: readonly StartupWarning[],
): void {
  for (const warning of warnings) {
    logger.warn(
      {
        code: warning.code,
        ...(warning.store === undefined ? {} : { store: warning.store }),
        ...(warning.variable === undefined ? {} : { variable: warning.variable }),
      },
      warning.reason,
    );
  }
}
