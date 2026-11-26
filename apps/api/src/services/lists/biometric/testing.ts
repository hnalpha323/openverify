/**
 * Test support for the face and background lists: a consenting inquiry with a selfie whose centre
 * file is in storage. The image is random bytes behind a JPEG signature: no face reaches these tests,
 * and every embedding and layout comes from a seeded generator. Test-only.
 */
import { createHash } from 'node:crypto';
import { defaultInquiryTemplateAttributes, newId } from '@openverify/contracts';
import {
  createFile,
  createInquirySession,
  createVerification,
  encryptBytes,
  recordInquirySessionConsent,
  transitionInquiryStatus,
  updateEnvironmentSettings,
  verifications,
  type Db,
  type Keyring,
} from '@openverify/db';
import { createTestInquiry, createTestTenant } from '@openverify/db/testing';
import { eq } from 'drizzle-orm';
import { syntheticJpeg } from '../../../jobs/selfie-testing.js';
import type { FileStorage } from '../../../ports.js';
import { MATCHING_CONSENT_TEXT_KEY } from '../../inquiry-templates.js';

const defaults = defaultInquiryTemplateAttributes();

export const BASIS = 'A synthetic lawful basis, recorded for tests.';

/** A later consent each call, so the latest one counts. */
let consents = 0;

/** A flow session of the inquiry, with the optional keys it ticked, or none. */
export async function consentingSession(
  db: Db,
  environmentId: string,
  inquiryId: string,
  optionalTextKeys: readonly string[] = [MATCHING_CONSENT_TEXT_KEY],
  acceptedAt?: Date,
): Promise<string> {
  consents += 1;
  const session = await createInquirySession(db, environmentId, {
    id: newId('iqse'),
    inquiryId,
    tokenHash: createHash('sha256').update(newId('iqse')).digest('hex'),
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
  });
  await recordInquirySessionConsent(db, environmentId, session.id, {
    acceptedAt: acceptedAt ?? new Date(Date.UTC(2026, 9, 1) + consents * 1000),
    textKeys: ['consent.biometric', 'consent.processing'],
    optionalTextKeys: [...optionalTextKeys],
    locale: 'en',
    ip: null,
    userAgent: null,
  });
  return session.id;
}

export interface SelfieSource {
  environmentId: string;
  inquiryId: string;
  verificationId: string;
  sessionId: string | null;
  storageKey: string | null;
  center: Uint8Array;
}

export interface SelfieSourceOptions {
  environmentId?: string;
  /** The optional keys the session ticked; `null` for no session at all. */
  consent?: readonly string[] | null;
  /** The selfie's status; `passed` by default. */
  status?: 'passed' | 'failed' | 'needs_review' | 'requires_retry';
  /** Leaves the file out of storage, as a redaction would. */
  withoutFile?: boolean;
  fromRejectedHandoff?: boolean;
}

/** A pending inquiry of the default template, its consent, and a decided selfie with its file. */
export async function seedSelfieSource(
  deps: { db: Db; keyring: Keyring; storage: FileStorage },
  options: SelfieSourceOptions = {},
): Promise<SelfieSource> {
  const { db, keyring, storage } = deps;
  const environmentId = options.environmentId ?? (await createTestTenant(db)).environment.id;
  const { inquiry } = await createTestInquiry(db, environmentId, {
    flow: defaults.flow,
    verificationConfig: defaults['verification-config'],
  });
  await transitionInquiryStatus(db, environmentId, inquiry.id, { from: 'created', to: 'pending' });
  const consent = options.consent === undefined ? [MATCHING_CONSENT_TEXT_KEY] : options.consent;
  const sessionId =
    consent === null ? null : await consentingSession(db, environmentId, inquiry.id, consent);
  const verificationId = newId('ver');
  await createVerification(db, environmentId, {
    id: verificationId,
    inquiryId: inquiry.id,
    type: 'selfie',
    ...(sessionId === null ? {} : { createdBySessionId: sessionId }),
  });
  await db
    .update(verifications)
    .set({
      status: options.status ?? 'passed',
      fromRejectedHandoff: options.fromRejectedHandoff === true,
    })
    .where(eq(verifications.id, verificationId));
  const id = newId('file');
  const center = syntheticJpeg();
  const sealed = encryptBytes(center, keyring, { context: id });
  const storageKey = `${environmentId}/${id}`;
  if (options.withoutFile !== true) {
    await storage.put(storageKey, sealed.ciphertext);
  }
  await createFile(db, environmentId, {
    id,
    verificationId,
    kind: 'selfie-center',
    storageKey,
    mimeType: 'image/jpeg',
    byteSize: center.length,
    sha256: createHash('sha256').update(center).digest('hex'),
    wrappedDek: sealed.wrappedDek,
  });
  return {
    environmentId,
    inquiryId: inquiry.id,
    verificationId,
    sessionId,
    storageKey,
    center,
  };
}

/** Records the environment's `biometric-lists-basis`. */
export const acknowledge = (db: Db, environmentId: string) =>
  updateEnvironmentSettings(db, environmentId, { 'biometric-lists-basis': BASIS });
