/**
 * C148.2 (decision 21): the component catalogue of a `screen` step, discriminated by `kind`.
 * Public kinds, our names and members. Every visible string is a copy key; every form component
 * binds a template field (C149) and has a visible label (C148.7). Patterns are never compiled with
 * `RegExp`: `../pattern/` checks them against the restricted grammar at publish (`pattern_refused`)
 * and runs them on its linear-time matcher (C148.3).
 */
import { z } from 'zod';
import { countryCodeSchema, i18nKeySchema } from '../../flow.js';
import {
  FLOW_V2_CAPS,
  PORT_KEY_PATTERN,
  componentIdSchema,
  distinctList,
  fieldKeySchema,
  publicIdSchema,
  visibilityRuleSchema,
} from './common.js';

/** Members every component carries: its id and the optional strict visibility rules (C148.4). */
const base = {
  id: componentIdSchema,
  visibleWhen: visibilityRuleSchema.optional(),
  enabledWhen: visibilityRuleSchema.optional(),
};

/** A form component's binding and label; `hintKey` is shown below the label. */
const form = {
  ...base,
  field: fieldKeySchema,
  labelKey: i18nKeySchema,
  hintKey: i18nKeySchema.optional(),
  required: z.boolean().optional(),
};

const lengths = {
  minLength: z.int().min(0).max(FLOW_V2_CAPS.valueLength).optional(),
  maxLength: z.int().min(1).max(FLOW_V2_CAPS.valueLength).optional(),
};

/** An ECMAScript `u` pattern of at most 500 characters in the restricted grammar of C148.3. */
export const fieldPatternSchema = z.string().min(1).max(FLOW_V2_CAPS.patternLength);

function lengthsInOrder(value: {
  minLength?: number | undefined;
  maxLength?: number | undefined;
}): boolean {
  return (
    value.minLength === undefined ||
    value.maxLength === undefined ||
    value.minLength <= value.maxLength
  );
}

const lengthOrder = { message: 'minLength must not exceed maxLength', path: ['minLength'] };

export const OPTION_KEY_PATTERN = /^[a-z0-9_]{1,40}$/;

/** C148.3, C162.2: an option is keyed by its generated `key`, never by its value. */
export const componentOptionSchema = z.strictObject({
  key: z.string().regex(OPTION_KEY_PATTERN, 'must be 1 to 40 lowercase letters, digits or _'),
  value: z.string().min(1).max(200),
  labelKey: i18nKeySchema,
});

const options = z
  .array(componentOptionSchema)
  .min(1)
  .max(FLOW_V2_CAPS.options)
  .superRefine((list, ctx) => {
    for (const member of ['key', 'value'] as const) {
      const seen = new Set<string>();
      list.forEach((option, index) => {
        if (seen.has(option[member])) {
          ctx.addIssue({
            code: 'custom',
            message: `duplicate option ${member}`,
            path: [index, member],
          });
        }
        seen.add(option[member]);
      });
    }
  });

const countries = distinctList(countryCodeSchema).optional();

// Content ---------------------------------------------------------------------------------------

export const textComponentSchema = z
  .strictObject({
    ...base,
    kind: z.literal('text'),
    variant: z.enum(['title', 'body', 'caption']),
    copyKey: i18nKeySchema,
  })
  .meta({ id: 'TextComponent' });

export const imageComponentSchema = z
  .strictObject({
    ...base,
    kind: z.literal('image'),
    /** A theme asset of the environment (C160.6). */
    assetId: publicIdSchema('tsa'),
    altKey: i18nKeySchema.optional(),
    decorative: z.boolean(),
  })
  .refine((image) => image.decorative || image.altKey !== undefined, {
    message: 'an image that is not decorative needs altKey',
    path: ['altKey'],
  })
  .meta({ id: 'ImageComponent' });

export const spacerComponentSchema = z
  .strictObject({ ...base, kind: z.literal('spacer'), size: z.enum(['s', 'm', 'l']) })
  .meta({ id: 'SpacerComponent' });

/** A static indicator: a branching flow has no fixed step count (ours). */
export const stepperComponentSchema = z
  .strictObject({
    ...base,
    kind: z.literal('stepper'),
    labelKeys: z.array(i18nKeySchema).min(1).max(FLOW_V2_CAPS.stepperLabels),
    current: z.int().min(0),
  })
  .refine((stepper) => stepper.current < stepper.labelKeys.length, {
    message: 'current must name one of the labels',
    path: ['current'],
  })
  .meta({ id: 'StepperComponent' });

// Form ------------------------------------------------------------------------------------------

