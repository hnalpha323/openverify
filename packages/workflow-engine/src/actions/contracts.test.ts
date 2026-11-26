/**
 * Every action's config and output contract (C122.2, C127): the schema is the action's own, strict,
 * and its output says of each member whether it is PII, because C120.6 masks by these marks.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { WORKFLOW_ACTION_CONTRACTS, type ActionContract } from './contracts.js';
import { actionOutputMarks, WORKFLOW_ACTION_KEYS, type WorkflowActionKey } from './registry.js';

const INQ = '{{ trigger.id }}';
const AT = '2026-10-20T12:00:20.000Z';
const REPORT = 'rep_01M5CK3190XEVBM5ZXA76E1JSN';
const LIST = 'lst_01M5CK3190XEVBM5ZXA76E1JSN';
const ITEM = 'lin_01M5CK3190XEVBM5ZXA76E1JSN';
const DECISION = 'idec_01M5CM00000000000000000020';
const ACCOUNT = 'acc_01M5CK3190XEVBM5ZXA76E1JSN';
const TXN = 'txn_01M5CK3190XEVBM5ZXA76E1JSN';
const BASIS = {
  'decision-basis': 'contract',
  'contest-route': { url: 'https://example.com/contest' },
};
const MESSAGE = { delivery: 'recorded', provider: 'sandbox', sandbox: true, 'message-ref': 'm_1' };
const DONE = { outcome: 'applied', 'inquiry-id': 'inq_01M5CJXHG07XPHF3HRM6NREDH7' };

/** One config and one output per action: what the rest of this file refuses a variation of. */
const EXAMPLES: Partial<Record<WorkflowActionKey, { config: object; output: object }>> = {
  approve_inquiry: {
    config: { 'inquiry-id': INQ, comment: 'A note' },
    output: { ...DONE, status: 'approved', 'decision-id': DECISION },
  },
  decline_inquiry: {
    config: { 'inquiry-id': INQ, ...BASIS },
    output: { ...DONE, status: 'declined', 'decision-id': DECISION, 'solely-automated': true },
  },
  mark_inquiry_for_review: {
    config: { 'inquiry-id': INQ },
    output: { ...DONE, status: 'needs_review', 'decision-id': DECISION },
  },
  create_inquiry: {
    config: { 'inquiry-template-id': 'itmpl_01M5A0GTG0RSTVX9PHA0V7P3X6', 'account-id': '{{ a }}' },
    output: {
      'inquiry-id': 'inq_01M5CJXHG07XPHF3HRM6NREDH7',
      status: 'created',
      'account-id': ACCOUNT,
    },
  },
  send_inquiry_link_email: {
    config: { 'inquiry-id': INQ },
    output: { 'one-time-link-id': 'otl_1', 'expires-at': AT, ...MESSAGE },
  },
  send_inquiry_link_sms: {
    config: { 'inquiry-id': INQ, 'expires-in-seconds': 3600 },
    output: { 'one-time-link-id': 'otl_1', 'expires-at': AT, ...MESSAGE },
  },
  run_report: {
    config: { 'report-template-id': 'rptp_1', 'inquiry-id': INQ },
    output: {
      'report-id': REPORT,
      'report-type': 'watchlist',
      'review-model': 'matches',
      status: 'ready',
      'has-match': true,
      'match-count': 1,
      coverage: { complete: true, limits: [] },
      'unavailable-fields': [],
      errors: [],
      matches: [
        {
          id: 'rpm_1',
          method: 'exact',
          tier: 'R',
          stage: 'ga',
          confidence: null,
          approximate: false,
        },
      ],
      flagged: null,
    },
  },
  rerun_report: {
    config: { selector: { 'list-id': LIST } },
    output: {
      reports: [{ 'report-id': REPORT, status: 'ready', 'has-match': false }],
      count: 1,
      'any-match': false,
      errored: [],
    },
  },
  rescreen_account_reports: {
    config: { 'account-id': '{{ trigger.id }}', 'timeout-seconds': 3_600 },
    output: {
      reports: [{ 'report-id': REPORT, status: 'ready', 'has-match': false }],
      count: 1,
      'monitored-count': 2,
      'any-match': false,
      errored: [],
    },
  },
  run_verification: {
    config: { 'inquiry-id': INQ, type: 'database', inputs: {} },
    output: {
      'verification-id': 'ver_01M5CK3190XEVBM5ZXA76E1JSM',
      type: 'database',
      status: 'passed',
      checks: [{ name: 'database_lookup', status: 'passed', tier: 'A', stage: 'ga' }],
      provider: 'sandbox',
      sandbox: true,
    },
  },
  get_list_match: {
    config: { 'list-ids': [LIST], probe: { kind: 'string', value: '{{ trigger.fields.x }}' } },
    output: {
      matched: false,
      'null-reason': null,
      matches: [],
    },
  },
  add_list_item: {
    config: {
      'list-id': LIST,
      item: { kind: 'name', 'name-first': '{{ a }}', 'name-last': '{{ b }}' },
      ...BASIS,
    },
    output: { 'list-item-id': ITEM, outcome: 'applied', 'decision-id': DECISION },
  },
  add_face_list_item: {
    config: { 'list-id': LIST, 'inquiry-id': INQ, ...BASIS, 'biometric-basis': 'explicit-consent' },
    output: {
      'list-item-id': 'lifc_01M5CK3190XEVBM5ZXA76E1JSN',
      status: 'pending',
      outcome: 'applied',
      'decision-id': DECISION,
    },
  },
  run_graph_query: {
    config: { 'graph-query-template-id': 'grqt_1', 'account-id': '{{ a }}', mode: 'synchronous' },
    output: {
      'graph-query-id': 'grphq_1',
      status: 'completed',
      'account-count': 3,
      'node-limit-reached': false,
      'skipped-hub-values': 0,
      'index-complete': true,
      'kinds-not-indexed': [],
    },
  },
  sync_graph: {
    config: { 'account-id': '{{ a }}' },
    output: { synced: true, mode: 'non-embedding' },
  },
  find_or_create_account: {
    config: {
      'account-type-id': 'acctp_01M5CJXHZMQ72CZPQ5Y3XGC48W',
      identifier: { kind: 'reference-id', value: '{{ trigger.reference-id }}' },
    },
    output: { 'account-id': ACCOUNT, outcome: 'found' },
  },
  create_transaction: {
    config: { 'transaction-type-id': 'txntp_1', fields: { amount: '{{ a }}' } },
    output: { 'transaction-id': TXN, status: 'open', outcome: 'applied' },
  },
  update_transaction_status: {
    config: { 'transaction-id': '{{ t }}', status: 'declined', ...BASIS },
    output: {
      'transaction-id': TXN,
      status: 'declined',
      outcome: 'applied',
      'decision-id': DECISION,
    },
  },
  set_relation: {
    config: {
      'object-type': 'transaction',
      'object-id': '{{ t }}',
      'relation-key': 'buyer',
      'target-id': '{{ a }}',
    },
    output: { 'object-id': TXN, 'target-id': ACCOUNT, outcome: 'applied' },
  },
  unset_relation: {
    config: {
      'object-type': 'account',
      'object-id': '{{ a }}',
      'relation-key': 'parent',
      'target-id': '{{ b }}',
    },
    output: { 'object-id': ACCOUNT, 'target-id': ACCOUNT, outcome: 'no_change' },
  },
  trust_device: {
    config: { 'device-id': '{{ d }}', 'trust-reason': 'manual_review_passed' },
    output: {
      'device-id': 'dev_01M5CJZC30W7PFE0GD30HJWEC6',
      'trusted-at': AT,
      outcome: 'applied',
    },
  },
  tag_object: {
    config: { 'object-type': 'inquiry', 'object-id': INQ, tag: 'needs-check' },
    output: { 'object-id': ACCOUNT, outcome: 'applied', 'tag-count': 1 },
  },
  remove_tag: {
    config: { 'object-type': 'inquiry', 'object-id': INQ, tag: 'needs-check' },
    output: { 'object-id': ACCOUNT, outcome: 'no_change', 'tag-count': 0 },
  },
  copy_tags: {
    config: {
      'from-object-type': 'inquiry',
      'from-object-id': INQ,
      'object-type': 'account',
      'object-id': '{{ a }}',
    },
    output: { 'object-id': ACCOUNT, outcome: 'applied', 'tag-count': 2 },
  },
  fetch_object: {
    config: { 'object-type': 'report', 'object-id': '{{ r }}' },
    output: { 'object-type': 'report', 'object-id': REPORT, object: { status: 'ready' } },
  },
  update_object: {
    config: {
      'object-type': 'account',
      'object-id': '{{ a }}',
      field: 'status',
      operator: 'set',
      value: 'active',
    },
    output: { 'object-id': ACCOUNT, outcome: 'applied', 'decision-id': null },
  },
  redact_object: {
    config: { 'object-type': 'inquiry', 'object-id': INQ },
    output: { 'object-id': 'inq_01M5CJXHG07XPHF3HRM6NREDH7', outcome: 'applied' },
  },
  calculate: {
    config: { operator: 'sum', operands: ['{{ a }}', 2], default: 0 },
    output: { value: 3, defaulted: false, 'default-reason': null },
  },
  update_variable: {
    config: { name: 'risk', operator: 'set', value: 1 },
    output: { name: 'risk', operator: 'set', held: true },
  },
  run_workflow: {
    config: {
      'workflow-id': 'wfl_01M5CM00000000000000000001',
      version: 'latest-published',
      inputs: { a: '{{ a }}' },
      'wait-for-completion': true,
    },
    output: {
      'workflow-run-id': 'wfr_01M5CM00000000000000000006',
      status: 'completed',
      outputs: { a: 1 },
    },
  },
  schedule_workflow: {
    config: {
      'workflow-id': 'wfl_01M5CM00000000000000000001',
      'subject-id': '{{ a }}',
      'base-time': 'run-time',
      offset: 3,
      units: 'days',
      direction: 'after',
    },
    output: { 'scheduled-run-id': 'srrun_1', 'run-at': AT },
  },
};

