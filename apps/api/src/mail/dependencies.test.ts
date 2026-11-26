/**
 * C67: nodemailer moves past the three addressparser advisories fixed in 10.1.4
 * (GHSA-8c8m-p3m8-cjg8, GHSA-m943-m63m-w62w, GHSA-85x2-q946-cp5h), at a version at least 14 days
 * old on the day it is taken. Recipients reach the mailer only as `{ address }` objects (C55.8),
 * but the operator's `from` string still goes through the parser.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../../../..');
const NODEMAILER = '10.1.6';

function lockedVersions(name: string): string[] {
  const lock = readFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'utf8');
  const packages = lock.slice(
    lock.lastIndexOf('\npackages:\n'),
    lock.lastIndexOf('\nsnapshots:\n'),
  );
  return packages
    .split('\n')
    .filter((line) => line.startsWith(`  ${name}@`))
    .map((line) =>
      line
        .trim()
        .replace(/:$/, '')
        .slice(name.length + 1),
    );
}

interface ParsedAddress {
  address?: string;
  group?: ParsedAddress[];
}

const parse = createRequire(import.meta.url)('nodemailer/lib/addressparser') as (
  value: string,
) => ParsedAddress[];

function domains(parsed: ParsedAddress[]): string[] {
  return parsed.flatMap((entry) =>
    entry.group ? domains(entry.group) : [(entry.address ?? '').split('@').pop() ?? ''],
  );
}

describe('the nodemailer dependency (C67)', () => {
  it(`pins nodemailer ${NODEMAILER} exactly`, () => {
    const manifest = JSON.parse(
      readFileSync(path.join(repoRoot, 'apps/api/package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    expect(manifest.dependencies.nodemailer).toBe(NODEMAILER);
  });

  it('leaves one nodemailer version in the lockfile', () => {
    expect(lockedVersions('nodemailer')).toEqual([NODEMAILER]);
  });

  it.each([
    'Victim (x(y) <evil@evil.com>) <v@victim.com>',
    'G: (a; <evil@evil.com>) <v@victim.com>;',
    'G: "a;" "<evil@evil.com>" <v@victim.com>;',
    '<"a@evil.com>"@good.com>',
  ])('parses %j without an evil.com mailbox', (payload) => {
    expect(domains(parse(payload))).not.toContain('evil.com');
  });
});