export const textInputComponentSchema = z
  .strictObject({
    ...form,
    kind: z.literal('text_input'),
    ...lengths,
    pattern: fieldPatternSchema.optional(),
  })
  .refine(lengthsInOrder, lengthOrder)
  .meta({ id: 'TextInputComponent' });

export const textAreaComponentSchema = z
  .strictObject({
    ...form,
    kind: z.literal('text_area'),
    ...lengths,
    pattern: fieldPatternSchema.optional(),
  })
  .refine(lengthsInOrder, lengthOrder)
  .meta({ id: 'TextAreaComponent' });

/** Shown masked once entered; the session never sends its value back (C151.5). */
export const maskedTextComponentSchema = z
  .strictObject({
    ...form,
    kind: z.literal('masked_text'),
    ...lengths,
    pattern: fieldPatternSchema.optional(),
  })
  .refine(lengthsInOrder, lengthOrder)
  .meta({ id: 'MaskedTextComponent' });

export const numberComponentSchema = z
  .strictObject({
    ...form,
    kind: z.literal('number'),
    min: z.number().optional(),
    max: z.number().optional(),
  })
  .refine(({ min, max }) => min === undefined || max === undefined || min <= max, {
    message: 'min must not exceed max',
    path: ['min'],
  })
  .meta({ id: 'NumberComponent' });

export const dateComponentSchema = z
  .strictObject({
    ...form,
    kind: z.literal('date'),
    min: z.iso.date().optional(),
    max: z.iso.date().optional(),
  })
  .refine(({ min, max }) => min === undefined || max === undefined || min <= max, {
    message: 'min must not be after max',
    path: ['min'],
  })
  .meta({ id: 'DateComponent' });

export const emailComponentSchema = z
  .strictObject({ ...form, kind: z.literal('email') })
  .meta({ id: 'EmailComponent' });

export const phoneComponentSchema = z
  .strictObject({ ...form, kind: z.literal('phone'), allowedCountries: countries })
  .meta({ id: 'PhoneComponent' });

export const urlComponentSchema = z
  .strictObject({ ...form, kind: z.literal('url') })
  .meta({ id: 'UrlComponent' });

export const checkboxComponentSchema = z
  .strictObject({ ...form, kind: z.literal('checkbox') })
  .meta({ id: 'CheckboxComponent' });

export const selectComponentSchema = z
  .strictObject({ ...form, kind: z.literal('select'), options })
  .meta({ id: 'SelectComponent' });

export const radioGroupComponentSchema = z
  .strictObject({ ...form, kind: z.literal('radio_group'), options })
  .meta({ id: 'RadioGroupComponent' });

export const multiSelectComponentSchema = z
  .strictObject({ ...form, kind: z.literal('multi_select'), options })
  .meta({ id: 'MultiSelectComponent' });

export const checkboxGroupComponentSchema = z
  .strictObject({ ...form, kind: z.literal('checkbox_group'), options })
  .meta({ id: 'CheckboxGroupComponent' });

export const countrySelectComponentSchema = z
  .strictObject({ ...form, kind: z.literal('country_select'), allowedCountries: countries })
  .meta({ id: 'CountrySelectComponent' });

/**
 * C148.2: street lines, city, subdivision, postal code and country, each bound to its own field
 * (its declared field set, C148.3); no autocomplete (C177).
 */
export const addressComponentSchema = z
  .strictObject({
    ...base,
    kind: z.literal('address'),
    labelKey: i18nKeySchema,
    hintKey: i18nKeySchema.optional(),
    required: z.boolean().optional(),
    fields: z.strictObject({
      street1: fieldKeySchema,
      street2: fieldKeySchema.optional(),
      city: fieldKeySchema,
      subdivision: fieldKeySchema.optional(),
      postalCode: fieldKeySchema,
      country: fieldKeySchema,
    }),
    allowedCountries: countries,
  })
  .meta({ id: 'AddressComponent' });

// Buttons ---------------------------------------------------------------------------------------

/** C162.3: the version's typed `https:` link fields a link button may open. */
export const LINK_FIELDS = ['help-url', 'privacy-url'] as const;

/**
 * C148.1, C148.2: `submit` exits through `next` (the default) or `button:<key>`; `cancel` asks for
 * confirmation and then cancels the session; `link` opens one of the version's link fields with
 * `rel="noopener noreferrer"`.
 */
