import { PII_MASKED_ATTRIBUTES } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { triggerPathsOf } from './trigger-paths';

const MASKED = new Set(PII_MASKED_ATTRIBUTES);

describe('triggerPathsOf (C114.4, C115.3): the trigger view’s paths with their marks', () => {
  it('lists an inquiry event’s resource as the flattened view, with its id', () => {
    const paths = triggerPathsOf({
      type: 'trigger-event',
      config: { events: ['inquiry.completed'] },
    });
    const byPath = new Map(paths.map((path) => [path.path, path]));

    expect(byPath.get('trigger.id')).toMatchObject({ type: 'id', pii: false, nullable: false });
    expect(byPath.get('trigger.status')).toMatchObject({ type: 'enum', pii: false });
    expect(byPath.get('trigger.status')?.options).toContain('completed');
    expect(paths.every((path) => path.source === 'Trigger')).toBe(true);
  });

  it('marks every attribute the API masks as personal data', () => {
    const paths = triggerPathsOf({
      type: 'trigger-event',
      config: { events: ['inquiry.completed'] },
    });
    const masked = paths.filter((path) => MASKED.has(path.path.split('.')[1] ?? ''));

    expect(masked.length).toBeGreaterThan(0);
    expect(masked.every((path) => path.pii)).toBe(true);
  });

  it('reads the object type of a recurring or manual trigger', () => {
    const recurring = triggerPathsOf({
      type: 'trigger-recurring',
      config: { 'every-minutes': 60, 'time-zone': 'UTC', 'object-type': 'account' },
    }).map((path) => path.path);

    expect(recurring).toContain('trigger.id');
    expect(recurring).toContain('trigger.reference-id');
  });

  it('has no trigger view for the API trigger or no trigger: its inputs are the scope', () => {
    expect(triggerPathsOf({ type: 'trigger-api', config: {} })).toEqual([]);
    expect(triggerPathsOf(null)).toEqual([]);
    expect(
      triggerPathsOf({ type: 'trigger-event', config: { events: ['no.such-event'] } }),
    ).toEqual([]);
  });
});
