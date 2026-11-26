/**
 * C61.6: the sandbox business register (sandbox environments only, ADR 0002 §3d). It calls nothing
 * and answers from the last four letters or digits of the registration number (upper-cased, other
 * characters dropped):
 *
 * | Ending | Answer |
 * |---|---|
 * | `0000` | a record that does not match: another name, number and address (identity `low_confidence_match`) |
 * | `9999` | not found, authoritatively (`registration_number_not_found` with a number) |
 * | `8888` | the business, dissolved (`business_inactive`) |
 * | `7777` | the business, with officers that do not include the sandbox officer or PSC |
 * | anything else, or no number | the business: active, authoritative, echoing the input |
 *
 * Every record found lists the persons of {@link SANDBOX_REGISTRY_PERSONS} (with `7777`, those of
 * {@link SANDBOX_REGISTRY_OTHER_PERSONS}), so an associated person passes only as the sandbox
 * officer or PSC, with the birth month shown. Every country is covered; results carry
 * `provider: { id: 'sandbox', sandbox: true }`. Real registers never read these endings.
 */
import { createHash } from 'node:crypto';
import type {
  BusinessPerson,
  BusinessRecord,
  BusinessRegistryLookupResult,
  BusinessRegistryRequest,
  SandboxBusinessRegistryProvider,
} from '../../ports.js';

/** The registration-number endings the sandbox register reads (C61.6). */
export const SANDBOX_REGISTRY_MAGIC = Object.freeze({
  identityMismatch: '0000',
  notFound: '9999',
  inactive: '8888',
  personNotOnRegister: '7777',
});

/** The sandbox officer and person with significant control, synthetic (C61.6, C61.7). */
export const SANDBOX_REGISTRY_PERSONS: readonly BusinessPerson[] = Object.freeze([
  Object.freeze({
    name: 'PLACEHOLDER, Ada',
    birthMonth: '1980-04',
    role: 'officer' as const,
    active: true,
  }),
  Object.freeze({
    name: 'TESTERTON, Robin',
    birthMonth: '1975-09',
    role: 'psc' as const,
    active: true,
  }),
]);

/** The persons a `7777` record lists instead, also synthetic. */
export const SANDBOX_REGISTRY_OTHER_PERSONS: readonly BusinessPerson[] = Object.freeze([
  Object.freeze({
    name: 'MARROWSTONE, Quentin',
    birthMonth: '1968-11',
    role: 'officer' as const,
    active: true,
  }),
]);

/** The registration number's last four letters or digits, upper-cased; `null` without one. */
function endingOf(number: string | undefined): string | null {
  const compact = (number ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return compact.length < 4 ? null : compact.slice(-4);
}

/** The record id of a business entered without a number: a digest of what was entered. */
function derivedRecordId(request: BusinessRegistryRequest): string {
  const digest = createHash('sha256')
    .update(`${request.country}\u0000${request.businessName}\u0000${request.lei ?? ''}`)
    .digest('hex');
  return `sandbox-${digest.slice(0, 12)}`;
}

/** The record echoing the request: active, with the sandbox officer and PSC. */
function echoRecord(request: BusinessRegistryRequest): BusinessRecord {
  const address = request.address;
  return {
    source: 'sandbox',
    recordId: request.registrationNumber ?? derivedRecordId(request),
    legalName: request.businessName,
    otherNames: [],
    status: 'active',
    statusDetail: null,
    registeredAddress: {
      lines: address?.street1 === undefined ? [] : [address.street1],
      city: address?.city ?? null,
      region: address?.subdivision ?? null,
      postalCode: address?.postalCode ?? null,
      country: request.country,
    },
    jurisdiction: request.country,
    registrationNumber: request.registrationNumber ?? null,
    persons: SANDBOX_REGISTRY_PERSONS,
  };
}

/** A synthetic business other than the one entered (`0000`). */
function otherBusiness(request: BusinessRegistryRequest): BusinessRecord {
  const name =
    request.businessName === 'Marrowstone Placeholder Holdings'
      ? 'Quillfeather Placeholder Trading'
      : 'Marrowstone Placeholder Holdings';
  const street =
    request.address?.street1 === '88 Synthetic Lane'
      ? '99 Placeholder Avenue'
      : '88 Synthetic Lane';
  return {
    ...echoRecord(request),
    recordId: 'SANDBOX-OTHER',
    legalName: name,
    registeredAddress: {
      lines: [street],
      city: 'Elsewhere Synthetic',
      region: null,
      postalCode: request.address?.postalCode === 'ZZ99 9ZZ' ? 'ZZ98 8ZZ' : 'ZZ99 9ZZ',
      country: request.country,
    },
    registrationNumber: request.registrationNumber === '00000001' ? '00000002' : '00000001',
  };
}

/** C61.6: the answer the sandbox register gives `request`. */
export function sandboxRegistryAnswer(
  request: BusinessRegistryRequest,
): BusinessRegistryLookupResult {
  const found = (record: BusinessRecord): BusinessRegistryLookupResult => ({
    outcome: 'found',
    record,
    authoritative: true,
    personsAvailable: true,
  });
  switch (endingOf(request.registrationNumber)) {
    case SANDBOX_REGISTRY_MAGIC.notFound:
      return { outcome: 'not_found', authoritative: true };
    case SANDBOX_REGISTRY_MAGIC.identityMismatch:
      return found(otherBusiness(request));
    case SANDBOX_REGISTRY_MAGIC.inactive:
      return found({ ...echoRecord(request), status: 'dissolved' });
    case SANDBOX_REGISTRY_MAGIC.personNotOnRegister:
      return found({ ...echoRecord(request), persons: SANDBOX_REGISTRY_OTHER_PERSONS });
    default:
      return found(echoRecord(request));
  }
}

/** The sandbox register (C61.6): it calls nothing. */
export function createSandboxRegister(): SandboxBusinessRegistryProvider {
  return {
    id: 'sandbox',
    sandbox: true,
    lookup: (request) => Promise.resolve(sandboxRegistryAnswer(request)),
  };
}