const contractOf = (key: string): ActionContract => {
  const contract = (WORKFLOW_ACTION_CONTRACTS as Readonly<Record<string, ActionContract>>)[key];
  if (contract === undefined) {
    throw new Error(`no contract for ${key}`);
  }
  return contract;
};
const NON_EGRESS = Object.keys(EXAMPLES) as WorkflowActionKey[];
const config = (key: WorkflowActionKey, value: object) => contractOf(key).config.safeParse(value);
const output = (key: WorkflowActionKey, value: object) => contractOf(key).output.safeParse(value);
const example = (key: WorkflowActionKey) => EXAMPLES[key] as { config: object; output: object };

describe('every action has a contract (C122.2)', () => {
  it('holds every key the catalogue names, the egress steps in their own test', () => {
    const egress = ['make_https_request', 'send_email', 'send_sms', 'send_slack_message'];
    expect([...NON_EGRESS, 'evaluate_code', ...egress].sort()).toEqual(
      [...WORKFLOW_ACTION_KEYS].sort(),
    );
    expect(Object.keys(WORKFLOW_ACTION_CONTRACTS).length).toBe(WORKFLOW_ACTION_KEYS.length);
  });

  describe.each([...NON_EGRESS])('%s', (key) => {
    it('reads its example', () => {
      expect(config(key, example(key).config).success).toBe(true);
      expect(output(key, example(key).output).success).toBe(true);
    });

    it('is strict: an unknown key in a config is refused', () => {
      expect(config(key, { ...example(key).config, 'not-a-member': true }).success).toBe(false);
    });

    it('marks every output member, so masking fails closed (C120.6)', () => {
      expect(() => actionOutputMarks(key, contractOf(key).output)).not.toThrow();
    });

    it('renders for the catalogue (C122.4)', () => {
      expect(() => z.toJSONSchema(contractOf(key).config, { io: 'input' })).not.toThrow();
      expect(() => z.toJSONSchema(contractOf(key).output, { io: 'output' })).not.toThrow();
    });
  });
});

