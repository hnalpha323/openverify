import type { Component, ScreenClientView } from '@openverify/flow-spec';
import { VisibilityRuleError } from '@openverify/flow-spec';
import { describe, expect, it } from 'vitest';
import {
  boundFields,
  initialScreenState,
  normalizeTyped,
  screenErrors,
  submissionValues,
  visibleComponentIds,
  type BoundField,
} from './screen-model';

function screen(components: Component[]): ScreenClientView {
  return { id: 'details', type: 'screen', components };
}

const name: Component = {
  id: 'name',
  kind: 'text_input',
  field: 'name_first',
  labelKey: 'details.name.label',
  required: true,
  maxLength: 5,
};
const code: Component = {
  id: 'code',
  kind: 'text_input',
  field: 'member_code',
  labelKey: 'details.code.label',
  pattern: '[A-Z]{2}\\d{3}',
};
const pet: Component = {
  id: 'pet',
  kind: 'radio_group',
  field: 'has_pet',
  labelKey: 'details.pet.label',
  options: [
    { key: 'o1', value: 'yes', labelKey: 'details.pet.yes' },
    { key: 'o2', value: 'no', labelKey: 'details.pet.no' },
  ],
};
// Shown only when the person has a pet (C148.4, the same screen's field).
const petName: Component = {
  id: 'pet_name',
  kind: 'text_input',
  field: 'pet_name',
  labelKey: 'details.pet_name.label',
  required: true,
  visibleWhen: { '===': [{ var: 'screen.has_pet' }, 'yes'] },
};
const age: Component = {
  id: 'age',
  kind: 'number',
  field: 'age',
  labelKey: 'details.age.label',
  min: 18,
  max: 120,
};
const submit: Component = {
  id: 'continue',
  kind: 'button',
  labelKey: 'screen.continue',
  action: 'submit',
};

describe('the fields a screen binds', () => {
  it('lists form components inside containers and an address by its parts', () => {
    const step = screen([
      { id: 'box', kind: 'container', direction: 'vertical', children: [name, code] },
      {
        id: 'home',
        kind: 'address',
        labelKey: 'details.home.label',
        fields: { street1: 'street', city: 'city', postalCode: 'postcode', country: 'country' },
      },
      submit,
    ]);

    expect(boundFields(step).map((field: BoundField) => [field.key, field.part ?? null])).toEqual([
      ['name_first', null],
      ['member_code', null],
      ['street', 'street1'],
      ['city', 'city'],
      ['postcode', 'postalCode'],
      ['country', 'country'],
    ]);
  });
});

describe('the state on arrival (C148.7, C151.5)', () => {
  it('fills a field with the value the session holds, and marks a value it never sends back', () => {
    const step = screen([name, code, age, submit]);

    expect(
      initialScreenState(step, { name_first: 'Sam', member_code: { set: true }, age: 42 }),
    ).toEqual({
      values: { name_first: 'Sam', member_code: '', age: '42' },
      set: new Set(['member_code']),
    });
  });
});

describe('visibility (C148.4)', () => {
  it('evaluates the strict rules over the screen own values, on every change', () => {
    const step = screen([pet, petName, submit]);

    expect(
      visibleComponentIds(step.components, { has_pet: 'no', pet_name: '' }).get('pet_name'),
    ).toBe('hidden');
    expect(
      visibleComponentIds(step.components, { has_pet: 'yes', pet_name: '' }).get('pet_name'),
    ).toBe('visible');
  });

  it('refuses a rule outside the strict subset rather than guessing', () => {
    const rule = { '>': [{ var: 'screen.age' }, 18] };

    expect(() => visibleComponentIds([{ ...age, visibleWhen: rule }], { age: '' })).toThrow(
      VisibilityRuleError,
    );
  });

  it('hides the children of a hidden container', () => {
    const box: Component = {
      id: 'box',
      kind: 'container',
      direction: 'vertical',
      visibleWhen: { '===': [{ var: 'screen.has_pet' }, 'yes'] },
      children: [name],
    };

    expect(visibleComponentIds([pet, box], { has_pet: 'no', name_first: '' }).get('name')).toBe(
      'hidden',
    );
  });
});

describe('the checks that help the person (C148.3, C148.5)', () => {
  it('names a missing required value and a value too long', () => {
    const step = screen([name, submit]);
    const state = initialScreenState(step);
    const visibility = visibleComponentIds(step.components, state.values);

    expect(screenErrors(step, state, visibility).get('name_first')).toEqual({ code: 'required' });
    expect(
      screenErrors(step, { ...state, values: { name_first: 'Samantha' } }, visibility).get(
        'name_first',
      ),
    ).toEqual({ code: 'tooLong', limit: '5' });
  });

  it('runs a pattern through the shared linear-time matcher, never RegExp', () => {
    const step = screen([code, submit]);
    const visibility = visibleComponentIds(step.components, {});

    expect(
      screenErrors(step, { values: { member_code: 'AB123' }, set: new Set() }, visibility).size,
    ).toBe(0);
    expect(
      screenErrors(step, { values: { member_code: 'ab123' }, set: new Set() }, visibility).get(
        'member_code',
      ),
    ).toEqual({ code: 'pattern' });
  });

  it('ignores the required mark of a hidden component, and of a value the server holds', () => {
    const step = screen([pet, petName, submit]);
    const values = { has_pet: 'no', pet_name: '' };

    expect(
      screenErrors(step, { values, set: new Set() }, visibleComponentIds(step.components, values))
        .size,
    ).toBe(0);

    const held = { values: { has_pet: 'yes', pet_name: '' }, set: new Set(['pet_name']) };
    expect(screenErrors(step, held, visibleComponentIds(step.components, held.values)).size).toBe(
      0,
    );
  });

  it('checks a number against its bounds', () => {
    const step = screen([age, submit]);
    const visibility = visibleComponentIds(step.components, {});

    expect(
      screenErrors(step, { values: { age: '12' }, set: new Set() }, visibility).get('age'),
    ).toEqual({
      code: 'tooSmall',
      limit: '18',
    });
    expect(
      screenErrors(step, { values: { age: 'x' }, set: new Set() }, visibility).get('age'),
    ).toEqual({
      code: 'number',
    });
  });
});

describe('the submission (C148.5, C161.4)', () => {
  it('sends only visible fields, digits normalised and numbers as numbers', () => {
    const step = screen([pet, petName, age, code, submit]);
    const values = { has_pet: 'no', pet_name: 'Rex', age: '٤٢', member_code: 'AB۱۲۳' };
    const visibility = visibleComponentIds(step.components, values);

    expect(submissionValues(step, { values, set: new Set() }, visibility)).toEqual({
      has_pet: 'no',
      age: 42,
      member_code: 'AB123',
    });
  });

  it('leaves a held value out unless the person typed a new one', () => {
    const step = screen([code, submit]);
    const visibility = visibleComponentIds(step.components, {});

    expect(
      submissionValues(
        step,
        { values: { member_code: '' }, set: new Set(['member_code']) },
        visibility,
      ),
    ).toEqual({});
    expect(
      submissionValues(step, { values: { member_code: '' }, set: new Set() }, visibility),
    ).toEqual({ member_code: null });
  });

  it('normalises Arabic-Indic digits as they are typed into a number, a date or an ID', () => {
    const [field] = boundFields(screen([age]));

    expect(field === undefined ? null : normalizeTyped(field, '١٢٣')).toBe('123');
  });
});
