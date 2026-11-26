/**
 * A provider failed (C35, C44, C53.8). `retryable` is false when retrying the job cannot help;
 * `code` names the failure. The message is a fixed description: never a provider's body, a
 * destination, a URL or anything the request carried.
 */
export class ProviderError extends Error {
  override name = 'ProviderError';
  readonly retryable: boolean;
  readonly code: string;

  constructor(message: string, options: { retryable: boolean; code?: string | undefined }) {
    super(message);
    this.retryable = options.retryable;
    this.code = options.code ?? 'provider_error';
  }
}
