/**
 * Phone and email check config (C51.3, C56). Owned by `checks-contact-crypto` in Workflow 5A
 * Stage 2; amendments to these keys are recorded in the plan.
 */
import { z } from 'zod';
import { defaultsTable, provisionalDefault } from './basis.js';

/** The longest operator allow or deny list of email domains (C51.3). */
export const MAX_EMAIL_DOMAIN_LIST = 500;

/** A lower-case DNS host name with at least one dot (an IDN in its ASCII form). */
const emailDomainSchema = z
  .string()
  .max(253)
  .regex(
    // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
    /^(?=[a-z0-9-]{1,63}\.)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
    'must be a lower-case domain name such as disposable.example',
  );

const domainList = z
  .array(emailDomainSchema)
  .max(MAX_EMAIL_DOMAIN_LIST)
  .refine((values) => new Set(values).size === values.length, 'must not contain duplicates');

export const emailAddressDisposableDetectionConfigSchema = z
  .strictObject({
    /** Domains never treated as disposable, whatever the list says. */
    'allow-domains': domainList.optional(),
    /** Domains always treated as disposable. */
    'deny-domains': domainList.optional(),
  })
  .refine(
    (config) =>
      !(config['allow-domains'] ?? []).some((domain) => config['deny-domains']?.includes(domain)),
    { message: 'a domain cannot be both allowed and denied', path: ['deny-domains'] },
  );

/** C51.3: the contact check defaults. */
export const CONTACT_CHECK_CONFIG_DEFAULTS = defaultsTable({
  email_address_disposable_detection: {
    'allow-domains': provisionalDefault([], 'ours: no operator list; the CC0 list decides (C56)'),
    'deny-domains': provisionalDefault([], 'ours: no operator list; the CC0 list decides (C56)'),
  },
});
