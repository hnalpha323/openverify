// @vitest-environment node
import { createClient } from '@openverify/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { API_URL, mockApi, type MockApi } from '../../testing/api-mock';
import { ActionInputError } from './action';
import { listWebhooks, replayMetaFromForm, webhookAttributesFromForm } from './webhooks';

const WEBHOOK = 'wbh_01J9ZK3M5Q7R8S9T0V1W2X3Y60';
const TEMPLATE = 'itmpl_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z';
const ACCOUNT_TYPE = 'acctp_01J9ZK3M5Q7R8S9T0V1W2X3Y65';
const EVENT = 'evt_01J9ZK3M5Q7R8S9T0V1W2X3Y61';
const OTHER_EVENT = 'evt_01J9ZK3M5Q7R8S9T0V1W2X3Y66';

function form(entries: readonly (readonly [string, string])[]): FormData {
  const data = new FormData();
  for (const [name, value] of entries) {
    data.append(name, value);
  }
  return data;
}

/** The problem of an `ActionInputError` thrown by `run`. */
function inputProblem(run: () => unknown) {
  try {
    run();
  } catch (error) {
    if (error instanceof ActionInputError) {
      return error.problem;
    }
    throw error;
  }
  throw new Error('Expected an ActionInputError');
}

let api: MockApi;

beforeEach(() => {
  api = mockApi();
});

afterEach(() => {
  api.restore();
});

describe('listWebhooks', () => {
  it('lists one page of webhooks after the cursor', async () => {
    api.reply(200, { data: [], links: { next: null } });
    const client = createClient({ apiKey: SESSION_TOKEN, baseUrl: API_URL, maxRetries: 0 });

    await listWebhooks(client, WEBHOOK);

    expect(api.last().path).toBe('/api/v1/webhooks');
    expect(Object.fromEntries(api.last().query)).toEqual({
      'page[size]': '25',
      'page[after]': WEBHOOK,
    });
  });
});

describe('webhookAttributesFromForm', () => {
  const complete = form([
    ['url', ' https://hooks.example.test/openverify '],
    ['enabled-events', 'inquiry.approved'],
    ['enabled-events', 'inquiry.declined'],
    ['api-version', '2026-10-01'],
    ['inquiry-template-ids', TEMPLATE],
    ['account-type-ids', ACCOUNT_TYPE],
    ['attribute-blocklist', 'fields, reference-id'],
    ['header-name', 'X-Team'],
    ['header-value', ' change-me-synthetic-value '],
    ['header-name', ''],
    ['header-value', ''],
    ['header-name', 'Authorization'],
    ['header-value', 'Bearer change-me-synthetic-token'],
  ]);

  it('reads every attribute a webhook takes', () => {
    expect(webhookAttributesFromForm(complete, { customHeaders: true })).toEqual({
      url: 'https://hooks.example.test/openverify',
      'enabled-events': ['inquiry.approved', 'inquiry.declined'],
      'api-version': '2026-10-01',
      filters: { 'inquiry-template-ids': [TEMPLATE], 'account-type-ids': [ACCOUNT_TYPE] },
      'attribute-blocklist': ['fields', 'reference-id'],
      'custom-headers': {
        'X-Team': 'change-me-synthetic-value',
        Authorization: 'Bearer change-me-synthetic-token',
      },
    });
  });

  it('leaves the custom headers out unless they are to be replaced', () => {
    expect(webhookAttributesFromForm(complete, { customHeaders: false })).not.toHaveProperty(
      'custom-headers',
    );
  });

  it('subscribes to every event when "all events" is among them', () => {
    const attributes = webhookAttributesFromForm(
      form([
        ['url', 'https://hooks.example.test'],
        ['enabled-events', '*'],
        ['enabled-events', 'inquiry.approved'],
      ]),
      { customHeaders: true },
    );

    expect(attributes).toEqual({
      url: 'https://hooks.example.test',
      'enabled-events': ['*'],
      filters: {},
      'attribute-blocklist': [],
      'custom-headers': {},
    });
  });

  it('refuses a header value without a name', () => {
    const problem = inputProblem(() =>
      webhookAttributesFromForm(
        form([
          ['header-name', ' '],
          ['header-value', 'change-me-synthetic-value'],
        ]),
        { customHeaders: true },
      ),
    );

    expect(problem.errors).toEqual([
      { pointer: '/data/attributes/custom-headers', detail: 'Give every header a name.' },
    ]);
  });

  it('refuses a header named twice', () => {
    const problem = inputProblem(() =>
      webhookAttributesFromForm(
        form([
          ['header-name', 'X-Team'],
          ['header-value', 'one'],
          ['header-name', 'x-team'],
          ['header-value', 'two'],
        ]),
        { customHeaders: true },
      ),
    );

    expect(problem.errors).toEqual([
      {
        pointer: '/data/attributes/custom-headers',
        detail: 'Each header name can be used once (x-team).',
      },
    ]);
  });
});

