/**
 * C82.4: the sandbox `addressVerification` provider (sandbox environments only, ADR 0002 §3d). It
 * calls nothing and answers by the house number, the first word of `street1`:
 *
 * | House number | Answer |
 * |---|---|
 * | `1000` | confirmed, residential |
 * | `1001` | confirmed, commercial |
 * | `1002` | not confirmed (undeliverable) |
 * | `1003` | confirmed, a CMRA |
 * | `1004` | confirmed, vacant |
 * | `1005` | confirmed, the secondary (unit) missing |
 * | `1006` | confirmed, the secondary invalid |
 * | anything else | `deliverability: unknown`, every other field `null` |
 *
 * The confirmed answers carry the DPV match code, CMRA, vacancy and activity flags and the RDI a
 * vendor would, and synthetic metadata (`Sandbox County`); no coordinates are made up.
 */
import type { AddressVerificationProvider, AddressVerificationResult } from '../../ports.js';
import { emptyAddressFields } from './fields.js';

interface Scenario {
  matchCode: 'Y' | 'D' | 'S' | 'N';
  residential?: boolean;
  cmra?: boolean;
  vacant?: boolean;
}

/** C82.4: the sandbox's house numbers. */
export const SANDBOX_ADDRESS_SCENARIOS: Readonly<Record<string, Scenario>> = Object.freeze({
  '1000': { matchCode: 'Y', residential: true },
  '1001': { matchCode: 'Y', residential: false },
  '1002': { matchCode: 'N' },
  '1003': { matchCode: 'Y', cmra: true },
  '1004': { matchCode: 'Y', vacant: true },
  '1005': { matchCode: 'D' },
  '1006': { matchCode: 'S' },
});

const DELIVERABILITY = {
  Y: 'confirmed',
  D: 'confirmed_missing_secondary',
  S: 'confirmed_secondary_invalid',
  N: 'not_confirmed',
} as const;

function answerOf(scenario: Scenario): AddressVerificationResult {
  const { matchCode } = scenario;
  if (matchCode === 'N') {
    // As a vendor answers an address it knows no delivery point for: nothing but the verdict.
    return { fields: { ...emptyAddressFields(), deliverability: 'not_confirmed' } };
  }
  return {
    fields: {
      ...emptyAddressFields(),
      deliverability: DELIVERABILITY[matchCode],
      'metadata-record-type': 'S',
      'metadata-zip-type': 'standard',
      'metadata-county-fips': '00000',
      'metadata-county-name': 'Sandbox County',
      'metadata-carrier-route': 'C000',
      'metadata-precision': 'Zip9',
      'metadata-residential-delivery-indicator':
        scenario.residential === false ? 'commercial' : 'residential',
      'analysis-dpv-match-code': matchCode,
      'analysis-dpv-cmra': scenario.cmra === true,
      'analysis-dpv-vacant': scenario.vacant === true,
      'analysis-active': true,
    },
  };
}

/** The sandbox provider (C82.4): it calls nothing. */
export function createSandboxAddressVerificationProvider(): AddressVerificationProvider {
  return {
    id: 'sandbox',
    sandbox: true,
    verify({ street1 }) {
      const house = street1.trim().split(/\s+/u)[0] ?? '';
      const scenario = Object.hasOwn(SANDBOX_ADDRESS_SCENARIOS, house)
        ? SANDBOX_ADDRESS_SCENARIOS[house]
        : undefined;
      return Promise.resolve(
        scenario === undefined
          ? { fields: { ...emptyAddressFields(), deliverability: 'unknown' } }
          : answerOf(scenario),
      );
    },
  };
}