describe('inquiry decisions (C127.1, C128)', () => {
  it('takes a basis, a contest route and a biometric basis on a decline', () => {
    const declined = { 'inquiry-id': INQ, ...BASIS, 'biometric-basis': 'explicit-consent' };
    expect(config('decline_inquiry', declined).success).toBe(true);
    expect(
      config('decline_inquiry', { 'inquiry-id': INQ, 'decision-basis': 'because' }).success,
    ).toBe(false);
  });

  it('holds no bases on an approve: only an adverse step declares one', () => {
    expect(config('approve_inquiry', { 'inquiry-id': INQ, ...BASIS }).success).toBe(false);
  });

  it('refuses a case template alone as a contest route (C128.3)', () => {
    const route = { 'case-template-id': 'ctmpl_01M5CK3190XEVBM5ZXA76E1JSN' };
    expect(config('decline_inquiry', { 'inquiry-id': INQ, 'contest-route': route }).success).toBe(
      false,
    );
  });

  it('says what happened, as codes, never by reading the status alone (H24)', () => {
    const base = example('approve_inquiry').output;
    for (const outcome of ['applied', 'no_change', 'already_decided']) {
      const decisionId = outcome === 'applied' ? DECISION : null;
      expect(
        output('approve_inquiry', { ...base, outcome, 'decision-id': decisionId }).success,
      ).toBe(true);
    }
    expect(output('approve_inquiry', { ...base, outcome: 'sent' }).success).toBe(false);
  });

  it('records no decision on a no_change (C127.1)', () => {
    const base = example('decline_inquiry').output;
    expect(
      output('decline_inquiry', { ...base, outcome: 'no_change', 'decision-id': null }).success,
    ).toBe(true);
    expect(output('decline_inquiry', { ...base, outcome: 'no_change' }).success).toBe(false);
  });

  it('marks the comment of a config nowhere in the output (C127.1)', () => {
    const marks = actionOutputMarks('approve_inquiry', contractOf('approve_inquiry').output);
    expect(Object.keys(marks)).not.toContain('comment');
    expect(marks).toMatchObject({ status: false, outcome: false, 'decision-id': false });
  });
});

