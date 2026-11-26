import type { CheckResult } from '@openverify/core';
import { checkResult } from './result.js';

const CHECK_ID = 'id_po_box_detection';

export interface IdPoBoxInput {
  /** The address as one string or as separate lines. */
  address?: string | readonly string[] | null | undefined;
}

/**
 * Mailbox patterns, exported for the database PO-box check (C67), matched against the normalized
 * address ({@link normalizeAddress}): lowercase, no
 * diacritics, punctuation other than `#` and `,` turned into spaces, one
 * address line per text line. Each pattern needs a mailbox keyword and, where
 * the keyword alone is ambiguous (Box, BP, Apartado, PMB), a number after it.
 */
export const PO_BOX_PATTERNS: readonly (readonly [id: string, pattern: RegExp])[] = [
  ['po_box', /\b(?:g?p ?o|post ?office|post) ?(?:box|bx|drawer)\b/m],
  ['po_box', /\bp ?o ?b\b/m],
  ['box_number', /(?:^|,) ?box ?#? ?\d+/m],
  ['military', /\b[afd]po ?,? ?a[aep]\b/m],
  ['military', /\b(?:psc|cmr) ?\d+/m],
  ['military', /\bunit ?\d+ ?,? ?box ?\d+/m],
  ['private_mailbox', /\bpmb ?#? ?\d+/m],
  ['private_mailbox', /\bprivate ?mail ?box\b/m],
  ['private_bag', /\b(?:private|locked) ?bag\b/m],
  // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
  ['apartado', /\bapartado(?: (?:de )?(?:correos?|postal|aereo))? ?#? ?\d+/m],
  // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
  ['apartado', /\bapdo ?(?:postal ?)?#? ?\d+/m],
  // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
  ['casilla', /\bcasilla(?: (?:de )?(?:correos?|postal))? ?#? ?\d+/m],
  ['postfach', /\bpostfach\b/m],
  ['boite_postale', /\bboite ?postale\b/m],
  ['boite_postale', /\bb ?p ?\d+/m],
  ['caixa_postal', /\bcaixa ?postal\b/m],
  ['casella_postale', /\bcasella ?postale\b/m],
  ['postbus', /\bpostbus\b/m],
  ['postboks', /\bpostboks\b/m],
  ['postilokero', /\bpostilokero\b/m],
  ['skrytka_pocztowa', /\bskrytka ?pocztowa\b/m],
  ['posta_kutusu', /\bposta ?kutusu\b/m],
  ['general_delivery', /\b(?:general ?delivery|poste ?restante|postlagernd)\b/m],
];

/**
 * An address as the patterns read it (C67): lowercase, without diacritics, punctuation other than
 * `#` and `,` turned into spaces, one address line per text line.
 */
export function normalizeAddress(lines: readonly string[]): string {
  return lines
    .map((line) =>
      line
        .normalize('NFKD')
        .replace(/\p{M}+/gu, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}#,]+/gu, ' ')
        .replace(/ *, */g, ', ')
        .trim(),
    )
    .filter(Boolean)
    .join('\n');
}

/**
 * `id_po_box_detection`: flags PO boxes, military and diplomatic mail
 * (APO/FPO/DPO, PSC, CMR), private mailboxes at mail-receiving agencies and
 * international equivalents (Apartado, Casilla, Postfach, Boîte Postale,
 * Caixa Postal, Postbus, Postboks, …). Only pattern ids are reported, never
 * the address itself. Without an address the check has no evidence
 * (`input_missing`).
 */
export function idPoBoxDetection(input: IdPoBoxInput): CheckResult {
  const lines = typeof input.address === 'string' ? [input.address] : (input.address ?? []);
  const address = normalizeAddress(lines);
  if (address === '') {
    return checkResult(CHECK_ID, 'not_applicable', ['input_missing']);
  }
  const matchedPatterns = [
    ...new Set(PO_BOX_PATTERNS.filter(([, pattern]) => pattern.test(address)).map(([id]) => id)),
  ];
  return matchedPatterns.length > 0
    ? checkResult(CHECK_ID, 'failed', ['po_box_detected'], { matchedPatterns })
    : checkResult(CHECK_ID, 'passed', [], { matchedPatterns });
}
