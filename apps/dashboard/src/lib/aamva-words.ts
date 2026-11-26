/**
 * C59.4–C59.6, C66: the AAMVA vocabulary in words, for operators: where the values came from (the
 * AAMVA form, or the inquiry's government ID copied by the server), how the issuer's record
 * answered each field, what the template does when the jurisdiction does not take part, and what
 * an AAMVA pass means. Every lookup reads own entries of a `Map`.
 */
import type { AamvaFieldAnswer, AamvaSource } from './aamva-evidence';
import type { WordsText } from './selfie-words';

/** C66: what an AAMVA pass means, as `docs/checks/database.md` says it (its test checks every sentence against that page). */
export const AAMVA_PASS_MEANING =
  "The issuing jurisdiction's records hold a license or ID card with these details (every field not in ignored-fields matched). It does not show that the card is in the user's hands.";

/**
 * Where a silent attempt's values were copied from. The attempt is bound to the government ID
 * verification whose decision created it (C59.6), but the verification answer carries no
 * attribute naming it, so the console says so rather than guess.
 */
export const AAMVA_COPIED_FROM =
  'Copied from the government ID verification whose decision created this attempt; the API does not name it here.';

const SOURCES: ReadonlyMap<string, WordsText> = new Map([
  [
    'form',
    {
      words: 'The AAMVA form',
      explanation: 'The user entered the license details in the flow.',
    },
  ],
  [
    'government_id',
    {
      words: 'The inquiry’s government ID',
      explanation:
        'The server copied the details from a US license or ID card the government ID step read; the user saw no form.',
    },
  ],
]);

const ANSWERS: ReadonlyMap<string, WordsText> = new Map<string, WordsText>([
  ['no-difference', { words: 'No difference reported' }],
  ['differs', { words: 'Differs' }],
  [
    'ignored',
    {
      words: 'Differs, ignored',
      explanation: 'The template’s ignored fields name it, so it does not fail the identity.',
    },
  ],
  ['no-record', { words: 'No record' }],
  ['not-compared', { words: 'Not compared' }],
  [
    'not-recorded',
    {
      words: 'Not recorded',
      explanation: 'The issuer’s answer does not say how this field compared.',
    },
  ],
  ['routing', { words: 'Picks the jurisdiction asked' }],
]);

const NON_PARTICIPATION: ReadonlyMap<string, string> = new Map([
  ['review', 'Send to review'],
  ['skip', 'Skip the step'],
]);

/** The attribute `source` (`form` or `government_id`, C52.8) in words. */
export function aamvaSourceText(source: AamvaSource): WordsText;
export function aamvaSourceText(source: string): WordsText | undefined;
export function aamvaSourceText(source: string): WordsText | undefined {
  return SOURCES.get(source);
}

/** How the issuer's record answered one field (`AamvaFieldAnswer`) in words. */
export function aamvaFieldAnswerText(answer: AamvaFieldAnswer): WordsText;
export function aamvaFieldAnswerText(answer: string): WordsText | undefined;
export function aamvaFieldAnswerText(answer: string): WordsText | undefined {
  return ANSWERS.get(answer);
}

/** `on-jurisdiction-not-participating` (`review` or `skip`) in words. */
export function nonParticipationText(outcome: string): string | undefined {
  return NON_PARTICIPATION.get(outcome);
}
