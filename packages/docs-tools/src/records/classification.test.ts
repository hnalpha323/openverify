/**
 * C276.2 (Workflow 11E, `docs-records`): the data classification is generated from the code
 * (`packages/core/src/connect/categories.ts`, `ENCRYPTED_COLUMNS`, the redaction categories, the
 * environment settings' defaults and the access export's manifest schema), never the other way
 * round (review F07). These tests read the repository; they never write.
 */
import {
  ACCOUNT_FIELD_TYPES,
  DASHBOARD_SETTINGS_DEFAULTS,
  TEMPLATE_FIELD_TYPES,
  accountExportManifestSchema,
} from '@openverify/contracts';
import {
  DATA_CLASSES,
  FIELD_SCHEMA_TYPES,
  SHARE_CATEGORIES,
  SHARE_CATEGORY_DATA_CLASS,
  WELL_KNOWN_FIELD_CATEGORY,
} from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { ENCRYPTED_COLUMNS } from '../../../../packages/db/src/encrypted-columns.js';
import { staleFiles } from '../fresh-render.js';
import { REPOSITORY_ROOT, createMemoryRepository, createRepository } from '../repository.js';
import {
  CLASS_PROFILES,
  COLUMN_CLASSES,
  DATA_CLASSIFICATION_PATH,
  HANDLING_GROUPS,
  PLAINTEXT_RECORDS,
  REDACTION_CATEGORIES_PATH,
  dataClassification,
  readHandlingGroups,
  readTableNames,
  renderDataClassification,
} from './classification.js';

const repo = createRepository(REPOSITORY_ROOT);
const key = (table: string, column: string) => `${table}.${column}`;

describe('every sealed column has a class (C276.2)', () => {
  const sealed = ENCRYPTED_COLUMNS.map((entry) => key(entry.table, entry.column));

  it('names every ENCRYPTED_COLUMNS entry, and nothing else', () => {
    expect(Object.keys(COLUMN_CLASSES).sort()).toEqual([...sealed].sort());
  });

  it('gives each a known class and says what it holds', () => {
    for (const [name, entry] of Object.entries(COLUMN_CLASSES)) {
      expect(DATA_CLASSES, name).toContain(entry.class);
      expect(entry.holds.length, name).toBeGreaterThan(0);
    }
  });

  it('carries every column into the classification with its binding', () => {
    const columns = dataClassification(repo).columns;
    expect(columns.map((entry) => key(entry.table, entry.column)).sort()).toEqual(
      [...sealed].sort(),
    );
    for (const entry of ENCRYPTED_COLUMNS) {
      const found = columns.find((c) => c.table === entry.table && c.column === entry.column);
      expect(found?.aad, key(entry.table, entry.column)).toBe(entry.aad);
    }
  });
});

describe('every field type has a class (C276.2, C230.4)', () => {
  const classification = dataClassification(repo);
  const types = new Set([...FIELD_SCHEMA_TYPES, ...TEMPLATE_FIELD_TYPES, ...ACCOUNT_FIELD_TYPES]);

  it('maps each of the template, account and transaction field types', () => {
    expect(classification.fieldTypes.map((row) => row.type).sort()).toEqual([...types].sort());
  });

  it('reads the class through the share category, as categories.ts does', () => {
    for (const row of classification.fieldTypes) {
      expect(row.class, row.type).toBe(SHARE_CATEGORY_DATA_CLASS[row.shareCategory]);
    }
  });

  it('maps every well-known key the same way', () => {
    expect(classification.wellKnownKeys.map((row) => row.key).sort()).toEqual(
      Object.keys(WELL_KNOWN_FIELD_CATEGORY).sort(),
    );
    for (const row of classification.wellKnownKeys) {
      expect(row.shareCategory, row.key).toBe(WELL_KNOWN_FIELD_CATEGORY[row.key]);
      expect(row.class, row.key).toBe(SHARE_CATEGORY_DATA_CLASS[row.shareCategory]);
    }
  });
});

