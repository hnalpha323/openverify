/**
 * Base class for errors raised by domain rules. `code` is a stable,
 * machine-readable snake_case identifier that API layers can map to an
 * RFC 9457 problem type. Messages must never contain PII.
 */
export class DomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}
