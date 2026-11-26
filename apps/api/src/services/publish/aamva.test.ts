/**
 * C50.4 (H28): in a production environment, an `aamva` step (form or silent) whose `aamva`
 * provider is unbound is published only with `accept-review-without-provider: true`; otherwise
 * 422 `provider_not_configured`, pointing at the step. A sandbox environment and a bound provider
 * pass.
 */
import type { VerificationConfig } from '@openverify/contracts';
import { defaultTemplateConfig } from '@openverify/core';
import type { Db } from '@openverify/db';
import type { Flow, FlowStep } from '@openverify/flow-spec';
import { describe, expect, it } from 'vitest';
import type { ProviderBindings } from '../../ports.js';
import { createSandboxAamvaProvider } from '../../providers/sandbox.js';
import type { ApiDependencies } from '../context.js';
import { aamvaPublish } from './aamva.js';

const flowWith = (...steps: FlowStep[]): Flow => ({
  metadata: { specVersion: 1, id: 'aamva-flow', version: 1, name: 'AAMVA' },
  steps: [
    { id: 'consent', type: 'consent', textKeys: ['consent.processing'], required: true },
    {
      id: 'government_id',
      type: 'government_id',
      sides: 'both',
      maxAttempts: 3,
      captureMethods: ['upload'],
    },
    ...steps,
    { id: 'completion', type: 'completion', messageKey: 'flow.completion' },
  ],
  transitions: [],
});

const config = (accept?: boolean): VerificationConfig => ({
  'government-id': defaultTemplateConfig('government_id'),
  aamva: {
    ...defaultTemplateConfig('aamva'),
    ...(accept === undefined ? {} : { 'accept-review-without-provider': accept }),
  },
});

const bindings = (aamva: boolean): ProviderBindings => ({
  sandbox: {},
  production: aamva ? { aamva: createSandboxAamvaProvider() } : {},
});

function problems(options: {
  kind: 'sandbox' | 'production';
  source?: 'form' | 'government_id';
  aamva?: boolean;
  accept?: boolean;
  flow?: Flow;
}) {
  return aamvaPublish.problems({
    deps: { providers: bindings(options.aamva ?? false) } as ApiDependencies,
    db: {} as Db,
    environment: { id: 'env_x', kind: options.kind },
    flow:
      options.flow ?? flowWith({ id: 'aamva', type: 'aamva', source: options.source ?? 'form' }),
    config: config(options.accept),
  });
}

describe('the AAMVA publish rule (C50.4, H28)', () => {
  it.each(['form', 'government_id'] as const)(
    'refuses a production %s step whose provider is unbound, pointing at the step',
    async (source) => {
      await expect(problems({ kind: 'production', source })).resolves.toEqual([
        {
          code: 'provider_not_configured',
          pointer: '/flow/steps/2',
          detail: expect.stringContaining('accept-review-without-provider') as string,
        },
      ]);
    },
  );

  it('accepts it with accept-review-without-provider, a bound provider, or in a sandbox', async () => {
    await expect(problems({ kind: 'production', accept: true })).resolves.toEqual([]);
    await expect(problems({ kind: 'production', aamva: true })).resolves.toEqual([]);
    await expect(problems({ kind: 'sandbox' })).resolves.toEqual([]);
  });

  it('has nothing to say about a flow without an AAMVA step', async () => {
    await expect(problems({ kind: 'production', flow: flowWith() })).resolves.toEqual([]);
  });
});
