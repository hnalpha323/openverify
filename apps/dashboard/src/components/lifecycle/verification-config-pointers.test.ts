import {
  API_VERIFICATION_TYPES,
  toVerificationResourceType,
  fromApiVerificationType,
} from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { VERIFICATION_TYPE_LABELS } from '../../lib/labels';
import { describeConfigPointer } from './verification-config-pointers';

describe('describeConfigPointer: where a refused verification config is wrong (C37)', () => {
  it.each([
    [
      '/government-id/checks/id_blur_detection/config/min-blur-score',
      'Government ID, check id_blur_detection, setting min-blur-score',
    ],
    [
      '/government-id/checks/id_extracted_properties_detection/config/required-fields/2',
      'Government ID, check id_extracted_properties_detection, setting required-fields, entry 3',
    ],
    [
      '/government-id/checks/id_blur_detection/config',
      'Government ID, check id_blur_detection, settings',
    ],
    [
      '/government-id/checks/id_blur_detection/required',
      'Government ID, check id_blur_detection, required',
    ],
    ['/selfie/checks/selfie_id_comparison', 'Selfie, check selfie_id_comparison'],
    ['/selfie/checks', 'Selfie, checks'],
    ['/government-id/allowed-countries/1', 'Government ID, allowed countries, entry 2'],
    ['/government-id/allowed-countries', 'Government ID, allowed countries'],
    ['/government-id/allowed-id-classes/0', 'Government ID, allowed ID classes, entry 1'],
    ['/selfie/allowed-id-classes', 'Selfie, allowed ID classes'],
    ['/government-id', 'Government ID'],
    // C50.4: the Phase 5 options.
    ['/crypto-wallet/allowed-chains/0', 'Crypto wallet, allowed chains, entry 1'],
    ['/crypto-wallet/allowed-chains', 'Crypto wallet, allowed chains'],
    ['/database/accept-review-without-provider', 'Database, accept review without a provider'],
    [
      '/government-id-nfc/checks/nfc_passive_authentication/config/allowed-anchor-sources/1',
      'Government ID chip, check nfc_passive_authentication, setting allowed-anchor-sources, entry 2',
    ],
    ['/database-business/allowed-countries/0', 'Business registry, allowed countries, entry 1'],
    // JSON Pointer escapes (RFC 6901): ~1 is "/" and ~0 is "~".
    ['/government-id/checks/a~1b~0c', 'Government ID, check a/b~c'],
  ])('says %s is %s', (pointer, words) => {
    expect(describeConfigPointer(pointer)).toBe(words);
  });

  it.each([
    '/',
    '',
    '/passport/checks',
    '/government-id/unknown-member',
    '/government-id/checks/id_blur_detection/enabled/x',
    '/database/accept-review-without-provider/0',
  ])('has no words for %j', (pointer) => {
    expect(describeConfigPointer(pointer)).toBeUndefined();
  });

  it.each(API_VERIFICATION_TYPES)('names the %s type and its checks', (type) => {
    const label =
      VERIFICATION_TYPE_LABELS[toVerificationResourceType(fromApiVerificationType(type))];

    expect(describeConfigPointer(`/${type}`)).toBe(label);
    expect(describeConfigPointer(`/${type}/checks/some_check`)).toBe(`${label}, check some_check`);
  });
});
