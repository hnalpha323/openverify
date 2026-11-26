/**
 * C61.1: a search's closest result by name (C58.6), over every name a result holds; ties keep the
 * register's order.
 */
import { describe, expect, it } from 'vitest';
import { closestByName } from './candidates.js';

interface Result {
  id: string;
  names: string[];
}

const namesOf = (result: Result) => result.names;

describe('closestByName (C61.1)', () => {
  it('keeps the closest result, full before partial', () => {
    const results: Result[] = [
      { id: 'partial', names: ['Utopia Synthetic'] },
      { id: 'full', names: ['UTOPIA SYNTHETIC WIDGETS LIMITED'] },
      { id: 'none', names: ['Marrowstone Placeholder Holdings'] },
    ];

    expect(closestByName('Utopia Synthetic Widgets Ltd', results, namesOf)).toEqual({
      candidate: results[1],
      level: 'full',
    });
  });

  it('reads every name a result holds, previous and trading names included', () => {
    const results: Result[] = [
      { id: 'renamed', names: ['Quillfeather Trading Ltd', 'Utopia Synthetic Widgets Ltd'] },
    ];

    expect(closestByName('Utopia Synthetic Widgets Ltd', results, namesOf)).toMatchObject({
      candidate: { id: 'renamed' },
      level: 'full',
    });
  });

  it('keeps the register’s order on a tie, and says how close the best one is', () => {
    const results: Result[] = [
      { id: 'first', names: ['Marrowstone Placeholder Holdings'] },
      { id: 'second', names: ['Quillfeather Placeholder Trading'] },
    ];

    expect(closestByName('Utopia Synthetic Widgets Ltd', results, namesOf)).toEqual({
      candidate: results[0],
      level: 'none',
    });
  });

  it('answers null without a result', () => {
    expect(closestByName('Utopia Synthetic Widgets Ltd', [], namesOf)).toBeNull();
  });
});
