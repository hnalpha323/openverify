/**
 * Action endpoints (contract C9): `POST /api/v1/<resource>/:id/<action>` with an optional
 * `{ "meta": { ... } }` body. The response is the updated resource.
 */
import { z } from 'zod';

/** Body of an action whose meta has required members: `{ meta }` must be sent. */
export function actionBodySchema<Meta extends z.ZodType>(meta: Meta) {
  return z.strictObject({ meta });
}

/** Body of an action whose meta members are all optional: the body, and its meta, may be left out. */
export function optionalActionBodySchema<Meta extends z.ZodType>(meta: Meta) {
  return z.strictObject({ meta: meta.optional() }).optional();
}

/** Body of an action without parameters, such as `approve`. */
export const emptyActionBodySchema = optionalActionBodySchema(z.strictObject({}));
export type EmptyActionBody = z.infer<typeof emptyActionBodySchema>;
