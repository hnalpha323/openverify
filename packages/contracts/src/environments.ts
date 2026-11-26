import { z } from 'zod';

/** Kinds of environment an organization has (C12 principals, C19 flow session). */
export const ENVIRONMENT_KINDS = ['sandbox', 'production'] as const;
export const environmentKindSchema = z.enum(ENVIRONMENT_KINDS);
export type EnvironmentKind = z.infer<typeof environmentKindSchema>;
