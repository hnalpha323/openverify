import { describe, expect, it } from 'vitest';
import * as node from './index.js';

describe('@openverify/node entry point', () => {
  it('identifies the package', () => {
    expect(node.PACKAGE_NAME).toBe('@openverify/node');
  });

  it.each([
    'signWebhookPayload',
    'verifyWebhookSignature',
    'computeWebhookSignature',
    'WebhookSignatureError',
    'OPENVERIFY_SIGNATURE_HEADER',
    'createClient',
    'OpenVerifyError',
    'OpenVerifyApiError',
    'OpenVerifyConnectionError',
    'OpenVerifyTimeoutError',
    'OpenVerifyResponseValidationError',
    'parseApiAnswer',
    'apiErrorOf',
  ])('exports %s', (name) => {
    expect(node).toHaveProperty(name);
  });
});
