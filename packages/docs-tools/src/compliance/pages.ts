/**
 * C278 (Workflow 11E, docs-compliance): the compliance guide's fixed names. Every page under
 * {@link COMPLIANCE_DIR} opens with a "not legal advice" line and, while Q7 is not answered, the
 * line {@link COUNSEL_LINE} (C278.1, C289).
 */

/** The guide's folder. */
export const COMPLIANCE_DIR = 'docs/compliance';

/** The line every page carries in its opening until counsel's review is recorded (Q7). */
export const COUNSEL_LINE = 'Not reviewed by counsel.';

/** The pattern a page's "not legal advice" line matches. */
export const NOT_LEGAL_ADVICE = /\bnot legal advice\b/i;

/** The generated pages (C278.2's recipient list, C278.5's record of processing). */
export const RECIPIENTS_PAGE = `${COMPLIANCE_DIR}/recipients.md`;
export const RECORD_OF_PROCESSING_PAGE = `${COMPLIANCE_DIR}/record-of-processing.md`;

/** The hand-written pages a record test reads. */
export const ACCESS_REQUESTS_PAGE = `${COMPLIANCE_DIR}/access-requests.md`;
export const RETENTION_PAGE = `${COMPLIANCE_DIR}/retention.md`;
export const SOURCES_PAGE = `${COMPLIANCE_DIR}/sources.md`;

/** Every Markdown page of the guide, sorted. */
export function compliancePages(listFiles: (dir: string) => readonly string[]): readonly string[] {
  return listFiles(COMPLIANCE_DIR).filter((path) => path.endsWith('.md'));
}
