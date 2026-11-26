/**
 * C207.2, C221.1 (Workflow 10C, `contracts-10c`): the nfc client view's `prefillMrz` is nulled for
 * a reader without `pii:view`, wherever a logged body carries it. (The API log stores no
 * session-token request today, so no flow session answer is stored; the mask holds if one ever is.)
 */
import { NFC_PREFILL_MRZ_MEMBER } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { maskPersonalData } from './api-logs.js';

describe('maskPersonalData and the nfc client view (C221.1)', () => {
  it('nulls prefillMrz and keeps the view around it', () => {
    const body = {
      step: {
        id: 'chip',
        type: 'nfc',
        androidOnly: true,
        fallbackAvailable: true,
        prefillMrz: { documentNumber: 'L898902C3', birthDate: '740812', expiryDate: '120415' },
      },
    };

    const masked = maskPersonalData(body);

    expect(masked).toEqual({
      step: {
        id: 'chip',
        type: 'nfc',
        androidOnly: true,
        fallbackAvailable: true,
        [NFC_PREFILL_MRZ_MEMBER]: null,
      },
    });
    expect(JSON.stringify(masked)).not.toContain('L898902C3');
  });
});
