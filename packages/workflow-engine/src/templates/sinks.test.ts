/** C115.2, C115.6, C125.3, F33: where each config member goes, as data 8B extends with rows. */
import { describe, expect, it } from 'vitest';
import {
  ACTION_SINKS,
  ACTION_SINK_ROWS,
  createActionSinkTable,
  parseConfigTemplates,
} from './sinks.js';

describe('the sink table (C115.2)', () => {
  it.each<[string, string, string, boolean, boolean]>([
    ['make_https_request', '/url', 'url', false, false],
    ['make_https_request', '/headers/3/value', 'header', false, true],
    ['make_https_request', '/body/a/b', 'json', false, true],
    ['make_https_request', '/signing/secret', 'header', false, true],
    ['send_email', '/html', 'email-html', false, false],
    ['send_email', '/text', 'text', false, false],
    ['send_sms', '/text', 'text', false, false],
    ['send_slack_message', '/text', 'slack-text', false, false],
    ['send_slack_message', '/webhook-secret', 'header', false, true],
    ['tag_object', '/tag', 'text', true, false],
    ['remove_tag', '/tag', 'text', true, false],
  ])('%s %s is %s', (key, pointer, sink, plain, secret) => {
    expect(ACTION_SINKS.sinkOf(key, pointer)).toMatchObject({ sink, plain, secret });
  });

  it('reads anything else as a JSON value, which takes PII and no secret', () => {
    expect(ACTION_SINKS.sinkOf('tag_object', '/object-id')).toEqual({
      sink: 'json',
      plain: false,
      secret: false,
      literal: false,
    });
    expect(ACTION_SINKS.sinkOf('no_such_action', '/a')).toMatchObject({ sink: 'json' });
  });

  it('holds a member that decides a gate as a literal (C122.1)', () => {
    expect(ACTION_SINKS.sinkOf('update_transaction_status', '/status').literal).toBe(true);
  });

  it('does not stretch a pattern past its tokens', () => {
    expect(ACTION_SINKS.sinkOf('make_https_request', '/headers/3').sink).toBe('json');
    expect(ACTION_SINKS.sinkOf('make_https_request', '/headers/3/name').sink).toBe('json');
  });

  it('takes Workflow 8B rows beside these', () => {
    const table = createActionSinkTable([
      ...ACTION_SINK_ROWS,
      { key: 'create_case', member: '/name', sink: 'text', plain: true },
    ]);
    expect(table.sinkOf('create_case', '/name')).toMatchObject({ sink: 'text', plain: true });
    expect(table.sinkOf('send_email', '/html')).toMatchObject({ sink: 'email-html' });
  });
});

describe('a config, member by member (C115.1)', () => {
  it('gives each reference its pointer from the config', () => {
    const { references, issues } = parseConfigTemplates({
      url: 'https://example.com/{{ trigger.id }}',
      headers: [{ name: 'x-a', value: '{{ vars.a }}' }],
    });
    expect(issues).toEqual([]);
    expect(references.map(({ path, pointer }) => [path.text, pointer])).toEqual([
      ['trigger.id', '/url'],
      ['vars.a', '/headers/0/value'],
    ]);
  });

  it('gives each member its parsed template', () => {
    const { members } = parseConfigTemplates({ text: 'a {{ trigger.id }}', tag: 'b' });
    expect([...members.keys()]).toEqual(['text', 'tag']);
  });

  it('gives each issue its pointer from the config', () => {
    const { issues } = parseConfigTemplates({ a: { b: '{{ nope' } });
    expect(issues).toMatchObject([{ pointer: '/a/b', code: 'template_invalid' }]);
  });

  it('never reads source as a template', () => {
    const { members, issues } = parseConfigTemplates({ source: '{{ nope' });
    expect(members.size).toBe(0);
    expect(issues).toEqual([]);
  });
});
