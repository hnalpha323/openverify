/**
 * C52.6, C54.1: what `POST /flow/verifications/:id/submit` asks of each type, one guard per type
 * (`services/submit/<api-type>.ts`). `submitVerification` (`services/flow.ts`) calls the guard of
 * the verification's type:
 *
 * 1. `checkBody`, before any lock: the body's members fit the type (`capture` for a selfie,
 *    `crypto` for a crypto wallet, `chip` for an NFC chip; 422 otherwise) and any rule that needs
 *    no state;
 * 2. `inTransaction`, under the C40.6 locks (the inquiry re-checked open, the verification
 *    re-checked in `submittableStatuses`), before the move to `submitted`: the type's evidence is
 *    complete (files, entered values, a consumed challenge) and its sub-resources consumed; it
 *    returns the files `verification.submitted` names and the events to stage before it;
 * 3. `repeat`, for a repeated submit of a `submitted` verification (C3), which only enqueues
 *    again: a type may refuse it (a selfie names the capture that submitted it).
 */
import type { FlowSubmitVerificationBody, SupportedVerificationType } from '@openverify/contracts';
import type {
  Db,
  Inquiry,
  StoredFile,
  VerificationStatus,
  VerificationWithChecks,
} from '@openverify/db';
import type { FlowStep } from '@openverify/flow-spec';
import type { FlowSession } from '../../auth/flow-session.js';
import type { StagedEvent } from '../../events/index.js';
import type { ApiDependencies } from '../context.js';
import { aamvaSubmit } from './aamva.js';
import { businessWebsiteSubmit } from './business-website.js';
import { cryptoWalletSubmit } from './crypto-wallet.js';
import { databaseBusinessSubmit } from './database-business.js';
import { databaseSubmit } from './database.js';
import { documentSubmit } from './document.js';
import { emailAddressSubmit } from './email-address.js';
import { governmentIdNfcSubmit } from './government-id-nfc.js';
import { governmentIdSubmit } from './government-id.js';
import { phoneNumberSubmit } from './phone-number.js';
import { selfieSubmit } from './selfie.js';

/** What `checkBody` reads: no lock is held. */
export interface SubmitBodyContext {
  verification: VerificationWithChecks;
  body: FlowSubmitVerificationBody | null;
  /** The type's step in the inquiry's pinned flow, if any. */
  step: FlowStep | undefined;
}

/** What `inTransaction` reads, under the inquiry's and the verification's locks. */
export interface SubmitContext {
  deps: ApiDependencies;
  tx: Db;
  session: FlowSession;
  /** The inquiry, locked and re-checked open. */
  inquiry: Inquiry;
  /** The verification, locked, in one of the guard's `submittableStatuses`. */
  verification: VerificationWithChecks;
  step: FlowStep;
  body: FlowSubmitVerificationBody | null;
  /** The verification's files. */
  files: readonly StoredFile[];
  now: Date;
}

/** What a guard prepared for the move to `submitted`. */
export interface SubmitPreparation {
  /** The files `verification.submitted` names. */
  files: readonly StoredFile[];
  /** Events staged before `verification.submitted`, such as `selfie.submitted`. */
  staged: StagedEvent[];
}

/** One type's submit rules (C52.6). */
export interface SubmitGuard {
  /** The statuses a submit moves to `submitted`: `initiated`, and `confirmed` for phone and email. */
  readonly submittableStatuses: readonly VerificationStatus[];
  checkBody(ctx: SubmitBodyContext): void;
  inTransaction(ctx: SubmitContext): Promise<SubmitPreparation>;
  repeat(ctx: {
    deps: ApiDependencies;
    verification: VerificationWithChecks;
    body: FlowSubmitVerificationBody | null;
  }): Promise<void>;
}

export const SUBMIT_GUARDS: Readonly<Record<SupportedVerificationType, SubmitGuard>> =
  Object.freeze({
    government_id: governmentIdSubmit,
    selfie: selfieSubmit,
    document: documentSubmit,
    database: databaseSubmit,
    aamva: aamvaSubmit,
    phone_number: phoneNumberSubmit,
    email_address: emailAddressSubmit,
    government_id_nfc: governmentIdNfcSubmit,
    crypto_wallet: cryptoWalletSubmit,
    database_business: databaseBusinessSubmit,
    business_website: businessWebsiteSubmit,
  });

/** The submit guard of `type`. */
export function submitGuardFor(type: SupportedVerificationType): SubmitGuard {
  return SUBMIT_GUARDS[type];
}