describe('Run Report (C127.2)', () => {
  const report = () => example('run_report').output;

  it('caps the wait at a day and never continues on a timeout', () => {
    const base = example('run_report').config;
    expect(config('run_report', { ...base, 'timeout-seconds': 86_400 }).success).toBe(true);
    expect(config('run_report', { ...base, 'timeout-seconds': 86_401 }).success).toBe(false);
    expect(config('run_report', { ...base, 'on-timeout': 'continue' }).success).toBe(false);
  });

  it('runs against an inquiry or an account, exactly one', () => {
    const template = { 'report-template-id': 'rptp_1' };
    expect(config('run_report', { ...template, 'account-id': '{{ a }}' }).success).toBe(true);
    expect(config('run_report', template).success).toBe(false);
    expect(
      config('run_report', { ...template, 'account-id': '{{ a }}', 'inquiry-id': INQ }).success,
    ).toBe(false);
  });

  it.each(['pending', 'submitted', 'errored'])(
    'never reads a result on a report that is %s (H03)',
    (status) => {
      const answer = { ...report(), status, 'has-match': false, 'match-count': 0 };
      expect(output('run_report', answer).success).toBe(false);
      const unknown = { ...report(), status, 'has-match': null, 'match-count': null };
      expect(output('run_report', unknown).success).toBe(true);
    },
  );

  it('holds a pending report flag at null as well (outcome 15)', () => {
    const pending = { ...report(), status: 'pending', 'has-match': null, 'match-count': null };
    expect(output('run_report', { ...pending, flagged: false }).success).toBe(false);
  });

  it('carries a match with its tier and stage (H10)', () => {
    const [match] = (report() as { matches: object[] }).matches;
    const untiered = { ...match, tier: undefined };
    expect(output('run_report', { ...report(), matches: [untiered] }).success).toBe(false);
  });

  it('takes a selector of a list or an account, and answers any-match null unless all are ready', () => {
    expect(config('rerun_report', { selector: { 'account-id': '{{ a }}' } }).success).toBe(true);
    expect(config('rerun_report', { selector: {} }).success).toBe(false);
    const answer = {
      reports: [{ 'report-id': REPORT, status: 'errored', 'has-match': null }],
      count: 1,
      errored: [REPORT],
    };
    expect(output('rerun_report', { ...answer, 'any-match': null }).success).toBe(true);
    expect(output('rerun_report', { ...answer, 'any-match': false }).success).toBe(false);
  });
});

