/**
 * The trigger view's alias table (plan C114.4; H27). `trigger` is a flattened view of the event's
 * JSON:API document, and the public product addresses it by names that are not OpenVerify's: this
 * closed table maps each public name to what it reads here. An unknown public name is a publish
 * error, and `expressions/` builds the view from this table, so there is no second list.
 *
 * Each alias has a golden vector in `contracts/fixtures/workflows/trigger-aliases.json`. The list of
 * verification aliases comes from the verification types, so a new type gets its alias by itself.
 */
import { z } from 'zod';
import { VERIFICATION_RESOURCE_TYPES } from './verification-types.js';

/** What a public name reads. */
export const workflowTriggerAliasSchema = z.discriminatedUnion('kind', [
  /** The to-one relationship of that name, with its attributes. */
  z.strictObject({ kind: z.literal('relationship'), relationship: z.string().min(1) }),
  /** The run's verification of that type, the one its inquiry has. */
  z.strictObject({ kind: z.literal('verification'), 'resource-type': z.string().min(1) }),
  /** A member of the resource. */
  z.strictObject({ kind: z.literal('member'), member: z.string().min(1) }),
]);
export type WorkflowTriggerAlias = z.infer<typeof workflowTriggerAliasSchema>;

/** `verification/government-id` reads as `verification_government_id`. */
const verificationAlias = (type: string): string => type.replace('/', '_').replaceAll('-', '_');

/** C114.4: the closed table. */
export const WORKFLOW_TRIGGER_ALIASES: Readonly<Record<string, WorkflowTriggerAlias>> =
  Object.freeze({
    template: { kind: 'relationship', relationship: 'inquiry-template' },
    /** The public id's name: `trigger.template.token` is `trigger.template.id`. */
    token: { kind: 'member', member: 'id' },
    /** C114.4's own example: a government ID's attribute is `country`. */
    country_code: { kind: 'member', member: 'country' },
    ...Object.fromEntries(
      VERIFICATION_RESOURCE_TYPES.map((type): [string, WorkflowTriggerAlias] => [
        verificationAlias(type),
        { kind: 'verification', 'resource-type': type },
      ]),
    ),
  });

/** The alias of a public name, read by own property, so `constructor` is no alias. */
export function workflowTriggerAliasOf(name: string): WorkflowTriggerAlias | undefined {
  return Object.hasOwn(WORKFLOW_TRIGGER_ALIASES, name) ? WORKFLOW_TRIGGER_ALIASES[name] : undefined;
}

/**
 * C114.4: the attribute a public `snake_case` member reads: `country_code` is `country-code`. Inside
 * `fields` keys are never inflected, so a caller never passes one here.
 */
export function workflowTriggerMemberOf(name: string): string {
  return name.replaceAll('_', '-');
}
