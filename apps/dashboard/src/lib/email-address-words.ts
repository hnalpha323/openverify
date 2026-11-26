/**
 * The email address verification in words (C55, C56, C66): what a pass means, what the
 * disposable-domain check matched and how far up, and how the mail-domain (MX) check found its
 * answer. No value names a domain: the checks record none (C51.4).
 */
import type { WordsText } from './selfie-words';

/**
 * C66: what a passed email address verification means, as `docs/checks/contact.md` says it (its
 * test checks the sentences against that page).
 */
export const EMAIL_ADDRESS_PASS_MEANS =
  'The user entered the code that was sent to that address. ' +
  'It shows that they could read mail sent to it at that moment. ' +
  'It does not establish who the person is, that the address belongs to them, or that they will keep it.';

/** What `email_address_disposable_detection` matched (`metadata.match`, C56). */
const MATCH_WORDS: ReadonlyMap<string, WordsText> = new Map<string, WordsText>([
  [
    'none',
    {
      words: 'On no list',
      explanation:
        'Neither the domain nor any domain above it is on the pinned list or the template lists.',
    },
  ],
  [
    'listed',
    {
      words: 'On the disposable-domain list',
      explanation: 'The pinned list of disposable email domains holds it.',
    },
  ],
  [
    'denied',
    {
      words: "On the template's deny list",
      explanation: "The template's deny-domains names it, whatever the pinned list says.",
    },
  ],
  [
    'allowed',
    {
      words: "On the template's allow list",
      explanation:
        "The template's allow-domains names it, so it passes whatever the pinned list says.",
    },
  ],
]);

/** How `email_address_mx_detection` found its answer (`metadata.route`, C56). */
const ROUTE_WORDS: ReadonlyMap<string, WordsText> = new Map<string, WordsText>([
  ['mx', { words: 'MX records', explanation: 'The domain publishes mail exchangers.' }],
  [
    'null_mx',
    {
      words: 'A null MX record',
      explanation: 'The domain says it accepts no mail (RFC 7505).',
    },
  ],
  [
    'implicit',
    {
      words: 'Address records (implicit MX)',
      explanation:
        "Without MX records, mail goes to the domain's own A or AAAA records (RFC 5321).",
    },
  ],
  [
    'nxdomain',
    { words: 'The domain does not exist', explanation: 'DNS answered NXDOMAIN for the domain.' },
  ],
  [
    'reserved',
    {
      words: 'A reserved sandbox name',
      explanation:
        'In a sandbox environment, names under .test and .example take mail and names under .invalid do not, without a DNS query.',
    },
  ],
]);

/** What `email_address_disposable_detection` matched (`metadata.match`), in words. */
export function disposableMatchText(match: unknown): WordsText | undefined {
  return typeof match === 'string' ? MATCH_WORDS.get(match) : undefined;
}

/** How far above the address's own domain the match was (`metadata['match-depth']`). */
export function matchDepthText(depth: number): string {
  if (depth === 0) {
    return "The address's own domain";
  }
  return depth === 1 ? 'The domain above it' : `${String(depth)} levels above the address's domain`;
}

/** How `email_address_mx_detection` found its answer (`metadata.route`), in words. */
export function mxRouteText(route: unknown): WordsText | undefined {
  return typeof route === 'string' ? ROUTE_WORDS.get(route) : undefined;
}
