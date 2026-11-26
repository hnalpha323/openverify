/** C40.2: the prompts of a new capture (Workflow 4A Stage 3, api-flow). */
import { describe, expect, it } from 'vitest';
import { selfieCapturePrompts } from './selfie-captures.js';

describe('selfieCapturePrompts (C40.2)', () => {
  const active = { poses: ['center', 'left', 'right'], liveness: 'active' } as const;

  it('puts center first and the side poses in the order the draw gives', () => {
    expect(selfieCapturePrompts(active, () => 0)).toEqual(['center', 'right', 'left']);
    expect(selfieCapturePrompts(active, (max) => max - 1)).toEqual(['center', 'left', 'right']);
  });

  it('draws the side order from the CSPRNG by default: both orders occur', () => {
    const orders = new Set(
      Array.from({ length: 200 }, () => selfieCapturePrompts(active).join(',')),
    );

    expect(orders).toEqual(new Set(['center,left,right', 'center,right,left']));
  });

  it('keeps the step order with passive liveness, without drawing', () => {
    const draw = () => {
      throw new Error('passive liveness draws nothing');
    };

    expect(
      selfieCapturePrompts({ poses: ['center', 'right', 'left'], liveness: 'passive' }, draw),
    ).toEqual(['center', 'right', 'left']);
  });

  it('prompts center first even when a stored step lists it later or not at all', () => {
    expect(selfieCapturePrompts({ poses: ['left', 'center'], liveness: 'passive' })).toEqual([
      'center',
      'left',
    ]);
    expect(selfieCapturePrompts({ poses: ['right'], liveness: 'passive' })).toEqual([
      'center',
      'right',
    ]);
  });

  it('prompts the center alone for a centre-only step', () => {
    expect(selfieCapturePrompts({ poses: ['center'], liveness: 'passive' })).toEqual(['center']);
  });
});
