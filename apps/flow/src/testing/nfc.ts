/**
 * C207.10 (Phase 10, Workflow 10C; `api-nfc`): the in-memory flow API's answers for the web flow's
 * `nfc` step, registered once at import (`fake-flow-registry.ts`), so the shared fake is never
 * edited. A test imports this file and reads what the screen sent from {@link nfcScript}.
 *
 * `reportClientUnable` records the report and answers as the server does (`canceled`), or rejects
 * with the error a test queued.
 */
import type { ClientUnableReason } from '@openverify/contracts';
import { vi } from 'vitest';
import type { FlowApiClient } from '../api/flow-api-client';
import type { FakeFlowApi } from './fake-flow-api';
import { registerFakeFlowExtension } from './fake-flow-registry';

export interface NfcScript {
  /** Every client-unable report, in order. */
  readonly reports: { readonly verificationId: string; readonly reason: ClientUnableReason }[];
  /** Errors the next reports reject with, once each. */
  readonly failures: unknown[];
}

const scripts = new WeakMap<FakeFlowApi, NfcScript>();

/** The script of `fake`'s nfc answers. */
export function nfcScript(fake: FakeFlowApi): NfcScript {
  let script = scripts.get(fake);
  if (script === undefined) {
    script = { reports: [], failures: [] };
    scripts.set(fake, script);
  }
  return script;
}

registerFakeFlowExtension('nfc', {
  client: (fake) => ({
    reportClientUnable: vi.fn<FlowApiClient['reportClientUnable']>((verificationId, reason) => {
      const script = nfcScript(fake);
      if (script.failures.length > 0) {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the error a test queued, as given
        return Promise.reject(script.failures.shift());
      }
      script.reports.push({ verificationId, reason });
      return Promise.resolve({ 'verification-id': verificationId, status: 'canceled' as const });
    }),
  }),
});
