import { describe, expect, it } from 'vitest';
import { SmsSendError } from '../ports.js';
import { ProviderError } from './errors.js';

describe('ProviderError (C53.8)', () => {
  it('carries the code it is given and whether a retry can help, with its fixed message', () => {
    const error = new ProviderError('The registry did not answer', {
      retryable: true,
      code: 'upstream_unavailable',
    });

    expect(error).toMatchObject({
      name: 'ProviderError',
      code: 'upstream_unavailable',
      retryable: true,
      message: 'The registry did not answer',
    });
  });

  it('names a failure without a code provider_error', () => {
    expect(new ProviderError('The provider failed', { retryable: false }).code).toBe(
      'provider_error',
    );
  });
});

describe('SmsSendError (C53.8)', () => {
  it('names its code in a fixed message and never the destination or a provider body', () => {
    const error = new SmsSendError('rejected', { retryable: false });

    expect(error).toMatchObject({
      name: 'SmsSendError',
      code: 'rejected',
      retryable: false,
      message: 'SMS sending failed (rejected)',
    });
    expect(Object.keys(error)).not.toContain('destination');
  });
});
