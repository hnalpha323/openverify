/**
 * C52.8, C53.7, C54.1: the `business-website` verification's attributes: the URL the user entered,
 * its host (`website-domain`, lower-case ASCII as the checks read it), and the domain's
 * registration date as the domain age check read it from RDAP (`domain-registered-at`: that
 * check's `registered-at`, a day, served at midnight UTC; only for the registered domain, so
 * `null` when the age was unavailable or not checked). The URL and host are PII (a personal site
 * can name its owner): masked for a principal without `pii:view` and `null` once redacted. The
 * date is public registry data, not masked; redaction clears it with the checks' metadata.
 */
import { websiteHostOf } from '@openverify/checks';
import { getVerificationInputs } from '@openverify/db';
import { textOrNull } from './database.js';
import type { VerificationAttributeHook } from './index.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The registration date the domain age check recorded, as a timestamp, or `null`. */
function registeredAtOf(checks: readonly { name: string; metadata: unknown }[]): string | null {
  const check = checks.find((one) => one.name === 'business_website_domain_age_detection');
  const metadata = check?.metadata;
  const date =
    typeof metadata === 'object' && metadata !== null
      ? (metadata as Record<string, unknown>)['registered-at']
      : undefined;
  return typeof date === 'string' && DATE.test(date) && !Number.isNaN(Date.parse(date))
    ? `${date}T00:00:00.000Z`
    : null;
}

export const businessWebsiteAttributes: VerificationAttributeHook = {
  async load(db, verification) {
    const inputs = await getVerificationInputs(db, verification.environmentId, verification.id);
    const url = textOrNull(inputs?.values?.['website-url']);
    return {
      'website-url': url,
      'website-domain': url === null ? null : websiteHostOf(url),
      'domain-registered-at': registeredAtOf(verification.checks),
    };
  },
  mask: (attributes, mask) => mask.attributes(attributes),
};