describe('replayMetaFromForm', () => {
  it('replays the events named by ID', () => {
    expect(
      replayMetaFromForm(
        form([
          ['replay-by', 'event-ids'],
          ['event-ids', `${EVENT}\n${OTHER_EVENT}`],
        ]),
      ),
    ).toEqual({ 'event-ids': [EVENT, OTHER_EVENT] });
  });

  it('refuses an empty or malformed list of IDs', () => {
    expect(
      inputProblem(() => replayMetaFromForm(form([['replay-by', 'event-ids']]))).errors,
    ).toEqual([{ pointer: '/meta/event-ids', detail: 'Enter at least one event ID.' }]);
    expect(
      inputProblem(() =>
        replayMetaFromForm(
          form([
            ['replay-by', 'event-ids'],
            ['event-ids', `${EVENT} evt_nope`],
          ]),
        ),
      ).errors,
    ).toEqual([{ pointer: '/meta/event-ids', detail: 'evt_nope is not an event ID.' }]);
  });

  it('refuses more than 100 IDs', () => {
    const ids = Array.from(
      { length: 101 },
      (_, index) => `evt_01J9ZK3M5Q7R8S9T0V1W2X${String(index).padStart(4, '0')}`,
    );

    expect(
      inputProblem(() =>
        replayMetaFromForm(
          form([
            ['replay-by', 'event-ids'],
            ['event-ids', ids.join(',')],
          ]),
        ),
      ).errors,
    ).toEqual([{ pointer: '/meta/event-ids', detail: 'Enter at most 100 event IDs.' }]);
  });

  it('replays a time range in UTC, optionally only the failed deliveries', () => {
    expect(
      replayMetaFromForm(
        form([
          ['replay-by', 'range'],
          ['created-at-start', '2026-10-20T10:00'],
          ['created-at-end', '2026-10-20T11:00'],
          ['only-failed', 'true'],
        ]),
      ),
    ).toEqual({
      'created-at-start': '2026-10-20T10:00:00.000Z',
      'created-at-end': '2026-10-20T11:00:00.000Z',
      status: 'failed',
    });
  });

  it('refuses a range without valid times, or one that ends before it starts', () => {
    expect(
      inputProblem(() =>
        replayMetaFromForm(
          form([
            ['replay-by', 'range'],
            ['created-at-end', 'later'],
          ]),
        ),
      ).errors,
    ).toEqual([
      { pointer: '/meta/created-at-start', detail: 'Enter a date and time.' },
      { pointer: '/meta/created-at-end', detail: 'Enter a date and time.' },
    ]);
    expect(
      inputProblem(() =>
        replayMetaFromForm(
          form([
            ['replay-by', 'range'],
            ['created-at-start', '2026-10-20T11:00'],
            ['created-at-end', '2026-10-20T10:00'],
          ]),
        ),
      ).errors,
    ).toEqual([{ pointer: '/meta/created-at-end', detail: 'Choose an end after the start.' }]);
  });

  it('asks how to choose the events when the form does not say', () => {
    expect(inputProblem(() => replayMetaFromForm(form([]))).errors).toEqual([
      { pointer: '/replay-by', detail: 'Choose how to select the events.' },
    ]);
  });
});

