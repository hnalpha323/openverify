import { text } from 'drizzle-orm/pg-core';
import { environments } from './tenancy.js';

/**
 * `environment_id` of a tenant table. Deleting an environment deletes all of its data.
 * Child tables also reference their parent through `(environment_id, parent_id)`, so a
 * row can never point at another environment's data, whatever the caller passes.
 */
export const environmentId = () =>
  text('environment_id')
    .notNull()
    .references(() => environments.id, { onDelete: 'cascade' });