describe('the classes (C276.2)', () => {
  const classification = dataClassification(repo);

  it('profiles every class of DATA_CLASSES, in its order', () => {
    expect(Object.keys(CLASS_PROFILES).sort()).toEqual([...DATA_CLASSES].sort());
    expect(classification.classes.map((entry) => entry.id)).toEqual([...DATA_CLASSES]);
  });

  it('names only retention settings the environment has, with their defaults from the code', () => {
    const settings = DASHBOARD_SETTINGS_DEFAULTS as Readonly<Record<string, unknown>>;
    const named = [
      ...Object.values(CLASS_PROFILES).flatMap((profile) => profile.retentionSettings),
      ...PLAINTEXT_RECORDS.flatMap((record) => record.retentionSettings),
    ];
    for (const setting of named) {
      expect(Object.hasOwn(settings, setting), setting).toBe(true);
    }
    for (const entry of classification.classes) {
      for (const retention of entry.retentionDefaults) {
        expect(retention.default, retention.key).toEqual(settings[retention.key]);
      }
    }
  });

  it('gives each share category to exactly the class categories.ts names', () => {
    const owners = SHARE_CATEGORIES.map((category) =>
      classification.classes.filter((entry) => entry.shareCategories.includes(category)),
    );
    SHARE_CATEGORIES.forEach((category, index) => {
      expect(
        owners[index]?.map((entry) => entry.id),
        category,
      ).toEqual([SHARE_CATEGORY_DATA_CLASS[category]]);
    });
  });

  it('names only access-export sections the manifest has, and every section is named', () => {
    const shape = accountExportManifestSchema.shape;
    const sections = [
      ...Object.keys(shape.subject.shape).map((name) => `subject.${name}`),
      ...Object.keys(shape['operator-review'].shape)
        .filter((name) => name !== 'label')
        .map((name) => `operator-review.${name}`),
      'files',
    ];
    const named = Object.values(CLASS_PROFILES).flatMap((profile) => profile.exportSections);
    for (const section of named) {
      expect(sections, section).toContain(section);
    }
    for (const section of sections) {
      expect(named, section).toContain(section);
    }
  });
});

describe('the handling groups are the redaction categories of the code', () => {
  const groups = readHandlingGroups(repo);

  it('describes every category redaction.test-support.ts declares, and no other', () => {
    expect([...groups.keys()].sort()).toEqual(Object.keys(HANDLING_GROUPS).sort());
    expect(groups.size).toBeGreaterThan(10);
  });

  it('places every sealed table in exactly one category', () => {
    const tables = [...new Set(ENCRYPTED_COLUMNS.map((entry) => entry.table))];
    for (const table of tables) {
      const holders = [...groups.entries()].filter(([, members]) => members.includes(table));
      expect(
        holders.map(([name]) => name),
        table,
      ).toHaveLength(1);
    }
  });

  it('reads a list, skipping its comments', () => {
    const fixture = createMemoryRepository({
      [REDACTION_CATEGORIES_PATH]: [
        'export const SUBJECT_PII_TABLES = [',
        "  'accounts',",
        "  // a comment that says 'files'",
        "  'events',",
        '] as const;',
        "export const OPERATOR_PII_TABLES = ['audit_logs', 'webhooks'] as const;",
        "export const NOT_A_LIST = 'x';",
      ].join('\n'),
    });
    expect([...readHandlingGroups(fixture).entries()]).toEqual([
      ['SUBJECT_PII_TABLES', ['accounts', 'events']],
      ['OPERATOR_PII_TABLES', ['audit_logs', 'webhooks']],
    ]);
  });
});

describe('the tables the page names exist', () => {
  const tables = readTableNames(repo);

  it('reads the declared tables', () => {
    expect(tables.has('accounts')).toBe(true);
    expect(tables.size).toBeGreaterThan(150);
  });

  it('names only tables the schema declares', () => {
    const named = [
      ...Object.keys(COLUMN_CLASSES).map((name) => name.split('.')[0] ?? ''),
      ...PLAINTEXT_RECORDS.flatMap((record) => record.tables),
    ];
    for (const table of named) {
      expect(tables.has(table), table).toBe(true);
    }
  });

  it('reads a fixture tree', () => {
    const fixture = createMemoryRepository({
      'packages/db/src/tables/a.ts':
        "export const a = pgTable(\n  'alpha',\n  {});\nconst b = pgTable('beta', {});",
    });
    expect([...readTableNames(fixture)].sort()).toEqual(['alpha', 'beta']);
  });
});

describe('the committed page (the generated-document rule)', () => {
  it('equals a fresh render', () => {
    expect(
      staleFiles(repo, [
        { path: DATA_CLASSIFICATION_PATH, content: renderDataClassification(repo) },
      ]),
    ).toEqual([]);
  });

  it('renders the same bytes twice', () => {
    expect(renderDataClassification(repo)).toBe(renderDataClassification(repo));
  });

  it('names every class, every sealed column and every field type', () => {
    const page = renderDataClassification(repo);
    for (const id of DATA_CLASSES) {
      expect(page, id).toContain(`\`${id}\``);
    }
    for (const entry of ENCRYPTED_COLUMNS) {
      expect(page).toContain(`\`${key(entry.table, entry.column)}\``);
    }
    for (const type of FIELD_SCHEMA_TYPES) {
      expect(page).toContain(`\`${type}\``);
    }
  });
});
