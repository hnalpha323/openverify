/**
 * Synthetic flows for the builder's tests (C155): a consent, a screen, a government ID with its
 * exhausted fallback to a document step, a branch on age with its else, a completion and a failure.
 */
import { flowV2Schema, type FlowV2 } from '@openverify/flow-spec';
import { stepTemplate } from './flow-model';

export function builderFlow(): FlowV2 {
  return flowV2Schema.parse({
    metadata: { specVersion: 2, id: 'synthetic', version: 1, name: 'Synthetic' },
    entry: 's_consent0',
    steps: [
      stepTemplate('consent', 's_consent0'),
      { ...stepTemplate('screen', 's_screen00'), name: 'Your details' },
      stepTemplate('government_id', 's_govid000'),
      stepTemplate('document', 's_doc00000'),
      {
        id: 's_branch00',
        type: 'branch',
        name: 'Age',
        routes: [
          {
            key: 'minor',
            label: 'Under 18',
            condition: { '<': [{ var: 'verifications.s_govid000.age-years' }, 18] },
            onNull: 'review',
          },
        ],
      },
      stepTemplate('completion', 's_done0000'),
      stepTemplate('failure', 's_fail0000'),
    ],
    edges: [
      { id: 'e_1', from: 's_consent0', port: 'next', to: 's_screen00' },
      { id: 'e_2', from: 's_screen00', port: 'next', to: 's_govid000' },
      { id: 'e_3', from: 's_govid000', port: 'next', to: 's_branch00' },
      { id: 'e_4', from: 's_govid000', port: 'exhausted', to: 's_doc00000' },
      { id: 'e_5', from: 's_doc00000', port: 'next', to: 's_done0000' },
      { id: 'e_6', from: 's_branch00', port: 'route:minor', to: 's_fail0000' },
      { id: 'e_7', from: 's_branch00', port: 'else', to: 's_done0000' },
    ],
    layout: { s_consent0: { x: 10, y: 20 } },
  });
}
