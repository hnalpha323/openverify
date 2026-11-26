/**
 * C238.4, C237.6 (Phase 11, Workflow 11A; `clients-connect`): the in-memory flow API's answers for
 * the share-consent step, registered once at import (`testing/fake-flow-registry.ts`), so the shared
 * fake is never edited. A test imports this file, scripts the "server" through
 * {@link shareConsentScript} and reads what the screens sent from it.
 *
 * Each exit records its call and answers the session, as the server does: an accept or a decline
 * serves `next` (the position the server moves to), a withdrawal removes its entry from
 * `withdrawable` and stays where it was. Every value is synthetic.
 */
import {
  flowSessionResponseSchema,
  type FlowShareConsentAcceptBody,
  type FlowWithdrawableShareConsent,
} from '@openverify/contracts';
import type { ShareConsentClientView } from '@openverify/flow-spec';
import { createHash } from 'node:crypto';
import { vi } from 'vitest';
import type { FlowApiClient } from '../../api/flow-api-client';
import type { FakeFlowApi } from '../../testing/fake-flow-api';
import { registerFakeFlowExtension } from '../../testing/fake-flow-registry';
import { serve, type ServedPosition } from '../../testing/flow-renderer';

export interface ShareConsentExit {
  readonly stepId: string;
  readonly exit: 'accept' | 'decline' | 'withdraw';
  readonly body?: FlowShareConsentAcceptBody;
}

export interface ShareConsentScript {
  /** The session's `withdrawable-share-consents`; left out of the session while empty. */
  withdrawable: FlowWithdrawableShareConsent[];
  /** Where an accept or a decline moves the session; `null` keeps it where it is. */
  next: ServedPosition | null;
  /** Every exit called, in order. */
  readonly exits: ShareConsentExit[];
  /** Errors the next exits reject with, once each. */
  readonly failures: unknown[];
}

const scripts = new WeakMap<FakeFlowApi, ShareConsentScript>();

/** The script of `fake`'s share-consent answers. */
export function shareConsentScript(fake: FakeFlowApi): ShareConsentScript {
  let script = scripts.get(fake);
  if (script === undefined) {
    script = { withdrawable: [], next: null, exits: [], failures: [] };
    scripts.set(fake, script);
  }
  return script;
}

/** The SHA-256 of `text`'s NFC form, as the server digests a composed text (C238.3). */
export function digestOf(text: string): string {
  return createHash('sha256').update(text.normalize('NFC'), 'utf8').digest('hex');
}

/** A synthetic composed text in two paragraphs, as a server would serve it. */
export const SYNTHETIC_BODY =
  'Example Source asks for your agreement to share the details it verified about you with Example Partner.\n\nTo withdraw your agreement, email privacy@example.com.';
export const SYNTHETIC_BIOMETRIC =
  'I agree that Example Source shares my biometric data with Example Partner.';

/** A source-side client view whose digests are the texts' own. */
export function shareConsentView(
  overrides: Partial<ShareConsentClientView> = {},
): ShareConsentClientView {
  return {
    id: 'share_back',
    type: 'share_consent',
    side: 'source',
    recipientName: 'Example Partner',
    sourceName: 'Example Source',
    categories: ['identity-fields', 'biometric', 'check-results'],
    text: {
      locale: 'en',
      body: SYNTHETIC_BODY,
      sha256: digestOf(SYNTHETIC_BODY),
      keys: ['share.consent.source'],
    },
    biometric: { body: SYNTHETIC_BIOMETRIC, sha256: digestOf(SYNTHETIC_BIOMETRIC) },
    ...overrides,
  };
}

registerFakeFlowExtension('share-consent', {
  session: (session, fake) => {
    const { withdrawable } = shareConsentScript(fake);
    return withdrawable.length === 0
      ? session
      : flowSessionResponseSchema.parse({
          ...session,
          'withdrawable-share-consents': [...withdrawable],
        });
  },
  client: (fake) => {
    const exit = (call: ShareConsentExit) => {
      const script = shareConsentScript(fake);
      if (script.failures.length > 0) {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the error a test queued, as given
        return Promise.reject(script.failures.shift());
      }
      script.exits.push(call);
      if (call.exit === 'withdraw') {
        script.withdrawable = script.withdrawable.filter(
          (entry) => entry['step-id'] !== call.stepId,
        );
      } else if (script.next !== null) {
        serve(fake, script.next);
      }
      return fake.client.getSession();
    };
    return {
      acceptShareConsent: vi.fn<FlowApiClient['acceptShareConsent']>((stepId, body) =>
        exit({ stepId, exit: 'accept', body }),
      ),
      declineShareConsent: vi.fn<FlowApiClient['declineShareConsent']>((stepId) =>
        exit({ stepId, exit: 'decline' }),
      ),
      withdrawShareConsent: vi.fn<FlowApiClient['withdrawShareConsent']>((stepId) =>
        exit({ stepId, exit: 'withdraw' }),
      ),
    };
  },
});
