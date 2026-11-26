/**
 * C116.4, C121.4, C125.3, C125.4, C127.1, C128.3, C128.4: the publish rules over a checked
 * definition. Each rule has a golden definition that breaks it. Every value is synthetic.
 */
import type { WorkflowDefinition } from '@openverify/contracts';
import { analyzeAdverseSteps, checkDefinition } from '@openverify/workflow-engine';
import { describe, expect, it } from 'vitest';
import { WORKFLOW_ACTIONS } from '../definitions/registry.js';
import {
  evaluatePublishRules,
  type PublishFacts,
  type PublishRuleReport,
  type SecretFacts,
} from './rules.js';
import { action, approve, chain, decline, INQUIRY } from './testing.js';

const LIST = 'lst_01M5CK3190XEVBM5ZXA76E1JSN';
const REPORT = 'rptp_01M5CK3190XEVBM5ZXA76E1JSN';
const BASIS = {
  'decision-basis': 'contract',
  'contest-route': { url: 'https://help.example.com/contest' },
};

const FACTS: PublishFacts = {
  environmentKind: 'production',
  flowHost: 'flow.example.com',
  linkHosts: ['help.example.com'],
  emailRecipients: ['alerts@example.com', 'example.org'],
  smsRecipients: ['+12025550100'],
  boundAdapters: new Set(['none', 'mailer', 'sms', 'slack', 'code-runner']),
  listPurposes: new Map(),
  transactionAdverseStatuses: new Set(['declined']),
  transactionTypesContest: false,
  accountTypesContest: false,
  secrets: new Map(),
  knownReferences: new Set([LIST, REPORT]),
  exposeSignals: true,
};

const SECRET: SecretFacts = {
  allowedHosts: ['api.example.com'],
  headers: ['authorization'],
  bodyPointers: ['/token'],
  hasValue: true,
};

function evaluate(
  definition: WorkflowDefinition,
  facts: Partial<PublishFacts> = {},
): PublishRuleReport {
  const check = checkDefinition(definition, {
    kind: 'workflow',
    mode: 'publish',
    registry: WORKFLOW_ACTIONS,
  });
  return evaluatePublishRules({
    definition,
    analyses: analyzeAdverseSteps(definition, { registry: WORKFLOW_ACTIONS }),
    egress: check.egress,
    registry: WORKFLOW_ACTIONS,
    facts: { ...FACTS, ...facts },
  });
}

const codes = (issues: readonly { code: string }[]) => issues.map(({ code }) => code);
const keys = (report: PublishRuleReport) => report.acknowledgements.map(({ key }) => key);