describe('Run Verification (C127.3)', () => {
  it('runs only a type that needs no capture', () => {
    const base = example('run_verification').config;
    for (const type of ['database', 'aamva', 'database_business', 'business_website']) {
      expect(config('run_verification', { ...base, type }).success).toBe(true);
    }
    expect(config('run_verification', { ...base, type: 'government_id' }).success).toBe(false);
    expect(config('run_verification', { ...base, type: 'selfie' }).success).toBe(false);
  });

  it('has no derived pass flag', () => {
    const marks = actionOutputMarks('run_verification', contractOf('run_verification').output);
    expect(Object.keys(marks)).not.toContain('passed');
  });

  it('caps the wait', () => {
    const base = example('run_verification').config;
    expect(config('run_verification', { ...base, 'timeout-seconds': 86_401 }).success).toBe(false);
  });
});

describe('Get List Match (C127.4, ADR 0007)', () => {
  const answer = (matched: boolean | null, nullReason: string | null) => ({
    matched,
    'null-reason': nullReason,
    matches: [],
  });

  it('answers null with its reason when a list could not be read: never false', () => {
    expect(output('get_list_match', answer(null, 'list_items_pending')).success).toBe(true);
    expect(output('get_list_match', answer(null, null)).success).toBe(false);
    expect(output('get_list_match', answer(false, 'list_items_pending')).success).toBe(false);
    expect(output('get_list_match', answer(null, 'made_up')).success).toBe(false);
  });

  it('errors by default and can ask for the null instead', () => {
    const base = example('get_list_match').config;
    expect(config('get_list_match', { ...base, 'on-unscreened': 'error' }).success).toBe(true);
    expect(config('get_list_match', { ...base, 'on-unscreened': 'null' }).success).toBe(true);
    expect(config('get_list_match', { ...base, 'on-unscreened': 'false' }).success).toBe(false);
  });

  it('carries a match with its method, tier, stage, confidence and whether it is approximate', () => {
    const match = {
      'list-item-id': ITEM,
      method: 'exact',
      tier: 'R',
      stage: 'ga',
      confidence: null,
      approximate: false,
    };
    expect(output('get_list_match', { ...answer(true, null), matches: [match] }).success).toBe(
      true,
    );
    const unstaged = { ...match, stage: undefined };
    expect(output('get_list_match', { ...answer(true, null), matches: [unstaged] }).success).toBe(
      false,
    );
  });

  it('refuses a face or background probe: those lists are read through the report', () => {
    const base = example('get_list_match').config;
    expect(config('get_list_match', { ...base, probe: { kind: 'face', value: 'x' } }).success).toBe(
      false,
    );
  });
});

describe('list additions (C127.4)', () => {
  it('reads a face from one inquiry and takes a biometric basis', () => {
    const marks = actionOutputMarks('add_face_list_item', contractOf('add_face_list_item').output);
    expect(marks['list-item-id']).toBe(false);
  });

  it('adds no face through the generic step', () => {
    const base = example('add_list_item').config;
    const face = { ...base, item: { kind: 'face', 'inquiry-id': INQ } };
    expect(config('add_list_item', face).success).toBe(false);
  });
});

describe('Run Graph Query and Sync Graph (C127.5)', () => {
  it('never serves the public -1, and holds the count until the query completed', () => {
    const base = example('run_graph_query').output;
    expect(output('run_graph_query', { ...base, 'account-count': -1 }).success).toBe(false);
    const submitted = {
      'graph-query-id': 'grphq_1',
      status: 'submitted',
      'account-count': null,
    };
    expect(output('run_graph_query', submitted).success).toBe(true);
    expect(output('run_graph_query', { ...submitted, 'account-count': 0 }).success).toBe(false);
  });

  it('answers synced true only with its mode, false with what is pending', () => {
    expect(
      output('sync_graph', { synced: false, 'pending-jobs': 2, 'kinds-not-indexed': ['email'] })
        .success,
    ).toBe(true);
    expect(output('sync_graph', { synced: false, mode: 'all' }).success).toBe(false);
    expect(output('sync_graph', { synced: true, 'pending-jobs': 0 }).success).toBe(false);
  });

  it('defaults on-pending to error, and names selective templates only in selective mode', () => {
    const base = { 'account-id': '{{ a }}' };
    const parsed = contractOf('sync_graph').config.parse(base);
    expect(parsed).toMatchObject({ 'on-pending': 'error', mode: 'non-embedding' });
    expect(config('sync_graph', { ...base, mode: 'selective' }).success).toBe(false);
    expect(
      config('sync_graph', {
        ...base,
        mode: 'selective',
        'graph-query-template-ids': ['grqt_1'],
      }).success,
    ).toBe(true);
  });
});