describe('webhookAttributesFromForm: the Phase 8 filters (C143.4)', () => {
  it('reads the workflow, case template and list filters, separated by commas or spaces', () => {
    const attributes = webhookAttributesFromForm(
      form([
        ['url', 'https://hooks.example.test'],
        ['enabled-events', 'workflow-run.completed'],
        ['workflow-ids', 'wfl_01MB0000000000000000000001, wfl_01MB0000000000000000000002'],
        ['case-template-ids', 'ctmpl_01MB0000000000000000000001'],
        ['list-ids', 'lst_01MB0000000000000000000001'],
      ]),
      { customHeaders: false },
    );

    expect(attributes.filters).toEqual({
      'workflow-ids': ['wfl_01MB0000000000000000000001', 'wfl_01MB0000000000000000000002'],
      'case-template-ids': ['ctmpl_01MB0000000000000000000001'],
      'list-ids': ['lst_01MB0000000000000000000001'],
    });
  });
});

describe('webhookAttributesFromForm: name, description and failure alerts (C169.5, C169.6)', () => {
  const base: [string, string][] = [
    ['url', 'https://hooks.example.test/openverify'],
    ['enabled-events', 'inquiry.approved'],
  ];

  it('reads the name, the description and an enabled failure alert', () => {
    const attributes = webhookAttributesFromForm(
      form([
        ...base,
        ['name', ' Fulfilment '],
        ['description', ' Sends approvals to fulfilment. '],
        ['failure-alert-enabled', 'true'],
        ['failure-alert-threshold', '5'],
        ['failure-alert-window-minutes', '30'],
      ]),
      { customHeaders: false },
    );

    expect(attributes).toMatchObject({
      name: 'Fulfilment',
      description: 'Sends approvals to fulfilment.',
      'failure-alert': { enabled: true, threshold: 5, 'window-minutes': 30 },
    });
  });

  it('clears an emptied name or description, and sets no alert when its fields are empty', () => {
    const attributes = webhookAttributesFromForm(
      form([
        ...base,
        ['name', ' '],
        ['description', ''],
        ['failure-alert-threshold', ''],
        ['failure-alert-window-minutes', ''],
      ]),
      { customHeaders: false },
    );

    expect(attributes).toMatchObject({ name: null, description: null, 'failure-alert': null });
  });

  it('keeps an alert’s numbers switched off when the box is unticked', () => {
    expect(
      webhookAttributesFromForm(
        form([...base, ['failure-alert-threshold', '3'], ['failure-alert-window-minutes', '60']]),
        { customHeaders: false },
      ),
    ).toMatchObject({ 'failure-alert': { enabled: false, threshold: 3, 'window-minutes': 60 } });
  });

  it.each([
    [
      '0',
      '30',
      '/data/attributes/failure-alert/threshold',
      'Enter a whole number of failed first attempts from 1 to 10,000.',
    ],
    [
      '5',
      '4',
      '/data/attributes/failure-alert/window-minutes',
      'Enter a whole number of minutes from 5 to 1,440.',
    ],
    [
      '',
      '30',
      '/data/attributes/failure-alert/threshold',
      'Enter a whole number of failed first attempts from 1 to 10,000.',
    ],
  ])('refuses threshold %j and window %j at the field', (threshold, window, pointer, detail) => {
    let thrown: unknown;
    try {
      webhookAttributesFromForm(
        form([
          ...base,
          ['failure-alert-enabled', 'true'],
          ['failure-alert-threshold', threshold],
          ['failure-alert-window-minutes', window],
        ]),
        { customHeaders: false },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ActionInputError);
    expect((thrown as ActionInputError).problem.errors).toEqual([{ pointer, detail }]);
  });

  it('sends none of the three when the form does not show them', () => {
    const attributes = webhookAttributesFromForm(form(base), { customHeaders: false });

    expect(attributes).not.toHaveProperty('name');
    expect(attributes).not.toHaveProperty('description');
    expect(attributes).not.toHaveProperty('failure-alert');
  });
});