describe('adverse steps in production (C128.3)', () => {
  it('passes a decline with a basis and a route on a link host', () => {
    const report = evaluate(
      chain([decline('no', { ...BASIS, 'biometric-basis': 'explicit-consent' })]),
    );
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it("takes the flow's own host and a contact", () => {
    const onFlow = decline('no', {
      'decision-basis': 'law',
      'contest-route': { url: 'https://flow.example.com/help' },
      'biometric-basis': 'explicit-consent',
    });
    expect(evaluate(chain([onFlow])).errors).toEqual([]);
    const contact = decline('no', {
      'decision-basis': 'law',
      'contest-route': { contact: 'Write to the review desk.' },
      'biometric-basis': 'explicit-consent',
    });
    expect(evaluate(chain([contact])).errors).toEqual([]);
  });

  it('refuses a decline with no basis, and no route, at their pointers', () => {
    const report = evaluate(chain([decline('no', { 'biometric-basis': 'explicit-consent' })]));
    expect(report.errors).toEqual([
      expect.objectContaining({
        code: 'decision_basis_missing',
        pointer: '/steps/0/config/decision-basis',
      }),
      expect.objectContaining({
        code: 'contest_route_missing',
        pointer: '/steps/0/config/contest-route',
      }),
    ]);
  });

  it('warns in a sandbox instead, and never refuses', () => {
    const report = evaluate(chain([decline('no')]), { environmentKind: 'sandbox' });
    expect(report.errors).toEqual([]);
    expect(codes(report.warnings)).toEqual([
      'decision_basis_missing',
      'contest_route_missing',
      'biometric_basis_missing',
    ]);
  });

  it('refuses a route on a host nobody allowed', () => {
    const step = decline('no', {
      'decision-basis': 'contract',
      'contest-route': { url: 'https://elsewhere.example.net/contest' },
      'biometric-basis': 'explicit-consent',
    });
    expect(codes(evaluate(chain([step])).errors)).toEqual(['contest_route_host_refused']);
  });

  it('takes a route that names a case template beside its contact, now that cases land (C128.7)', () => {
    const step = decline('no', {
      'decision-basis': 'contract',
      'contest-route': {
        contact: 'Write to the review desk.',
        'case-template-id': 'ctmpl_01M5CK3190XEVBM5ZXA76E1JSN',
      },
      'biometric-basis': 'explicit-consent',
    });
    const held = { knownReferences: new Set(['ctmpl_01M5CK3190XEVBM5ZXA76E1JSN']) };
    expect(codes(evaluate(chain([step]), held).errors)).toEqual([]);
    expect(codes(evaluate(chain([step]), { ...held, environmentKind: 'sandbox' }).errors)).toEqual(
      [],
    );
    // The template is a reference: one this environment does not hold is refused.
    expect(codes(evaluate(chain([step])).errors)).toEqual(['reference_unknown']);
  });

  it('asks a biometric step for its basis (C128.4)', () => {
    const report = evaluate(chain([decline('no', BASIS)]));
    expect(report.errors).toEqual([
      expect.objectContaining({
        code: 'biometric_basis_missing',
        pointer: '/steps/0/config/biometric-basis',
      }),
    ]);
  });

  it('asks for heuristic:<step id> when the path reads an H-tier value (H10)', () => {
    const report = action('report', 'run_report', {
      'report-template-id': REPORT,
      'inquiry-id': INQUIRY,
    });
    const route = {
      id: 'route',
      type: 'conditional',
      name: 'route',
      routes: [
        {
          key: 'hit',
          label: 'Hit',
          condition: { '===': [{ var: 'steps.report.output.has-match' }, true] },
          'on-null': 'error',
        },
      ],
    };
    const definition = chain([report, route, decline('no', BASIS)]);
    definition.edges = [
      { id: 'e0', from: 'trigger', 'from-port': 'next', to: 'report' },
      { id: 'e1', from: 'report', 'from-port': 'next', to: 'route' },
      { id: 'e2', from: 'route', 'from-port': 'route:hit', to: 'no' },
      { id: 'e3', from: 'route', 'from-port': 'else', to: 'output' },
      { id: 'e4', from: 'no', 'from-port': 'next', to: 'output' },
    ];
    expect(keys(evaluate(definition))).toContain('heuristic:no');
    expect(keys(evaluate(definition, { environmentKind: 'sandbox' }))).toEqual([]);
  });
});

describe('by-config adverse steps (C122.1)', () => {
  const add = (config = {}) =>
    action('add', 'add_list_item', {
      'list-id': LIST,
      item: { kind: 'string', value: INQUIRY },
      ...config,
    });

  it('reads a list that blocks as adverse, and an unknown one too', () => {
    expect(codes(evaluate(chain([add()])).errors)).toContain('decision_basis_missing');
    expect(
      codes(evaluate(chain([add()]), { listPurposes: new Map([[LIST, 'block']]) }).errors),
    ).toContain('decision_basis_missing');
    expect(
      codes(
        evaluate(
          chain([add({ 'list-id': '{{ vars.list }}' })], {
            variables: [{ name: 'list', type: 'string', default: 'x' }],
          }),
        ).errors,
      ),
    ).toContain('decision_basis_missing');
  });

  it('leaves an allow or watch list alone', () => {
    for (const purpose of ['allow', 'watch'] as const) {
      const report = evaluate(chain([add()]), { listPurposes: new Map([[LIST, purpose]]) });
      expect(report.errors).toEqual([]);
    }
  });

  it("reads a transaction status by the types' adverse statuses", () => {
    const update = (status: string) =>
      action('move', 'update_transaction_status', { 'transaction-id': 'txn', status });
    expect(codes(evaluate(chain([update('declined')])).errors)).toContain('decision_basis_missing');
    expect(evaluate(chain([update('settled')])).errors).toEqual([]);
  });

  it('takes a contest route from a type when every type holds one', () => {
    const step = action('move', 'update_transaction_status', {
      'transaction-id': 'txn',
      status: 'declined',
      'decision-basis': 'contract',
      'biometric-basis': 'explicit-consent',
    });
    expect(codes(evaluate(chain([step])).errors)).toContain('contest_route_missing');
    expect(evaluate(chain([step]), { transactionTypesContest: true }).errors).toEqual([]);
  });

  it('reads archiving an account as adverse, and any other update as not', () => {
    const update = (config: object) =>
      action('archive', 'update_object', {
        'object-type': 'account',
        'object-id': 'acc',
        field: 'status',
        operator: 'set',
        value: 'archived',
        ...config,
      });
    expect(codes(evaluate(chain([update({})])).errors)).toContain('decision_basis_missing');
    expect(evaluate(chain([update({ field: 'fields.note', value: 'x' })])).errors).toEqual([]);
    expect(evaluate(chain([update({ value: 'active' })])).errors).toEqual([]);
    expect(
      evaluate(
        chain([update({ 'decision-basis': 'law', 'biometric-basis': 'explicit-consent' })]),
        {
          accountTypesContest: true,
        },
      ).errors,
    ).toEqual([]);
  });
});

describe('acknowledgements (C116.4)', () => {
  it('asks for irreversible:<step id> on a redaction', () => {
    const redact = action('wipe', 'redact_object', {
      'object-type': 'report',
      'object-id': 'x',
    });
    expect(keys(evaluate(chain([redact])))).toEqual(['irreversible:wipe']);
  });

  it('asks for egress:<step id> for a marked step', () => {
    const definition = chain([]);
    const report = evaluatePublishRules({
      definition,
      analyses: [],
      egress: [{ stepId: 'notify', paths: ['trigger.name-first'], destination: 'slack' }],
      registry: WORKFLOW_ACTIONS,
      facts: FACTS,
    });
    expect(report.acknowledgements).toEqual([{ key: 'egress:notify', pointer: '/egress/notify' }]);
  });

  it('asks for unconfirmed:<step id> on allow-unconfirmed', () => {
    const send = action('send', 'send_email', {
      recipient: '{{ trigger.email-address }}',
      subject: 'Hello',
      text: 'Hello',
      'allow-unconfirmed': true,
    });
    expect(keys(evaluate(chain([send])))).toContain('unconfirmed:send');
  });

  it('asks an approve reachable from inquiry.failed for override-failed (C127.1)', () => {
    const definition = chain([approve('yes')], {
      trigger: { type: 'trigger-event', config: { events: ['inquiry.failed'] } },
    });
    expect(keys(evaluate(definition))).toEqual(['override-failed:yes']);
  });

  it('warns on an approve from inquiry.completed with no report or list wait (C127.1)', () => {
    expect(codes(evaluate(chain([approve('yes')])).warnings)).toEqual(['approve_without_evidence']);
    const report = action('report', 'run_report', {
      'report-template-id': REPORT,
      'inquiry-id': INQUIRY,
    });
    expect(evaluate(chain([report, approve('yes')])).warnings).toEqual([]);
  });
});

describe('recipients and availability (C114.5, C122.5, C126)', () => {
  const email = (recipient: string) =>
    action('send', 'send_email', { recipient, subject: 'Hello', text: 'Hello' });
  const sms = (recipient: string) => action('send', 'send_sms', { recipient, text: 'Hello' });

  it('refuses a literal recipient outside the allowlists', () => {
    expect(codes(evaluate(chain([email('stranger@example.net')])).errors)).toEqual([
      'recipient_not_allowed',
    ]);
    expect(codes(evaluate(chain([sms('+12025550199')])).errors)).toEqual(['recipient_not_allowed']);
  });

  it('takes an address, a domain and a number on the lists, and any template', () => {
    expect(evaluate(chain([email('ALERTS@example.com')])).errors).toEqual([]);
    expect(evaluate(chain([email('team@example.org')])).errors).toEqual([]);
    expect(evaluate(chain([sms('+12025550100')])).errors).toEqual([]);
    expect(evaluate(chain([email('{{ trigger.email-address }}')])).errors).toEqual([]);
  });

  it('warns for an action whose adapter is unbound, and never refuses', () => {
    const report = evaluate(chain([email('alerts@example.com')]), {
      boundAdapters: new Set(['none']),
    });
    expect(report.errors).toEqual([]);
    expect(codes(report.warnings)).toEqual(['provider_not_configured']);
  });
});

describe('references (C116.4, C121.6)', () => {
  it('refuses an object this environment does not hold, and a placeholder', () => {
    const add = action('add', 'add_list_item', {
      'list-id': 'lst_01M5CK3190XEVBM5ZXA76E1JSP',
      item: { kind: 'string', value: INQUIRY },
      'decision-basis': 'law',
      'contest-route': { contact: 'Write in.' },
      'biometric-basis': 'explicit-consent',
    });
    expect(evaluate(chain([add])).errors).toEqual([
      expect.objectContaining({ code: 'reference_unknown', pointer: '/steps/0/config/list-id' }),
    ]);
    const placeholder = action('report', 'run_report', {
      'report-template-id': 'change-me-report-template-id',
      'inquiry-id': INQUIRY,
    });
    expect(evaluate(chain([placeholder])).errors).toEqual([
      expect.objectContaining({
        code: 'reference_unknown',
        pointer: '/steps/0/config/report-template-id',
      }),
    ]);
  });
});

describe('secrets (C125.3, C125.4)', () => {
  const request = (config: object = {}) =>
    action('call', 'make_https_request', {
      method: 'POST',
      url: 'https://api.example.com/v1/check',
      headers: [{ name: 'Authorization', value: 'Bearer {{secrets.partner_token}}' }],
      ...config,
    });

  it('passes a key with a value on its host and placement', () => {
    const report = evaluate(chain([request()]), {
      secrets: new Map([['partner_token', SECRET]]),
    });
    expect(report.errors).toEqual([]);
    expect(report.secretsUnknown).toEqual([]);
    expect(report.secretsWithoutValue).toEqual([]);
  });

  it('names a key that does not exist', () => {
    const report = evaluate(chain([request()]));
    expect(report.secretsUnknown).toEqual([
      expect.objectContaining({
        code: 'secret_reference_invalid',
        pointer: '/steps/0/config/headers/0/value',
      }),
    ]);
  });

  it('names a key with no value in this environment', () => {
    const report = evaluate(chain([request()]), {
      secrets: new Map([['partner_token', { ...SECRET, hasValue: false }]]),
    });
    expect(report.secretsWithoutValue).toEqual([
      expect.objectContaining({ code: 'secret_value_missing' }),
    ]);
  });

  it('refuses a host the secret does not allow, comparing the parsed host', () => {
    const elsewhere = request({ url: 'https://api.example.com.evil.example/v1' });
    expect(
      codes(evaluate(chain([elsewhere]), { secrets: new Map([['partner_token', SECRET]]) }).errors),
    ).toEqual(['secret_placement_refused']);
  });

  it('refuses a header or body pointer the secret does not allow, and a second use', () => {
    const secrets = new Map([['partner_token', SECRET]]);
    const header = request({
      headers: [{ name: 'X-Token', value: '{{secrets.partner_token}}' }],
    });
    expect(codes(evaluate(chain([header]), { secrets }).errors)).toEqual([
      'secret_placement_refused',
    ]);
    const body = request({ headers: [], body: { other: '{{secrets.partner_token}}' } });
    expect(codes(evaluate(chain([body]), { secrets }).errors)).toEqual([
      'secret_placement_refused',
    ]);
    const allowed = request({ headers: [], body: { token: '{{secrets.partner_token}}' } });
    expect(evaluate(chain([allowed]), { secrets }).errors).toEqual([]);
    const twice = request({ body: { token: '{{secrets.partner_token}}' } });
    expect(codes(evaluate(chain([twice]), { secrets }).errors)).toEqual([
      'secret_placement_refused',
    ]);
  });

  it('reads a signing secret and a Slack webhook against their hosts', () => {
    const signed = request({ headers: [], signing: { secret: '{{secrets.signing}}' } });
    expect(
      evaluate(chain([signed]), {
        secrets: new Map([['signing', { ...SECRET, headers: [] }]]),
      }).errors,
    ).toEqual([]);
    const slack = action('notify', 'send_slack_message', {
      'webhook-secret': '{{secrets.team_hook}}',
      text: 'A run finished.',
    });
    expect(
      codes(evaluate(chain([slack]), { secrets: new Map([['team_hook', SECRET]]) }).errors),
    ).toEqual(['secret_placement_refused']);
    expect(
      evaluate(chain([slack]), {
        secrets: new Map([['team_hook', { ...SECRET, allowedHosts: ['hooks.slack.com'] }]]),
      }).errors,
    ).toEqual([]);
  });
});

describe('signals (Stage 1a amendment 10)', () => {
  const reading = action('tag', 'tag_object', {
    'object-type': 'inquiry',
    'object-id': INQUIRY,
    tag: 'seen',
  });

  it('warns when a version reads a signal with expose-signals off', () => {
    const definition = chain([{ ...reading, config: { ...reading.config, tag: 'seen' } }]);
    definition.trigger = {
      type: 'trigger-event',
      config: {
        events: ['inquiry.completed'],
        criteria: { '===': [{ var: 'trigger.signals.is-tor' }, true] },
        'on-null': 'skip',
      },
    };
    expect(codes(evaluate(definition, { exposeSignals: false }).warnings)).toContain(
      'signal_not_exposed',
    );
    expect(codes(evaluate(definition).warnings)).not.toContain('signal_not_exposed');
  });
});
