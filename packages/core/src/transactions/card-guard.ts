/**
 * C104.4 (decision 39, P20): the card-number guard. A card-like value is a run of 13-19 digits,
 * optionally separated by single spaces or hyphens, that passes the Luhn check. It catches a
 * mistake; it is not a data-loss scanner, so a run touching a letter or another digit is not a run:
 * a SHA-256 hex digest would otherwise be refused about once in 230, and `reference-id` has no
 * opt-out.
 */
import type { FieldProblem, TransactionTexts } from './engine.js';

const MIN_DIGITS = 13;
const MAX_DIGITS = 19;

/** Digit groups joined by one space or hyphen, not touching a letter or another number. */
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const DIGIT_RUN = /(?<![\p{L}\p{N}])\d+(?:[ -]\d+)*(?![\p{L}\p{N}])/gu;
const GROUP_SEPARATOR = /[ -]/;
const WHOLE_DIGITS = /^\d+$/;

/** The check over `digits[start..end)`, by index: a run of short groups tries many windows. */
function passesLuhn(digits: string, start: number, end: number): boolean {
  let sum = 0;
  let doubling = false;
  for (let index = end - 1; index >= start; index -= 1) {
    const digit = digits.charCodeAt(index) - 48;
    sum += doubling ? (digit > 4 ? digit * 2 - 9 : digit * 2) : digit;
    doubling = !doubling;
  }
  return sum % 10 === 0;
}

/** Whether neighbouring groups of a run spell a card, so a date beside a card hides nothing. */
function runHoldsCard(run: string): boolean {
  const groups = run.split(GROUP_SEPARATOR);
  const digits = groups.join('');
  const groupEnds: number[] = [];
  let offset = 0;
  for (const group of groups) {
    offset += group.length;
    groupEnds.push(offset);
  }
  let start = 0;
  for (const [first, firstEnd] of groupEnds.entries()) {
    // A group holds a digit at least, so a card spans at most MAX_DIGITS of them.
    for (const end of groupEnds.slice(first, first + MAX_DIGITS)) {
      if (end - start > MAX_DIGITS) {
        break;
      }
      if (end - start >= MIN_DIGITS && passesLuhn(digits, start, end)) {
        return true;
      }
    }
    start = firstEnd;
  }
  return false;
}

function textIsCardLike(text: string): boolean {
  for (const [run] of text.normalize('NFKC').matchAll(DIGIT_RUN)) {
    if (runHoldsCard(run)) {
      return true;
    }
  }
  return false;
}

function numberIsCardLike(value: number): boolean {
  if (!Number.isInteger(value)) {
    return false;
  }
  const digits = String(Math.abs(value));
  if (!WHOLE_DIGITS.test(digits) || digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) {
    return false;
  }
  // Past MAX_SAFE_INTEGER, JSON.parse has already rounded the last digits, so Luhn cannot tell.
  return !Number.isSafeInteger(value) || passesLuhn(digits, 0, digits.length);
}

/** C104.4 (P20): a run of 13-19 digits, with single spaces or hyphens, that passes Luhn. */
export function isCardLike(value: string | number): boolean {
  return typeof value === 'string' ? textIsCardLike(value) : numberIsCardLike(value);
}

/** C104.4: `reference-id`, tags and labels, which no version can opt out of. */
export function transactionTextProblems(texts: TransactionTexts): FieldProblem[] {
  const problems: FieldProblem[] = [];
  const refuse = (pointer: string, text: string | null | undefined): void => {
    if (typeof text === 'string' && isCardLike(text)) {
      problems.push({ code: 'card_number_refused', pointer });
    }
  };
  refuse('/reference-id', texts['reference-id']);
  (texts.tags ?? []).forEach((tag, index) => {
    refuse(`/tags/${String(index)}`, tag);
  });
  refuse('/label', texts.label);
  refuse('/model-version', texts['model-version']);
  return problems;
}
