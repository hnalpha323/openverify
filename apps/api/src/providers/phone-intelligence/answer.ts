/**
 * C82.2: the phone intelligence answer. The port's dates (`PhoneIntelligenceResult`) give SIM
 * swap and porting as a date or `null`, which cannot tell "no swap" from "not asked", and a line
 * type narrower than the providers'. So both providers here answer the port's optional `lookup`
 * too (owner decision 5 (c)), risk-logic's `PhoneIntelligenceLookup`: what was checked, in the
 * rule's terms.
 */
import type { PhoneIntelligenceLookup } from '@openverify/checks';
import type { PhoneIntelligenceResult } from '../../ports.js';

/** C82.2: the port's answer plus what the provider checked. */
export interface PhoneIntelligenceAnswer extends PhoneIntelligenceResult {
  readonly lookup: PhoneIntelligenceLookup;
}

/** The port's line types: the rest of a provider's vocabulary reads as none there. */
const PORT_LINE_TYPES = [
  'mobile',
  'landline',
  'fixedVoip',
  'nonFixedVoip',
  'prepaid',
  'payphone',
  'other',
] as const satisfies readonly NonNullable<PhoneIntelligenceResult['lineType']>[];

/** The answer of `lookup`, with the port's fields filled from it. */
export function answerOf(
  lookup: PhoneIntelligenceLookup,
  reachable: boolean | null = null,
): PhoneIntelligenceAnswer {
  return {
    carrier: lookup.carrier,
    lineType: PORT_LINE_TYPES.find((type) => type === lookup.lineType) ?? null,
    simSwappedAt: lookup.simSwap.checked ? lookup.simSwap.lastSwapAt : null,
    portedAt: lookup.porting.checked ? lookup.porting.lastPortedAt : null,
    reachable,
    lookup,
  };
}

/**
 * What the risk rule reads from a provider's answer: its `lookup` when it carries one; otherwise
 * the port's fields, read conservatively (a date was checked, a `null` was not).
 */
export function phoneIntelligenceLookupOf(
  result: PhoneIntelligenceResult,
): PhoneIntelligenceLookup {
  if (result.lookup !== undefined) {
    return result.lookup;
  }
  return {
    lineType: result.lineType,
    carrier: result.carrier,
    simSwap:
      result.simSwappedAt === null
        ? { checked: false }
        : { checked: true, lastSwapAt: result.simSwappedAt },
    porting:
      result.portedAt === null
        ? { checked: false }
        : { checked: true, lastPortedAt: result.portedAt },
  };
}
