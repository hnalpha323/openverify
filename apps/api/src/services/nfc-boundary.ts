/**
 * C200.2, C221.12 (Workflow 10A, api-android-10a; review V13): whether a character is a stable NFC
 * boundary, which the organisation's display name must start with. A device fills `{organization}`
 * into a consent text without normalising, and the server takes its digest over the NFC form of the
 * whole filled text; the two agree when the name is NFC and starts with a character that neither
 * composes with nor reorders against what precedes it (UAX #15: canonical combining class 0 and
 * `NFC_Quick_Check=Yes`, ICU's "boundary before").
 *
 * Every property is read from the platform's own Unicode data through `String.prototype.normalize`,
 * never from a table typed here:
 * - `NFC_Quick_Check=No`: NFC replaces the character (a singleton such as U+212B, an excluded
 *   composition);
 * - a class other than 0: canonical reordering moves the character past U+0334 (class 1) or moves
 *   it before U+0345 (class 240), which only a mark of another class does;
 * - `NFC_Quick_Check=Maybe` with class 0: the character is the last of a canonical decomposition
 *   that NFC composes back (the conjoining Hangul vowels U+1161-U+1175 and final consonants
 *   U+11A8-U+11C2, and vowel signs such as U+0BBE), found once by walking every code point that has
 *   a canonical decomposition.
 */

/** The last code point a canonical decomposition may hold (CJK compatibility ideographs). */
const LAST_DECOMPOSABLE = 0x2fa1d;
const OVERLAY = '̴';
const YPOGEGRAMMENI = 'ͅ';

/** Whether `character`'s canonical combining class is not 0 (a mark that reorders). */
function isNonStarter(character: string): boolean {
  return (
    `${character}${OVERLAY}`.normalize('NFD').startsWith(OVERLAY) ||
    !`${YPOGEGRAMMENI}${character}`.normalize('NFD').startsWith(YPOGEGRAMMENI)
  );
}

let composingStarters: ReadonlySet<number> | undefined;

/** The class-0 code points NFC composes with what precedes them (`NFC_Quick_Check=Maybe`). */
function composingStartersOf(): ReadonlySet<number> {
  if (composingStarters !== undefined) {
    return composingStarters;
  }
  const found = new Set<number>();
  for (let codePoint = 0xc0; codePoint <= LAST_DECOMPOSABLE; codePoint += 1) {
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
      continue;
    }
    const composite = String.fromCodePoint(codePoint);
    const decomposed = Array.from(composite.normalize('NFD'));
    const last = decomposed.at(-1);
    if (
      decomposed.length > 1 &&
      last !== undefined &&
      decomposed.join('').normalize('NFC') === composite &&
      !isNonStarter(last)
    ) {
      found.add(last.codePointAt(0) ?? 0);
    }
  }
  composingStarters = found;
  return found;
}

/** Whether `codePoint` is a stable NFC boundary (canonical combining class 0, NFC_Quick_Check=Yes). */
export function isStableNfcBoundary(codePoint: number): boolean {
  const character = String.fromCodePoint(codePoint);
  return (
    character.normalize('NFC') === character &&
    !isNonStarter(character) &&
    !composingStartersOf().has(codePoint)
  );
}

/** The display name's longest NFC form, as the session serves it (`organizationDisplayNameSchema`). */
const DISPLAY_NAME_MAX_LENGTH = 100;

/** Why `name` cannot be the organisation's display name, or `null` when it can. */
export function displayNameProblem(name: string): string | null {
  const first = name.codePointAt(0);
  if (first !== undefined && !isStableNfcBoundary(first)) {
    return 'organization-display-name must start with a character that does not join the text before it: a letter, digit or symbol, not a combining mark, a conjoining Hangul vowel or final consonant, or a character Unicode normalisation replaces.';
  }
  if (name.normalize('NFC').length > DISPLAY_NAME_MAX_LENGTH) {
    return `organization-display-name is at most ${String(DISPLAY_NAME_MAX_LENGTH)} characters once NFC-normalised.`;
  }
  return null;
}
