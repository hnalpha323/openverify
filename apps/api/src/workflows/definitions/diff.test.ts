/** C116.6: the diff, keyed by step id, with layout-only changes apart. Synthetic definitions. */
import { describe, expect, it } from 'vitest';
import { action, chain, INQUIRY } from '../publish/testing.js';
import { diffDefinitions } from './diff.js';

const tag = (id: string, value = 'checked') =>
  action(id, 'tag_object', { 'object-type': 'inquiry', 'object-id': INQUIRY, tag: value });

describe('diffDefinitions (C116.6)', () => {
  it('finds nothing between a definition and itself', () => {
    const definition = chain([tag('one')]);
    expect(diffDefinitions(definition, definition)).toEqual({
      steps: { added: [], removed: [], changed: [] },
      edges: { added: [], removed: [] },
      'trigger-changes': [],
      'input-changes': [],
      'output-changes': [],
      'variable-changes': [],
      'layout-changes': [],
    });
  });

  it('keys steps by id: added, removed, and changed by pointer with both values', () => {
    const before = chain([tag('one'), tag('two')]);
    const after = chain([tag('one', 'renamed'), tag('three')]);
    const diff = diffDefinitions(after, before);
    expect(diff.steps.added).toEqual(['three']);
    expect(diff.steps.removed).toEqual(['two']);
    expect(diff.steps.changed).toEqual([
      {
        id: 'one',
        changes: [{ pointer: '/config/tag', before: 'checked', after: 'renamed' }],
      },
    ]);
  });

  it('lists an edge by id, in both lists when its ends moved', () => {
    const before = chain([tag('one')]);
    const after = chain([tag('one'), tag('two')]);
    const diff = diffDefinitions(after, before);
    expect(diff.edges.added).toEqual(['e1', 'e2']);
    expect(diff.edges.removed).toEqual(['e1']);
  });

  it('keys inputs, outputs and variables by name, and reads the trigger by pointer', () => {
    const input = { name: 'reference', type: 'string', required: true };
    const variable = { name: 'risk', type: 'number', default: 0 };
    const before = chain([tag('one')], { inputs: [input], variables: [variable] });
    const after = chain([tag('one')], {
      trigger: { type: 'trigger-event', config: { events: ['inquiry.failed'] } },
      inputs: [{ ...input, required: false }],
      outputs: [{ name: 'decision', pii: false }],
    });
    const diff = diffDefinitions(after, before);
    expect(diff['trigger-changes']).toEqual([
      {
        pointer: '/trigger/config/events/0',
        before: 'inquiry.completed',
        after: 'inquiry.failed',
      },
    ]);
    expect(diff['input-changes']).toEqual([
      { pointer: '/inputs/reference/required', before: true, after: false },
    ]);
    expect(diff['variable-changes']).toEqual([
      { pointer: '/variables/risk', before: variable, after: null },
    ]);
    expect(diff['output-changes']).toEqual([
      { pointer: '/outputs/decision', before: null, after: { name: 'decision', pii: false } },
    ]);
  });

  it('lists a node that only moved apart, and escapes a pointer token', () => {
    const before = chain([tag('one')], { layout: { one: { x: 0, y: 0 } } });
    const after = chain([tag('one')], { layout: { one: { x: 10, y: 0 }, output: { x: 1, y: 1 } } });
    const diff = diffDefinitions(after, before);
    expect(diff['layout-changes']).toEqual(['one', 'output']);
    expect(diff.steps.changed).toEqual([]);
  });

  it('keeps a node that changed out of the layout list', () => {
    const before = chain([tag('one')], { layout: { one: { x: 0, y: 0 } } });
    const after = chain([tag('one', 'renamed')], { layout: { one: { x: 10, y: 0 } } });
    const diff = diffDefinitions(after, before);
    expect(diff['layout-changes']).toEqual([]);
    expect(diff.steps.changed.map(({ id }) => id)).toEqual(['one']);
  });

  it('reports a member that appeared or went inside a step', () => {
    const plain = action('one', 'approve_inquiry', { 'inquiry-id': INQUIRY });
    const noted = action('one', 'approve_inquiry', { 'inquiry-id': INQUIRY, comment: 'Noted.' });
    expect(diffDefinitions(chain([noted]), chain([plain])).steps.changed).toEqual([
      { id: 'one', changes: [{ pointer: '/config/comment', before: null, after: 'Noted.' }] },
    ]);
    expect(diffDefinitions(chain([plain]), chain([noted])).steps.changed).toEqual([
      { id: 'one', changes: [{ pointer: '/config/comment', before: 'Noted.', after: null }] },
    ]);
  });
});
