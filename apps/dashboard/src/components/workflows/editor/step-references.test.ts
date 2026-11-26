/**
 * C252.1 (Workflow 11B, ingestion-11b): the workflow editor renames `steps.<from>` to `steps.<to>`
 * in a decision template's values when a step's id is taken (`insertTemplate`). It did so with a
 * run-time `RegExp` built from the step id (`document-model.ts`, inventory 2.8); a scan does it
 * now, so no step id becomes a pattern. The cases hold the old expression's meaning:
 * `\bsteps\.<from>(?=[.\s}]|$)`, every match replaced.
 */
import { describe, expect, it } from 'vitest';
import { renameStepReferences } from './step-references';

describe('renameStepReferences (C252.1)', () => {
  it.each([
    ['steps.read_case', 'steps.read_case_2'],
    ['steps.read_case.output.object', 'steps.read_case_2.output.object'],
    ['{{ steps.read_case }}', '{{ steps.read_case_2 }}'],
    ['{{steps.read_case}}', '{{steps.read_case_2}}'],
    ['a steps.read_case\tb', 'a steps.read_case_2\tb'],
    ['steps.read_case.x and steps.read_case.y', 'steps.read_case_2.x and steps.read_case_2.y'],
    ['(steps.read_case.output)', '(steps.read_case_2.output)'],
  ])('renames %j', (text, renamed) => {
    expect(renameStepReferences(text, 'read_case', 'read_case_2')).toBe(renamed);
  });

  it.each([
    'steps.read_cases',
    'steps.read_case_x.output',
    'xsteps.read_case',
    '_steps.read_case.output',
    'steps.read_case)',
    'steps.read_case-2',
    'steps.read',
    'no reference at all',
    '',
  ])('leaves %j as it is', (text) => {
    expect(renameStepReferences(text, 'read_case', 'read_case_2')).toBe(text);
  });

  it('renames a later reference after one it leaves', () => {
    expect(renameStepReferences('steps.read_cases steps.read_case.x', 'read_case', 'r2')).toBe(
      'steps.read_cases steps.r2.x',
    );
  });

  it('treats the id as text, never as a pattern', () => {
    expect(renameStepReferences('steps.a.b steps.aXb.c', 'a.b', 'c')).toBe('steps.c steps.aXb.c');
    expect(renameStepReferences('steps.(a+)+$ x', '(a+)+$', 'safe')).toBe('steps.safe x');
  });

  it('takes the catastrophic id and a long value at once (C252.3)', () => {
    const text = `steps.${'a'.repeat(10_000)}!`;
    const before = process.cpuUsage();
    const renamed = renameStepReferences(text, '(a+)+$', 'safe');
    const used = process.cpuUsage(before);
    expect(renamed).toBe(text);
    expect((used.user + used.system) / 1000).toBeLessThan(50);
  });
});
