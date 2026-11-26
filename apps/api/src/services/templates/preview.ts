/**
 * `POST /inquiry-template-versions/:id/preview` (C156.1; Workflow 9B, `api-templates-finish`; the
 * orchestrator's decisions before 9B, 1): the preview document of a stored version or of an unsaved
 * body, which the console posts to the flow's preview entry (C156.2, C156.3). It holds every
 * renderable step's client view (C151.5's `step` form), the resolved theme with the contrast gate's
 * answer (`api-themes`' `resolveThemeForVersion`, B46: a failing palette is answered, not refused,
 * review H15), the copy for `meta.locale` (`pseudoLocalizeTree` for `en-XA` and `ar-XB`, C161.7)
 * and configuration-only guidance; never inquiry data. The route counts `template-preview` first.
 */
import { readFileSync } from 'node:fs';
import type {
  PreviewInquiryTemplateVersionBody,
  TemplateCopy,
  TemplateLocale,
  templatePreviewDocumentSchema,
} from '@openverify/contracts';
import { getEnvironment, resolveFaceTemplateSettings } from '@openverify/db';
import {
  clientViewOf,
  COPY_KEYS,
  isFlowV2,
  isPseudoLocale,
  migrateFlow,
  pseudoLocalizeTree,
  safeParseAnyFlow,
  type ClientStepView,
  type FlowV2,
} from '@openverify/flow-spec';
import type { z } from 'zod';
import { UnprocessableContentError } from '../../errors.js';
import type { ApiDependencies } from '../context.js';
import { findVersion } from '../inquiry-templates.js';
import { checkThemeSetChoice } from '../themes/settings.js';
import { resolveThemeForVersion } from '../themes/resolve.js';
import { storedCopy } from './versions.js';
import { shareConsentPreviewView } from '../flow-views/share-consent.js';

export type TemplatePreviewDocument = z.infer<typeof templatePreviewDocumentSchema>;
type PreviewAttributes = TemplatePreviewDocument['data']['attributes'];

/** What the preview's copy is resolved from. */
export interface PreviewCopyInput {
  copy: TemplateCopy;
  enabledLocales: readonly TemplateLocale[];
  defaultLocale: TemplateLocale;
  locale: PreviewAttributes['locale'];
}

/** The placeholder values a consent step's texts are filled with in a live session. */
export interface ConsentGuidance {
  days: number;
  organization: string | null;
}

/** C161.7: the locale the pseudo-locales are generated from. */
const PSEUDO_SOURCE_LOCALE: TemplateLocale = 'en';

let englishCatalog: Readonly<Record<string, string>> | undefined;

/** Every message of a catalog tree under its dotted key. */
function flattened(tree: Readonly<Record<string, unknown>>, prefix = ''): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    if (typeof value === 'string') {
      flat[`${prefix}${key}`] = value;
    } else if (typeof value === 'object' && value !== null) {
      Object.assign(flat, flattened(value as Record<string, unknown>, `${prefix}${key}.`));
    }
  }
  return flat;
}

/**
 * The flow's built-in `en` catalog, read once: `contracts/fixtures/i18n/en.json`, which `flow-i18n`
 * exports from the TypeScript catalogs and a test holds equal to them (C161.8), as the consent check
 * reads `consent-texts.json` beside it.
 */
function builtInEnglish(): Readonly<Record<string, string>> {
  englishCatalog ??= flattened(
    (
      JSON.parse(
        readFileSync(
          new URL('../../../../../contracts/fixtures/i18n/en.json', import.meta.url),
          'utf8',
        ),
      ) as { messages: Record<string, unknown> }
    ).messages,
  );
  return englishCatalog;
}

/**
 * The operator texts a session in `locale` shows, as far as the server can resolve C162.5's order
 * (the locale's text, its built-in text, the default locale's text, its built-in text): the
 * locale's own text; for a component key, which has no built-in text, else the default locale's;
 * a built-in key without the locale's own text is left to the client's catalog. Only enabled
 * locales are read.
 */
function operatorCopy(
  copy: TemplateCopy,
  locale: TemplateLocale,
  enabledLocales: readonly TemplateLocale[],
  defaultLocale: TemplateLocale,
): Record<string, string> {
  const enabled = new Set(enabledLocales);
  const textsOf = (of: TemplateLocale) => (enabled.has(of) ? (copy.messages[of] ?? {}) : {});
  const own = textsOf(locale);
  const fallback = textsOf(defaultLocale);
  const resolved: Record<string, string> = {};
  for (const key of new Set(enabledLocales.flatMap((of) => Object.keys(textsOf(of))))) {
    const text = own[key] ?? (COPY_KEYS[key] === undefined ? fallback[key] : undefined);
    if (text !== undefined) {
      resolved[key] = text;
    }
  }
  return resolved;
}

/**
 * The copy the preview document carries for its locale (C156.1): for an enabled locale, the operator
 * texts a session in it shows (the client's catalog fills every built-in key left out); for `en-XA`
 * or `ar-XB`, every text an `en` session shows, the built-in catalog's included, through the
 * pseudo-locale transform (C161.7), so nothing reaches the preview untransformed.
 */
