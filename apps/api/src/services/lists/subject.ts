/**
 * C99.5 (Workflow 7B): what an inquiry holds that a list can read: the screening's probes
 * (`probes.ts`) and the custom-list report's query (`services/reports/completion.ts`) share it, so
 * both take the same values from the same sources, in the order of C84.2.
 *
 * A verification from a rejected handoff is left out (C96.3): the person the inquiry is about said
 * those captures are not theirs. Nothing here logs; the values reach a sealed row or a key only.
 */
import {
  getAccount,
  getVerificationInputs,
  listGovernmentIdExtractions,
  listInquiryVerifications,
  type Db,
  type IdClass,
  type Inquiry,
  type VerificationWithChecks,
} from '@openverify/db';
import { loadVerificationAttributes } from '../attributes/index.js';

type Values = Readonly<Record<string, unknown>>;

/** A trimmed text, or `null`. */
export const textOf = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

const asValues = (value: unknown): Values =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Values) : {};

/** The latest decided government ID, read. */
export interface GovernmentIdValues {
  number: string | null;
  idClass: IdClass | null;
  nameFirst: string | null;
  nameLast: string | null;
  /** The issuing country (C90.2). */
  country: string | null;
}

/** C99.5: the values of an inquiry and its account. */
export interface ListSubject {
  governmentId: GovernmentIdValues | null;
  /** The number the latest database verification was given. */
  databaseNumber: string | null;
  email: string | null;
  phone: string | null;
  inquiryFields: Values;
  accountFields: Values;
}

/** The verifications a list may read of, newest last. */
const usable = (verifications: readonly VerificationWithChecks[]) =>
  verifications.filter(({ fromRejectedHandoff }) => !fromRejectedHandoff);

function latestOf(
  verifications: readonly VerificationWithChecks[],
  type: VerificationWithChecks['type'],
  statuses: readonly string[],
): VerificationWithChecks | undefined {
  return verifications.filter((v) => v.type === type && statuses.includes(v.status)).at(-1);
}

/** The confirmed OTP destination of the latest passed verification of `type`, if any. */
async function confirmedDestination(
  tx: Db,
  verifications: readonly VerificationWithChecks[],
  type: 'email_address' | 'phone_number',
  member: 'email-address' | 'phone-number',
): Promise<string | null> {
  const verification = latestOf(verifications, type, ['passed']);
  const attributes =
    verification === undefined ? undefined : await loadVerificationAttributes(tx, verification);
  return attributes?.['confirmed-at'] == null ? null : textOf(attributes[member]);
}

async function governmentIdOf(
  tx: Db,
  environmentId: string,
  verifications: readonly VerificationWithChecks[],
): Promise<GovernmentIdValues | null> {
  const verification = latestOf(verifications, 'government_id', ['passed', 'needs_review']);
  if (verification === undefined) {
    return null;
  }
  const extraction = (await listGovernmentIdExtractions(tx, environmentId, [verification.id])).get(
    verification.id,
  );
  const fields = asValues(extraction?.fields);
  const group = extraction?.idClassGroup ?? 'unknown';
  return {
    number: textOf(fields['identification-number']),
    idClass: group === 'unknown' ? null : group,
    nameFirst: textOf(fields['name-first']),
    nameLast: textOf(fields['name-last']),
    country: verification.country,
  };
}

async function databaseNumberOf(
  tx: Db,
  environmentId: string,
  verifications: readonly VerificationWithChecks[],
): Promise<string | null> {
  const verification = latestOf(verifications, 'database', ['passed', 'needs_review']);
  if (verification === undefined) {
    return null;
  }
  const inputs = await getVerificationInputs(tx, environmentId, verification.id);
  return textOf(inputs?.values?.['identification-number']);
}

/** Reads the inquiry's values (C99.5). */
export async function readListSubject(tx: Db, inquiry: Inquiry): Promise<ListSubject> {
  const { environmentId } = inquiry;
  const verifications = usable(await listInquiryVerifications(tx, environmentId, inquiry.id));
  // A plain read: nothing here takes an account lock (F04).
  const account = await getAccount(tx, environmentId, inquiry.accountId);
  return {
    governmentId: await governmentIdOf(tx, environmentId, verifications),
    databaseNumber: await databaseNumberOf(tx, environmentId, verifications),
    email: await confirmedDestination(tx, verifications, 'email_address', 'email-address'),
    phone: await confirmedDestination(tx, verifications, 'phone_number', 'phone-number'),
    inquiryFields: asValues(inquiry.fields),
    accountFields: asValues(account?.fields),
  };
}
