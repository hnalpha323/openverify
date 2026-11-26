/** SQLSTATE: five digits or uppercase letters, for example `23505` or `P0001`. */
const SQLSTATE = /^[0-9A-Z]{5}$/;

/**
 * The Postgres SQLSTATE of a failed query, or `undefined` when the error did not come
 * from the server. Drizzle wraps driver errors, so the causes are searched too. Both
 * node-postgres and PGlite raise a `DatabaseError` carrying `code` and `severity`;
 * requiring both keeps Node system codes such as `EPIPE` from being mistaken for one.
 */
export function pgErrorCode(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  let current = error;
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current);
    if (current instanceof SensitiveQueryError) {
      return current.code;
    }
    const { code, severity, cause } = current as {
      code?: unknown;
      severity?: unknown;
      cause?: unknown;
    };
    if (typeof code === 'string' && SQLSTATE.test(code) && typeof severity === 'string') {
      return code;
    }
    current = cause;
  }
  return undefined;
}

/**
 * `page[after]` names no record in the list being paged, for example an id from another
 * environment. API layers map it to 400. The message never echoes the cursor.
 */
export class InvalidCursorError extends Error {
  override name = 'InvalidCursorError';
  readonly code = 'invalid_cursor';

  constructor() {
    super('page[after] does not name a record in this list');
  }
}

/**
 * A query whose parameters are personal data (a background layout, Workflow 4B review H001)
 * failed. Drizzle's `DrizzleQueryError` puts every parameter into its message, and the driver's
 * message can quote a value, so this error keeps neither: only the operation and the SQLSTATE.
 * It has no `cause`, so nothing that logs or stores an error (a worker log, BullMQ's
 * `failedReason` and stack trace in Valkey) can reach the values.
 */
export class SensitiveQueryError extends Error {
  override name = 'SensitiveQueryError';
  /** The Postgres SQLSTATE, when the server answered. */
  readonly code: string | undefined;

  constructor(operation: string, code: string | undefined) {
    super(`${operation} failed${code === undefined ? '' : ` (SQLSTATE ${code})`}`);
    this.code = code;
  }
}

/**
 * Runs `query`, whose parameters are personal data; a failure is rethrown as a
 * {@link SensitiveQueryError} naming `operation` and the SQLSTATE only.
 */
export async function withSensitiveParameters<T>(
  operation: string,
  query: () => Promise<T>,
): Promise<T> {
  try {
    return await query();
  } catch (error) {
    throw new SensitiveQueryError(operation, pgErrorCode(error));
  }
}
