/**
 * C127.8, outcome 20: `fetch_object`, as an API client reads the object: the server API's signal view,
 * never the console's, under the run's mask. The output's `object` is marked PII whole (C120.6).
 */
import { fetchObjectConfigSchema } from '@openverify/workflow-engine/actions';
import type { OutsideActionHandler } from '../../engine/action-port.js';
import { answering, configOf } from '../shared.js';
import { rowOf } from './tags.js';

export const FETCH_OBJECT_HANDLER: OutsideActionHandler = {
  key: 'fetch_object',
  version: 1,
  shape: 'outside',
  execute: (context) =>
    answering(async () => {
      const config = configOf(context, fetchObjectConfigSchema);
      const id = config['object-id'];
      const object = await rowOf(config['object-type']).fetch(context, id);
      return {
        kind: 'succeeded',
        output: { 'object-type': config['object-type'], 'object-id': id, object },
        subjects: [{ subjectId: id, source: 'read' }],
      };
    }),
};
