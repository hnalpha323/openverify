/**
 * Test support for the case services (Workflow 8B): a fake of `createCaseInTx`, so the routes and the
 * actions that share it (`POST /cases`, the review request, the graph bulk action, `create_case`) can
 * be tested before `api-cases` builds it. Not imported by production code.
 */
import type { CaseCreationInput, CreatedCase, CreateCaseInTx } from './create.js';

export interface FakeCaseCreation {
  createCaseInTx: CreateCaseInTx;
  /** Every input it was called with, in order. */
  readonly created: CaseCreationInput[];
}

/** Answers a case named `<KEY>-<n>`, counting from 1, holding what it was given. */
export function fakeCaseCreation(key = 'TEST'): FakeCaseCreation {
  const created: CaseCreationInput[] = [];
  return {
    created,
    createCaseInTx: (_tx, _deps, input): Promise<CreatedCase> => {
      created.push(input);
      return Promise.resolve({
        id: `case_${String(created.length).padStart(26, '0')}`,
        name: `${key}-${String(created.length)}`,
        heldObjects: (input.objectIds ?? []).map((objectId) => ({
          objectType: 'inquiry' as const,
          objectId,
        })),
        staged: [],
      });
    },
  };
}