export function previewCopy(input: PreviewCopyInput): Record<string, string> {
  const { copy, enabledLocales, defaultLocale, locale } = input;
  if (!isPseudoLocale(locale)) {
    return operatorCopy(copy, locale, enabledLocales, defaultLocale);
  }
  return pseudoLocalizeTree(locale, {
    ...builtInEnglish(),
    ...operatorCopy(copy, PSEUDO_SOURCE_LOCALE, enabledLocales, defaultLocale),
  });
}

/** C2: the sides a government ID step's `sides` asks the person to capture, in order. */
const SIDES = { front: ['front'], back: ['back'], both: ['front', 'back'] } as const;

/**
 * The preview's synthetic guidance (C156.1), configuration only: the sides each government ID step
 * asks for, the poses each selfie step prompts, and the values a consent step's texts are filled
 * with (`{days}`, `{organization}`). Never inquiry data, and never a field's value or default (a
 * field default is personal data in logs, C174.5), so a screen has none.
 */
export function previewGuidance(
  steps: readonly ClientStepView[],
  consent: ConsentGuidance,
): PreviewAttributes['guidance'] {
  const guidance: PreviewAttributes['guidance'] = {};
  for (const step of steps) {
    if (step.type === 'consent') {
      guidance[step.id] = { days: consent.days, organization: consent.organization };
    } else if (step.type === 'government_id') {
      guidance[step.id] = { sides: [...SIDES[step.sides]] };
    } else if (step.type === 'selfie') {
      guidance[step.id] = { poses: [...step.poses] };
    }
  }
  return guidance;
}

/** The flow to preview, as the engine walks it: a flow-spec 1 flow through its migration. */
function previewedFlow(flow: unknown): FlowV2 {
  const parsed = safeParseAnyFlow(flow);
  if (!parsed.success) {
    throw new UnprocessableContentError('The version holds no flow that can be previewed.', [
      {
        location: 'body',
        pointer: '/data/attributes/flow',
        detail: 'The stored flow cannot be read; send a flow to preview.',
      },
    ]);
  }
  return isFlowV2(parsed.data) ? parsed.data : migrateFlow(parsed.data);
}

/**
 * The preview document of the version `id` of the environment (C156.1): the stored version, with
 * the body's unsaved `flow`, `copy`, `theme-set-id` and `styles` in place of the stored ones. The
 * body's `field-schemas` change nothing in the document, which carries no field value. Nothing is
 * stored, audited or sent.
 * @throws {NotFoundError} for a version outside the environment.
 * @throws {UnprocessableContentError} for a locale the version does not enable (`/meta/locale`), a
 *   theme set that is not an active set of the environment (`/data/attributes/theme-set-id`),
 *   styles that contradict themselves (under `/data/attributes/styles`), or a stored flow that
 *   cannot be read.
 */
export async function previewTemplateVersion(
  deps: ApiDependencies,
  environmentId: string,
  id: string,
  body: PreviewInquiryTemplateVersionBody,
): Promise<TemplatePreviewDocument> {
  const { db } = deps;
  const version = await findVersion(db, environmentId, id);
  const attributes = body.data?.attributes ?? {};
  const { locale } = body.meta;
  if (!isPseudoLocale(locale) && !(version.enabledLocales as readonly string[]).includes(locale)) {
    throw new UnprocessableContentError('The locale is not one this version enables.', [
      {
        location: 'body',
        pointer: '/meta/locale',
        detail: 'Use an enabled locale of the version, or the pseudo-locale en-XA or ar-XB.',
      },
    ]);
  }
  const bodySetId = attributes['theme-set-id'];
  if (bodySetId !== undefined) {
    await checkThemeSetChoice(db, {
      environmentId,
      themeSetId: bodySetId,
      pointer: '/data/attributes/theme-set-id',
    });
  }
  const { theme, contrast } = await resolveThemeForVersion(db, {
    environmentId,
    themeSetId: bodySetId === undefined ? version.themeSetId : bodySetId,
    ...(attributes.styles === undefined ? {} : { styles: attributes.styles }),
  });
  const steps = previewedFlow(attributes.flow ?? version.flow).steps.flatMap((step) => {
    // C238.3 (Workflow 11A Stage 1b (K), `foundation-11a`'s hook): a `share_consent` step previews
    // as a labelled sample with no connection (`api-consent`'s), never as an uncomposed text.
    const view =
      clientViewOf(step) ?? (step.type === 'share_consent' ? shareConsentPreviewView(step) : null);
    return view === null ? [] : [view];
  });
  const settings = (await getEnvironment(db, environmentId))?.settings ?? {};
  const organization = settings['organization-display-name'];
  return {
    data: {
      type: 'inquiry-template-preview',
      id,
      attributes: {
        locale,
        'spec-version': 2,
        steps,
        theme,
        contrast,
        copy: previewCopy({
          copy: attributes.copy ?? storedCopy(version),
          enabledLocales: version.enabledLocales,
          defaultLocale: version.defaultLocale,
          locale,
        }),
        guidance: previewGuidance(steps, {
          days: resolveFaceTemplateSettings(settings)['face-template-retention-days'],
          organization: typeof organization === 'string' ? organization : null,
        }),
      },
    },
  };
}
