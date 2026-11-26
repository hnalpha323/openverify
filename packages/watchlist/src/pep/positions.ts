/**
 * C80.2: the PEP position classes, `packages/watchlist/data/pep-positions.json` (authored,
 * committed, reviewed). Each row names a Wikidata class by its QID (a public identifier, not
 * personal data) and the public PEP class (1-4) of the positions it reaches:
 * - `subclass`: positions that are the class, a subclass of it, or an instance of one;
 * - `directs`: positions that direct (P2389) an organisation of the class, such as a central bank,
 *   an international organisation or a state-owned enterprise.
 *
 * A position several rows reach takes its class from the rows no other reached row `refines`
 * (a mayor is a head of a municipal government, so the mayor row refines the head-of-government
 * row and a mayor stays class 4), then the lowest class number among them.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** The folder of the committed PEP table, beside `src/` and `dist/`. */
export const PEP_DATA_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');

/** The table's file name in {@link PEP_DATA_DIRECTORY}. */
export const PEP_POSITIONS_FILE = 'pep-positions.json';

const QID = /^Q[1-9]\d{0,11}$/u;

/** One position class of the table. */
export const pepPositionClassSchema = z.strictObject({
  qid: z.string().regex(QID),
  /** The class's English label as Wikidata gave it when the row was verified. */
  label: z.string().min(1).max(200),
  pep_class: z.int().min(1).max(4),
  selector: z.enum(['subclass', 'directs']),
  /** A position of the class has one holder at a time, so a later holder ends an open tenure. */
  single_holder: z.boolean(),
  /** Heads of state or government keep the longer retention (C80.4) in a national position. */
  head_of_state_or_government: z.boolean(),
  /** QIDs of broader rows this row overrides for a position both reach. */
  refines: z.array(z.string().regex(QID)),
  source: z.enum(['fatf-2013', 'authored']),
  note: z.string().min(1).max(500),
});
export type PepPositionClass = z.infer<typeof pepPositionClassSchema>;

/** The table file: its rows, where its sources point, and how the QIDs were verified. */
export const pepPositionsFileSchema = z
  .strictObject({
    description: z.string().min(1),
    verified: z.strictObject({ date: z.iso.date(), method: z.string().min(1) }),
    sources: z.strictObject({ 'fatf-2013': z.string().min(1), authored: z.string().min(1) }),
    classes: z.array(pepPositionClassSchema).min(1),
  })
  .superRefine((file, context) => {
    const qids = new Set<string>();
    for (const [index, entry] of file.classes.entries()) {
      if (qids.has(entry.qid)) {
        context.addIssue({
          code: 'custom',
          message: 'a QID is listed twice',
          path: ['classes', index],
        });
      }
      qids.add(entry.qid);
    }
    for (const [index, entry] of file.classes.entries()) {
      if (entry.refines.some((broader) => !file.classes.some((other) => other.qid === broader))) {
        context.addIssue({
          code: 'custom',
          message: 'a row refines a QID the table does not hold',
          path: ['classes', index, 'refines'],
        });
      }
    }
  });

let loaded: readonly PepPositionClass[] | undefined;

/** The committed table's rows, validated once and cached. */
export function loadPepPositionClasses(): readonly PepPositionClass[] {
  loaded ??= Object.freeze(
    pepPositionsFileSchema.parse(
      JSON.parse(readFileSync(join(PEP_DATA_DIRECTORY, PEP_POSITIONS_FILE), 'utf8')),
    ).classes,
  );
  return loaded;
}

/** What a position takes from the rows that reached it. */
export interface PositionClassing {
  readonly pepClass: 1 | 2 | 3 | 4;
  readonly singleHolder: boolean;
  readonly headOfStateOrGovernment: boolean;
}

/**
 * The class a position takes from the rows that reached it: the rows no other reached row
 * refines decide; the lowest class number wins; a later holder ends an open tenure when any
 * deciding row says the position has one holder, unless the position is a row's class itself (a
 * generic item many people hold at once); the head retention applies when a deciding row says so.
 * `null` when no row of `classes` reached it.
 */
export function classifyPosition(
  position: string,
  reachedBy: ReadonlySet<string>,
  classes: readonly PepPositionClass[],
): PositionClassing | null {
  const reached = classes.filter((entry) => reachedBy.has(entry.qid));
  if (reached.length === 0) {
    return null;
  }
  const refined = new Set(reached.flatMap((entry) => entry.refines));
  const deciding = reached.filter((entry) => !refined.has(entry.qid));
  const rows = deciding.length === 0 ? reached : deciding;
  const generic = classes.some((entry) => entry.qid === position);
  return {
    pepClass: Math.min(...rows.map((entry) => entry.pep_class)) as PositionClassing['pepClass'],
    singleHolder: !generic && rows.some((entry) => entry.single_holder),
    headOfStateOrGovernment: rows.some((entry) => entry.head_of_state_or_government),
  };
}
