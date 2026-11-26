/** C112.2, C116.4: the ids a definition names, and a promote's rewrite of them. */
import { describe, expect, it } from 'vitest';
import { placeholderReferencesIn, referencesIn, replaceReferences } from './references.js';
import { action, chain, INQUIRY } from './testing.js';

const TEMPLATE = 'itmpl_01M5CK3190XEVBM5ZXA76E1JSN';
const LIST = 'lst_01M5CK3190XEVBM5ZXA76E1JSN';
const REPORT = 'rptp_01M5CK3190XEVBM5ZXA76E1JSN';
const MODULE = 'wfl_01M5CK3190XEVBM5ZXA76E1JSN';
const OTHER_LIST = 'lst_01M5CK3190XEVBM5ZXA76E1JSP';

const criteria = { in: [{ var: 'trigger.template.id' }, [TEMPLATE]] };

const definition = () =>
  chain(
    [
      action('report', 'run_report', { 'report-template-id': REPORT, 'inquiry-id': INQUIRY }),
      action('add', 'add_list_item', { 'list-id': LIST, item: { kind: 'string', value: INQUIRY } }),
      {
        id: 'checks',
        type: 'module',
        name: 'Checks',
        'module-workflow-id': MODULE,
        version: 'latest-published',
        inputs: {},
      },
    ],
    { trigger: { type: 'trigger-event', config: { events: ['inquiry.completed'], criteria } } },
  );

describe('referencesIn (C112.2)', () => {
  it('finds every object a definition names, conditions included, by pointer', () => {
    expect(referencesIn(definition())).toEqual(
      expect.arrayContaining([
        { pointer: '/trigger/config/criteria/in/1/0', id: TEMPLATE, kind: 'inquiry-template' },
        { pointer: '/steps/0/config/report-template-id', id: REPORT, kind: 'report-template' },
        { pointer: '/steps/1/config/list-id', id: LIST, kind: 'list' },
        { pointer: '/steps/2/module-workflow-id', id: MODULE, kind: 'workflow' },
      ]),
    );
    expect(referencesIn(definition())).toHaveLength(4);
  });

  it('leaves a template and a run object alone', () => {
    const references = referencesIn(
      chain([action('add', 'add_list_item', { 'list-id': '{{ vars.list }}', value: 'lst_' })]),
    );
    expect(references).toEqual([]);
  });

  it('never reads the layout', () => {
    expect(referencesIn(chain([], { layout: {} }))).toEqual([]);
  });
});

describe('placeholderReferencesIn (C140.5)', () => {
  it('names a reference member a recipe left to fill, and no template', () => {
    const steps = chain([
      action('report', 'run_report', {
        'report-template-id': 'change-me-report-template-id',
        'inquiry-id': INQUIRY,
      }),
      action('add', 'add_list_item', {
        'list-id': '{{ vars.list }}',
        item: { kind: 'string', value: INQUIRY },
      }),
      action('other', 'add_list_item', {
        'list-id': LIST,
        item: { kind: 'string', value: INQUIRY },
      }),
    ]);
    expect(placeholderReferencesIn(steps)).toEqual(['/steps/0/config/report-template-id']);
  });
});

describe('replaceReferences (C112.2)', () => {
  it('rewrites each id wherever it stands, and keeps the rest', () => {
    const rewritten = replaceReferences(definition(), new Map([[LIST, OTHER_LIST]]));
    expect(rewritten.steps[1]).toMatchObject({
      config: { 'list-id': OTHER_LIST, item: { kind: 'string', value: INQUIRY } },
    });
    expect(rewritten.trigger).toEqual(definition().trigger);
    expect(rewritten.layout).toEqual({});
  });
});
