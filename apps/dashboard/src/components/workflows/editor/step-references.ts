/**
 * C252.1 (Workflow 11B, ingestion-11b): the workflow editor's step-reference rename. A decision
 * template's step whose id is taken gets a free one, and every `steps.<from>` in its values reads
 * `steps.<to>` (`insertTemplate`, `document-model.ts`). The rename is a scan, so no step id ever
 * becomes a run-time pattern (C252.2's lint rule): a reference starts at a word start and ends at
 * `.`, white space, `}` or the end of the text, as the expression it replaces
 * (`\bsteps\.<from>(?=[.\s}]|$)`) read it.
 */

/** A character of a word, as `\b` reads one. */
const WORD_CHARACTER = /^[A-Za-z0-9_]$/;
/** What may follow a reference: a member, white space, the end of a template expression. */
const REFERENCE_END = /^[.\s}]$/;

/** `text` with every reference to step `from` read as one to step `to`. */
export function renameStepReferences(text: string, from: string, to: string): string {
  const reference = `steps.${from}`;
  let renamed = '';
  let copied = 0;
  let search = 0;
  for (;;) {
    const at = text.indexOf(reference, search);
    if (at === -1) break;
    const end = at + reference.length;
    const startsWord = at === 0 || !WORD_CHARACTER.test(text.charAt(at - 1));
    const ends = end === text.length || REFERENCE_END.test(text.charAt(end));
    if (startsWord && ends) {
      renamed += `${text.slice(copied, at)}steps.${to}`;
      copied = end;
      search = end;
    } else {
      search = at + 1;
    }
  }
  return renamed + text.slice(copied);
}
