/**
 * C136.4 (P25; Workflow 8B Stage 4): a searchable case field is keyed under a label of its own,
 * `openverify/identifier-case-field/v1`, never the transaction field's, with the input
 * `case/<template id>/<field key>|<text>`. The expected value was computed with OpenSSL 3.0.13, the
 * environment subkey first (as `identifier-key.test.ts` says), then:
 *   printf '%s' 'openverify/identifier-case-field/v1|case/ctmpl_01K0000000000000000000TMPL/reference|synthetic-ref' \
 *     | openssl dgst -sha256 -mac HMAC -macopt hexkey:<subkey>
 */
import { describe, expect, it } from 'vitest';
import { caseFieldValueKey } from './case-field-index.js';

const TEST_KEY = Uint8Array.from({ length: 32 }, (_, index) => index);
const SANDBOX = 'env_01K0000000000000000000SBXA';
const TEMPLATE = 'ctmpl_01K0000000000000000000TMPL';

describe('caseFieldValueKey (C136.4, P25)', () => {
  it('keys a case field under the case label, per template and field', () => {
    const keyed = caseFieldValueKey(TEST_KEY, {
      environmentId: SANDBOX,
      caseTemplateId: TEMPLATE,
      fieldKey: 'reference',
      text: 'synthetic-ref',
    });

    expect(keyed).toBe('56733593e58f8d593ed72ea827f903608cad08013d155dd1d334080d3354a4db');
  });
});
