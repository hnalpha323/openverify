/**
 * C122.5, Stage 1b amendment 52: the API process binds neither Slack nor the code runner, so it says
 * what a step can reach from facts, and the catalogue and publish cannot disagree with the worker.
 */
import { describe, expect, it } from 'vitest';
import type { ProviderBindings } from '../ports.js';
import type { ApiDependencies } from '../services/context.js';
import type { WorkflowActing } from './acting.js';
import { boundAdaptersOf } from './adapters.js';
import { actionCatalogue } from './runs/catalogue.js';
import { engineOf } from './runs/service.js';
import { engineOfApi } from './triggers/start.js';

const deps = (more: object = {}) =>
  ({
    mailer: { configured: false },
    providers: { sandbox: {}, production: {} } as unknown as ProviderBindings,
    ...more,
  }) as unknown as ApiDependencies;

const facts = (slack: boolean, codeEnabled = true) => ({
  workflowAdapters: { slackBound: { sandbox: slack, production: false }, codeEnabled },
});

describe('boundAdaptersOf (C122.5)', () => {
  it('reads a sandbox’s mail as bound with no SMTP server: it goes to the sandbox list', () => {
    expect(boundAdaptersOf(deps(), 'sandbox').has('mailer')).toBe(true);
  });

  it('needs an SMTP server for mail in production', () => {
    expect(boundAdaptersOf(deps(), 'production').has('mailer')).toBe(false);
    const configured = deps({ mailer: { configured: true } });
    expect(boundAdaptersOf(configured, 'production').has('mailer')).toBe(true);
  });

  it('reads Slack per environment kind, from the facts', () => {
    expect(boundAdaptersOf(deps(facts(true)), 'sandbox').has('slack')).toBe(true);
    expect(boundAdaptersOf(deps(facts(true)), 'production').has('slack')).toBe(false);
    expect(boundAdaptersOf(deps(), 'sandbox').has('slack')).toBe(false);
  });

  it('reads the code runner as gone only when code is turned off', () => {
    expect(boundAdaptersOf(deps(), 'sandbox').has('code-runner')).toBe(true);
    expect(boundAdaptersOf(deps(facts(false, false)), 'sandbox').has('code-runner')).toBe(false);
  });

  it('reads SMS from the binding', () => {
    const bound = deps({
      providers: { sandbox: { sms: {} }, production: {} } as unknown as ProviderBindings,
    });
    expect(boundAdaptersOf(bound, 'sandbox').has('sms')).toBe(true);
    expect(boundAdaptersOf(bound, 'production').has('sms')).toBe(false);
  });

  it('always holds what needs no adapter', () => {
    expect(boundAdaptersOf(deps(), 'production').has('none')).toBe(true);
  });
});

describe('the API process’s engine (C117.9)', () => {
  const steps = { enqueueWorkflowStep: () => Promise.resolve() };
  const api = deps({ workflowSteps: steps, workflowInFlightCap: 7 });

  it('enqueues what a route starts, resumes or tests, past the 15 s sweep', () => {
    expect(engineOfApi(api)).toMatchObject({ steps, inFlightCap: 7 });
    expect(engineOf(api)).toMatchObject({ steps, inFlightCap: 7 });
  });
});

describe('the catalogue (C122.5)', () => {
  const acting = { environmentKind: 'production' } as WorkflowActing;
  const reasonOf = (facts: object, key: string) =>
    actionCatalogue(deps(facts), acting).data.find(({ attributes }) => attributes.key === key)
      ?.attributes.reason;

  it('says code is turned off, and that a provider is not configured, each by its name', () => {
    expect(reasonOf(facts(false, false), 'evaluate_code')).toBe('code_disabled');
    expect(reasonOf(facts(false), 'send_slack_message')).toBe('provider_not_configured');
    expect(reasonOf(facts(false), 'send_email')).toBe('provider_not_configured');
    expect(reasonOf(facts(false), 'tag_object')).toBeNull();
  });
});