export const buttonComponentSchema = z
  .strictObject({
    ...base,
    kind: z.literal('button'),
    labelKey: i18nKeySchema,
    action: z.enum(['submit', 'cancel', 'link']),
    /** `submit` only: the key of its `button:<key>` port; absent means `next`. */
    port: z.string().regex(PORT_KEY_PATTERN, 'must be a snake_case key').optional(),
    /** `link` only. */
    link: z.enum(LINK_FIELDS).optional(),
  })
  .refine((button) => button.port === undefined || button.action === 'submit', {
    message: 'only a submit button has a port',
    path: ['port'],
  })
  .refine((button) => (button.action === 'link') === (button.link !== undefined), {
    message: 'a link button names its link, and only a link button does',
    path: ['link'],
  })
  .meta({ id: 'ButtonComponent' });

// Containers ------------------------------------------------------------------------------------

/** Containers nest components; the depth cap (3) is a graph rule (`../graph.ts`). */
export const containerComponentSchema = z
  .strictObject({
    ...base,
    kind: z.literal('container'),
    direction: z.enum(['vertical', 'horizontal']),
    get children() {
      return z.array(componentSchema).min(1).max(FLOW_V2_CAPS.componentsPerScreen);
    },
  })
  .meta({ id: 'ContainerComponent' });

/** The help slot of C162.3 is rendered after it, in a fixed place (3.2.6). */
export const footerComponentSchema = z
  .strictObject({
    ...base,
    kind: z.literal('footer'),
    get children() {
      return z.array(componentSchema).min(1).max(FLOW_V2_CAPS.componentsPerScreen);
    },
  })
  .meta({ id: 'FooterComponent' });

export const componentSchema: z.ZodType<Component> = z
  .lazy(() =>
    z.discriminatedUnion('kind', [
      textComponentSchema,
      imageComponentSchema,
      spacerComponentSchema,
      containerComponentSchema,
      footerComponentSchema,
      stepperComponentSchema,
      textInputComponentSchema,
      textAreaComponentSchema,
      numberComponentSchema,
      dateComponentSchema,
      emailComponentSchema,
      phoneComponentSchema,
      selectComponentSchema,
      radioGroupComponentSchema,
      checkboxComponentSchema,
      checkboxGroupComponentSchema,
      multiSelectComponentSchema,
      countrySelectComponentSchema,
      urlComponentSchema,
      maskedTextComponentSchema,
      addressComponentSchema,
      buttonComponentSchema,
    ]),
  )
  .meta({ id: 'FlowComponent' });

export const COMPONENT_KINDS = [
  'text',
  'image',
  'spacer',
  'container',
  'footer',
  'stepper',
  'text_input',
  'text_area',
  'number',
  'date',
  'email',
  'phone',
  'select',
  'radio_group',
  'checkbox',
  'checkbox_group',
  'multi_select',
  'country_select',
  'url',
  'masked_text',
  'address',
  'button',
] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];

/** The kinds that bind a field (C148.3); `address` binds its declared set. */
export const FORM_COMPONENT_KINDS = [
  'text_input',
  'text_area',
  'number',
  'date',
  'email',
  'phone',
  'select',
  'radio_group',
  'checkbox',
  'checkbox_group',
  'multi_select',
  'country_select',
  'url',
  'masked_text',
  'address',
] as const satisfies readonly ComponentKind[];

type Leaf =
  | z.infer<typeof textComponentSchema>
  | z.infer<typeof imageComponentSchema>
  | z.infer<typeof spacerComponentSchema>
  | z.infer<typeof stepperComponentSchema>
  | z.infer<typeof textInputComponentSchema>
  | z.infer<typeof textAreaComponentSchema>
  | z.infer<typeof numberComponentSchema>
  | z.infer<typeof dateComponentSchema>
  | z.infer<typeof emailComponentSchema>
  | z.infer<typeof phoneComponentSchema>
  | z.infer<typeof selectComponentSchema>
  | z.infer<typeof radioGroupComponentSchema>
  | z.infer<typeof checkboxComponentSchema>
  | z.infer<typeof checkboxGroupComponentSchema>
  | z.infer<typeof multiSelectComponentSchema>
  | z.infer<typeof countrySelectComponentSchema>
  | z.infer<typeof urlComponentSchema>
  | z.infer<typeof maskedTextComponentSchema>
  | z.infer<typeof addressComponentSchema>
  | z.infer<typeof buttonComponentSchema>;

export interface ContainerComponent {
  id: string;
  kind: 'container';
  direction: 'vertical' | 'horizontal';
  visibleWhen?: Record<string, unknown> | undefined;
  enabledWhen?: Record<string, unknown> | undefined;
  children: Component[];
}

export interface FooterComponent {
  id: string;
  kind: 'footer';
  visibleWhen?: Record<string, unknown> | undefined;
  enabledWhen?: Record<string, unknown> | undefined;
  children: Component[];
}

export type Component = Leaf | ContainerComponent | FooterComponent;
export type ComponentOption = z.infer<typeof componentOptionSchema>;
