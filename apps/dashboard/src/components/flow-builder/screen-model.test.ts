import { COMPONENT_KINDS, screenStepSchema, type ScreenStep } from '@openverify/flow-spec';
import { describe, expect, it } from 'vitest';
import {
  addComponent,
  componentLibrary,
  componentRows,
  moveComponent,
  removeComponent,
  replaceComponent,
} from './screen-model';

/** A screen of a title, a container holding a name field, and a continue button. */
function details(): ScreenStep {
  return screenStepSchema.parse({
    id: 's_screen00',
    type: 'screen',
    name: 'Your details',
    components: [
      { id: 'title', kind: 'text', variant: 'title', copyKey: 's_screen00.title.title' },
      {
        id: 'group',
        kind: 'container',
        direction: 'vertical',
        children: [
          {
            id: 'name',
            kind: 'text_input',
            field: 'name_first',
            labelKey: 's_screen00.name.label',
          },
        ],
      },
      { id: 'continue', kind: 'button', labelKey: 'screen.continue', action: 'submit' },
    ],
  });
}

const ids = (step: ScreenStep | null) =>
  step === null ? null : componentRows(step).map((row) => [row.component.id, row.depth]);

describe('a screen’s components as rows, nested in order (C155.5)', () => {
  it('lists every component with its depth, containers before their children', () => {
    expect(ids(details())).toEqual([
      ['title', 1],
      ['group', 1],
      ['name', 2],
      ['continue', 1],
    ]);
    expect(componentRows(details())[2]?.path).toEqual([1, 0]);
  });
});

describe('the component library (C155.5)', () => {
  it('offers every kind of the format, an image refused with its reason', () => {
    const library = componentLibrary();

    expect(library.map((entry) => entry.kind)).toEqual([...COMPONENT_KINDS]);
    expect(library.find((entry) => entry.kind === 'image')?.refusal).toMatch(/theme asset/);
    expect(library.filter((entry) => entry.refusal !== null)).toHaveLength(1);
  });

  it('adds each kind it offers as a component the format accepts, bound to a field it is given', () => {
    for (const entry of componentLibrary().filter((each) => each.refusal === null)) {
      const added = addComponent(details(), entry.kind, ['email_address']);
      expect(added, entry.kind).not.toBeNull();
      expect(screenStepSchema.safeParse(added).success, entry.kind).toBe(true);
    }
    const email = addComponent(details(), 'email', ['email_address']);
    const last = email?.components.at(-1);
    expect(last).toMatchObject({ kind: 'email', field: 'email_address' });
    expect(new Set(componentRows(email ?? details()).map((row) => row.component.id)).size).toBe(5);
  });
});

describe('moving components without dragging (C155.5, 2.5.7)', () => {
  it('moves a component up and down among its siblings, never past either end', () => {
    expect(ids(moveComponent(details(), [2], 'up'))).toEqual([
      ['title', 1],
      ['continue', 1],
      ['group', 1],
      ['name', 2],
    ]);
    expect(moveComponent(details(), [0], 'up')).toBeNull();
    expect(moveComponent(details(), [2], 'down')).toBeNull();
  });

  it('moves a component into the container before it, and out of its container after it', () => {
    expect(ids(moveComponent(details(), [2], 'into'))).toEqual([
      ['title', 1],
      ['group', 1],
      ['name', 2],
      ['continue', 2],
    ]);
    expect(ids(moveComponent(details(), [1, 0], 'out'))).toBeNull();
    const two = moveComponent(details(), [2], 'into');
    expect(ids(two === null ? null : moveComponent(two, [1, 1], 'out'))).toEqual([
      ['title', 1],
      ['group', 1],
      ['name', 2],
      ['continue', 1],
    ]);
    expect(moveComponent(details(), [0], 'into')).toBeNull();
    expect(moveComponent(details(), [0], 'out')).toBeNull();
  });

  it('removes a component, never the screen’s last one or a container’s last child', () => {
    expect(ids(removeComponent(details(), [0]))).toEqual([
      ['group', 1],
      ['name', 2],
      ['continue', 1],
    ]);
    expect(removeComponent(details(), [1, 0])).toBeNull();
  });

  it('replaces a component in place, refusing one the format does not accept', () => {
    const replaced = replaceComponent(details(), [1, 0], {
      id: 'name',
      kind: 'text_input',
      field: 'name_first',
      labelKey: 's_screen00.name.label',
      required: true,
    });

    expect(replaced?.components[1]).toMatchObject({ children: [{ required: true }] });
    expect(
      replaceComponent(details(), [1, 0], {
        id: 'name',
        kind: 'text_input',
        field: 'name_first',
        labelKey: 's_screen00.name.label',
        minLength: 5,
        maxLength: 2,
      }),
    ).toBeNull();
  });
});
