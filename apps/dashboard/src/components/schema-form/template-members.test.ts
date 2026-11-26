import {
  TEMPLATE_SETTINGS_DEFAULTS,
  updateInquiryTemplateVersionAttributesSchema,
} from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { TEMPLATE_FORMS_COPY } from '../../lib/copy/template-forms';
import { jsonSchemaOf } from './model';
import {
  FORM_MEMBER_KEYS,
  FORM_MEMBER_SCHEMAS,
  LINK_MEMBERS,
  MEMBERS_FORMED_ELSEWHERE,
  attributesOf,
  memberPointer,
  memberValueOf,
  settingsNotes,
} from './template-members';

const CONTRACT = updateInquiryTemplateVersionAttributesSchema.shape;

/** The JSON Schema of each member of an object schema. */
const propertiesOf = (schema: z.ZodType) =>
  jsonSchemaOf(schema).properties as Readonly<Record<string, unknown>>;

describe('the template members the forms edit (C153.1, C153.3)', () => {
  it('forms every attribute a draft PATCH takes here, or names the page that forms it', () => {
    const here = FORM_MEMBER_KEYS.flatMap((key) => (key === 'links' ? [...LINK_MEMBERS] : [key]));
    const elsewhere = Object.keys(MEMBERS_FORMED_ELSEWHERE);

    expect([...here, ...elsewhere].sort()).toEqual(Object.keys(CONTRACT).sort());
    expect(here.filter((member) => elsewhere.includes(member))).toEqual([]);
  });

  it('judges each member with the contract’s own schema', () => {
    for (const key of FORM_MEMBER_KEYS) {
      if (key === 'links') {
        for (const member of LINK_MEMBERS) {
          expect(propertiesOf(FORM_MEMBER_SCHEMAS.links)[member]).toEqual(
            propertiesOf(z.strictObject({ value: CONTRACT[member] })).value,
          );
        }
      } else {
        expect(jsonSchemaOf(FORM_MEMBER_SCHEMAS[key])).toEqual(
          jsonSchemaOf(CONTRACT[key].unwrap()),
        );
      }
    }
  });

  it('sends a member under its own name, and the links as attributes of their own', () => {
    expect(attributesOf('settings', { 'max-sessions': 5 })).toEqual({
      settings: { 'max-sessions': 5 },
    });
    expect(attributesOf('links', { 'help-url': null, 'redirect-include-status': true })).toEqual({
      'help-url': null,
      'redirect-include-status': true,
    });
  });

  it('reads a member from a version, the links from the attributes they are', () => {
    const attributes = {
      settings: { 'max-sessions': 5 },
      'help-url': 'https://help.example.com/synthetic',
      'redirect-include-status': false,
      flow: { steps: [] },
    };

    expect(memberValueOf('settings', attributes)).toEqual({ 'max-sessions': 5 });
    expect(memberValueOf('links', attributes)).toEqual({
      'help-url': 'https://help.example.com/synthetic',
      'redirect-include-status': false,
    });
    expect(memberValueOf('list-config', attributes)).toEqual({});
  });

  it('places a pointer of the request or of the stored validation inside its member', () => {
    expect(memberPointer('settings', '/data/attributes/settings/max-sessions')).toBe(
      '/max-sessions',
    );
    expect(memberPointer('settings', '/settings')).toBe('');
    expect(memberPointer('links', '/embed-origins/2')).toBe('/embed-origins/2');
    expect(memberPointer('links', '/data/attributes/redirect-uri')).toBe('/redirect-uri');
    expect(memberPointer('links', '/flow/steps/0')).toBeNull();
    expect(memberPointer('list-config', '/data/attributes/list-config/screen/1')).toBe('/screen/1');
    expect(memberPointer('list-config', '/data/attributes/settings')).toBeNull();
  });
});

describe('settingsNotes (C153.3, C171.4)', () => {
  const NOTES = TEMPLATE_FORMS_COPY.notes;

  it('warns at every inquiry or session window below 20 hours, in hours', () => {
    const notes = settingsNotes({
      'inquiry-expiration-seconds': 3_600,
      'session-expiration-seconds': 71_999,
      'inquiry-expiration-after-start-seconds': 72_000,
      'inquiry-expiration-after-resume-seconds': 1_800,
    });

    expect(notes['inquiry-expiration-seconds']).toContain(NOTES.timing('1'));
    expect(notes['session-expiration-seconds']).toContain(NOTES.timing('19.9'));
    expect(notes['inquiry-expiration-after-resume-seconds']).toContain(NOTES.timing('0.5'));
    expect(notes['inquiry-expiration-after-start-seconds']).not.toContain('Warning');
  });

  it('says the default every setting takes when left empty', () => {
    const notes = settingsNotes({});

    for (const [name, value] of Object.entries(TEMPLATE_SETTINGS_DEFAULTS)) {
      expect(notes[name]).toContain(
        NOTES.defaultIs(
          typeof value === 'object' ? TEMPLATE_FORMS_COPY.schemaForm.readOnlyNone : String(value),
        ),
      );
    }
  });
});