describe('Trust Device (C127.9)', () => {
  it('takes a reason code, or untrust', () => {
    expect(config('trust_device', { 'device-id': '{{ d }}', untrust: true }).success).toBe(true);
    expect(config('trust_device', { 'device-id': '{{ d }}' }).success).toBe(false);
    expect(
      config('trust_device', { 'device-id': '{{ d }}', 'trust-reason': 'Jane says so' }).success,
    ).toBe(false);
  });

  it('reads trusted-at null after untrust', () => {
    const base = example('trust_device').output;
    expect(output('trust_device', { ...base, 'trusted-at': null }).success).toBe(true);
  });
});

describe('the generic actions (C127.8)', () => {
  it('names its object type literally, so the grant is known at publish', () => {
    const untyped = { ...example('tag_object').config, 'object-type': undefined };
    expect(config('tag_object', untyped).success).toBe(false);
  });

  it('takes the public operators on an update', () => {
    const base = example('update_object').config;
    for (const operator of ['set', 'unset', 'append', 'push', 'remove']) {
      expect(config('update_object', { ...base, operator }).success).toBe(true);
    }
    expect(config('update_object', { ...base, operator: 'merge' }).success).toBe(false);
  });

  it('holds a fetched object PII whole, because it is untyped (C120.6)', () => {
    const marks = actionOutputMarks('fetch_object', contractOf('fetch_object').output);
    expect(marks).toMatchObject({ object: true, 'object-type': false, 'object-id': false });
  });

  it('takes bases on update_object, which can archive an account (C122.1)', () => {
    const base = example('update_object').config;
    expect(config('update_object', { ...base, ...BASIS }).success).toBe(true);
  });
});

describe('compute and control (C127.10)', () => {
  it('takes the public calculate operators, and reports a default', () => {
    for (const operator of ['add', 'subtract', 'multiply', 'divide', 'sum', 'avg']) {
      expect(config('calculate', { ...example('calculate').config, operator }).success).toBe(true);
    }
    expect(
      output('calculate', { value: 0, defaulted: true, 'default-reason': 'divide_by_zero' })
        .success,
    ).toBe(true);
    expect(output('calculate', { value: 0, defaulted: true, 'default-reason': null }).success).toBe(
      false,
    );
  });

  it('holds a computed value PII, because its operands can be (C115.6)', () => {
    expect(actionOutputMarks('calculate', contractOf('calculate').output).value).toBe(true);
  });

  it('takes the four variable operators (C115.4)', () => {
    for (const operator of ['set', 'unset', 'push', 'remove']) {
      expect(
        config('update_variable', { ...example('update_variable').config, operator }).success,
      ).toBe(true);
    }
  });

  it('holds a child run outputs PII, and schedules by public units', () => {
    expect(actionOutputMarks('run_workflow', contractOf('run_workflow').output).outputs).toBe(true);
    const base = example('schedule_workflow').config;
    expect(config('schedule_workflow', { ...base, units: 'weeks' }).success).toBe(false);
  });
});

describe('the inquiry links (C126.8, P32, V23)', () => {
  it('holds no token, and no way to send to an unconfirmed address', () => {
    const base = example('send_inquiry_link_email').config;
    expect(config('send_inquiry_link_email', { ...base, 'allow-unconfirmed': true }).success).toBe(
      false,
    );
    expect(config('send_inquiry_link_sms', { ...base, 'allow-unconfirmed': true }).success).toBe(
      false,
    );
    const marks = actionOutputMarks(
      'send_inquiry_link_email',
      contractOf('send_inquiry_link_email').output,
    );
    expect(Object.keys(marks)).toEqual(
      expect.arrayContaining(['one-time-link-id', 'expires-at', 'delivery']),
    );
    expect(Object.keys(marks)).not.toContain('one-time-link');
  });
});
