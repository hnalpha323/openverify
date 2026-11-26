/**
 * C52.1: the preconditions every flow route that acts on a verification runs first, and their
 * locked re-check in the transaction that writes.
 */
import { newId } from '@openverify/contracts';
import {
  createVerification,
  setVerificationStatus,
  redactInquiryRecords,
  transitionInquiryStatus,
} from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FlowSession } from '../auth/flow-session.js';
import {
  bearer,
  createInquiry,
  createTemplate,
  createTestApi,
  expectStatus,
  resumeInquiry,
  type TestApi,
} from '../test-support/harness.js';
import { phase5TemplateAttributes } from '../test-support/phase5-templates.js';
import {
  requireFlowVerification,
  requireFlowVerificationUnderLock,
} from './flow-preconditions.js';

let api: TestApi;
let templateId: string;

beforeAll(async () => {
  // C55.10: the template's phone step publishes only with an SMS sender bound.
  api = await createTestApi();
  templateId = await createTemplate(api, api.token, phase5TemplateAttributes());
});

afterAll(async () => {
  await api.close();
});

const CONSENT_BODY = {
  accepted: true,
  'text-keys': ['consent.biometric', 'consent.processing', 'notice.session-integrity'],
  locale: 'en',
};

/** A started inquiry with a phone verification, its session and, unless told, consent. */
async function target(options: { consent?: boolean } = {}) {
  const inquiryId = await createInquiry(api, { templateId });
  const token = await resumeInquiry(api, inquiryId);
  expectStatus(
    await api.app.inject({ url: '/api/v1/flow/session', headers: bearer(token) }),
    200,
  );
  if (options.consent !== false) {
    expectStatus(
      await api.app.inject({
        method: 'POST',
        url: '/api/v1/flow/consent',
        headers: bearer(token),
        payload: CONSENT_BODY,
      }),
      201,
    );
  }
  const verification = await createVerification(api.database.db, api.environmentId, {
    id: newId('ver'),
    inquiryId,
    type: 'phone_number',
  });
  const session: FlowSession = { id: newId('iqse'), environmentId: api.environmentId, inquiryId };
  return { inquiryId, verificationId: verification.id, session };
}

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error('expected a refusal');
    },
    (error: unknown) => error as { status: number; name: string },
  );

describe('requireFlowVerification (C52.1)', () => {
  it('returns the open inquiry and the verification when every condition holds', async () => {
    const { inquiryId, verificationId, session } = await target();

    const found = await requireFlowVerification(api.deps, session, verificationId, {
      types: ['phone_number', 'email_address'],
    });

    expect(found.inquiry).toMatchObject({ id: inquiryId, status: 'pending' });
    expect(found.verification).toMatchObject({ id: verificationId, status: 'initiated' });
  });

  it('answers 404 for a verification of another inquiry or environment', async () => {
    const { session } = await target();
    const other = await target();

    await expect(
      failure(requireFlowVerification(api.deps, session, other.verificationId)),
    ).resolves.toMatchObject({ status: 404 });
    await expect(
      failure(requireFlowVerification(api.deps, session, newId('ver'))),
    ).resolves.toMatchObject({ status: 404 });
  });

  it('answers 410 once the inquiry was redacted and 409 once it is finished', async () => {
    const redacted = await target();
    await redactInquiryRecords(api.database.db, api.environmentId, redacted.inquiryId);
    const finished = await target();
    await transitionInquiryStatus(api.database.db, api.environmentId, finished.inquiryId, {
      from: 'pending',
      to: 'completed',
    });

    await expect(
      failure(requireFlowVerification(api.deps, redacted.session, redacted.verificationId)),
    ).resolves.toMatchObject({ status: 410 });
    await expect(
      failure(requireFlowVerification(api.deps, finished.session, finished.verificationId)),
    ).resolves.toMatchObject({ status: 409 });
  });

  it('answers 422 for a route of another type', async () => {
    const { verificationId, session } = await target();

    await expect(
      failure(
        requireFlowVerification(api.deps, session, verificationId, { types: ['crypto_wallet'] }),
      ),
    ).resolves.toMatchObject({ status: 422 });
  });

  it('answers 409 outside the statuses the route acts on, initiated by default', async () => {
    const { verificationId, session } = await target();
    await setVerificationStatus(api.database.db, api.environmentId, verificationId, {
      to: 'confirmed',
    });

    await expect(
      failure(requireFlowVerification(api.deps, session, verificationId)),
    ).resolves.toMatchObject({ status: 409 });
    await expect(
      requireFlowVerification(api.deps, session, verificationId, {
        statuses: ['initiated', 'confirmed'],
      }),
    ).resolves.toMatchObject({ verification: { status: 'confirmed' } });
  });

  it('answers 409 without consent, unless the route needs none', async () => {
    const { verificationId, session } = await target({ consent: false });

    await expect(
      failure(requireFlowVerification(api.deps, session, verificationId)),
    ).resolves.toMatchObject({ status: 409 });
    await expect(
      requireFlowVerification(api.deps, session, verificationId, { consent: false }),
    ).resolves.toMatchObject({ verification: { id: verificationId } });
  });
});

describe('requireFlowVerificationUnderLock (C52.1, C40.6)', () => {
  it('locks and re-checks the inquiry, then the verification, in the writing transaction', async () => {
    const { verificationId, session } = await target();

    const locked = await api.database.db.transaction((tx) =>
      requireFlowVerificationUnderLock(tx, session, verificationId),
    );

    expect(locked.verification).toMatchObject({ id: verificationId, status: 'initiated' });
  });

  it('answers 409 when the verification moved on, or the inquiry closed, meanwhile', async () => {
    const moved = await target();
    await setVerificationStatus(api.database.db, api.environmentId, moved.verificationId, {
      to: 'submitted',
    });
    const closed = await target();
    await transitionInquiryStatus(api.database.db, api.environmentId, closed.inquiryId, {
      from: 'pending',
      to: 'expired',
    });

    await expect(
      failure(
        api.database.db.transaction((tx) =>
          requireFlowVerificationUnderLock(tx, moved.session, moved.verificationId),
        ),
      ),
    ).resolves.toMatchObject({ status: 409 });
    await expect(
      failure(
        api.database.db.transaction((tx) =>
          requireFlowVerificationUnderLock(tx, closed.session, closed.verificationId),
        ),
      ),
    ).resolves.toMatchObject({ status: 409 });
  });
});
