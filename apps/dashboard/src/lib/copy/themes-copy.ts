/**
 * C155.9, decision 33 (Workflow 9C, `dashboard-themes-copy`): the English strings of theme sets,
 * their editor and contrast, the template's theme and translations pages, the locale review status
 * and the builder's theme and copy panels, so translating the console later is a data change. Our
 * own words. A function builds a string that carries a value; none carries a person's value, a
 * colour an operator typed, or a text an operator wrote.
 */
import { defineCopy } from './catalog';

export const THEMES_COPY = defineCopy({
  list: {
    title: 'Theme sets',
    loading: 'Loading theme sets…',
    loadError: 'The theme sets could not be loaded.',
    description:
      'How your verification flows look in this environment: colours, corner radius, font and logo. A saved change reaches every flow that uses the set at its next session load.',
    filterLabel: 'Filter theme sets',
    statusLabel: 'Status',
    statusAny: 'Any status',
    apply: 'Apply',
    tableCaption: 'Theme sets',
    name: 'Name',
    status: 'Status',
    revision: 'Revision',
    default: 'Default',
    updated: 'Updated (UTC)',
    isDefault: 'Default set',
    emptyTitle: 'No theme sets yet',
    emptyBody:
      'Without a theme set, flows use the built-in look. Create a set to give them your colours and logo.',
    emptyFiltered: 'No theme sets match this filter.',
    emptyMore: 'No more theme sets.',
    createHeading: 'Create a theme set',
    createName: 'Name',
    createHint:
      'A new set starts with every cell built in. Change what you need, then save; each save is a revision.',
    createSubmit: 'Create theme set',
    created: 'The theme set was created.',
    builtInNote:
      'The built-in look applies wherever no set is chosen: on the inquiry, on its template version, or as the environment default.',
  },
  status: {
    active: 'Active',
    archived: 'Archived',
  },
  set: {
    metadataTitle: 'Theme set',
    revisionLine: (revision: number) =>
      `Revision ${String(revision)}: flows that use this set render this revision, and each session names the revision it rendered.`,
    archivedNote:
      'This set is archived: it cannot be edited or restored. Flows that used it fall back to the environment default, else the built-in look. Published template versions are not rewritten.',
    defaultBadge: 'Default set of this environment',
    actionsLabel: 'Theme set actions',
    makeDefault: 'Make default',
    makeDefaultTitle: 'Make this the default theme set?',
    makeDefaultBody:
      'Every flow in this environment whose inquiry and template version choose no set will use it from its next session load.',
    madeDefault: 'This is now the default theme set.',
    clearDefault: 'Stop using as default',
    clearDefaultTitle: 'Stop using this set as the default?',
    clearDefaultBody:
      'Flows that choose no set will use the built-in look from their next session load.',
    clearedDefault: 'The environment has no default theme set now.',
    duplicate: 'Duplicate',
    duplicateTitle: 'Duplicate this theme set?',
    duplicateBody:
      'A new active set is created with this revision’s styles, named after this one. Its own revisions start at 1.',
    duplicateName: (name: string) => `${name} (copy)`.slice(0, 100),
    duplicated: 'The copy was created.',
    archive: 'Archive',
    archiveTitle: 'Archive this theme set?',
    archiveBody:
      'Flows that use it fall back to the environment default, else the built-in look, at their next session load. Published template versions keep naming it. An archived set cannot be edited.',
    archived: 'The theme set was archived.',
    renameHeading: 'Name',
    renameSubmit: 'Rename',
    renamed: 'The theme set was renamed.',
  },
  editor: {
    heading: 'Styles',
    description:
      'Colours are six-digit hex values such as #1447e6. Leave a cell empty to keep the built-in value. Contrast is checked as you type, with the same function the API runs on every save.',
    darkToggle: 'Offer a dark variant',
    darkHint:
      'When on, flows follow the device’s light or dark setting. The dark palette is checked either way, so a set never stores a failing dark palette.',
    preferredLabel: 'Variant shown first',
    light: 'Light',
    dark: 'Dark',
    paletteLegend: (variant: string) => `${variant} palette`,
    builtIn: (value: string) => `Built in: ${value}`,
    swatchLabel: (token: string) => `Colour of ${token}`,
    tokenWords: {
      primary: 'Primary (buttons and links)',
      'primary-hover': 'Primary, hovered',
      'on-primary': 'Text on primary and danger buttons',
      danger: 'Danger (errors)',
      'danger-hover': 'Danger, hovered',
      surface: 'Surface (cards)',
      canvas: 'Canvas (page background)',
      ink: 'Ink (text)',
      'ink-muted': 'Muted text',
      line: 'Line (separators, decorative only)',
      control: 'Control outline',
      focus: 'Focus ring',
    },
    notHex: 'Use a six-digit hex value in lower case, such as #1447e6, or leave the cell empty.',
    radius: 'Corner radius (0 to 24 CSS px)',
    radiusInvalid:
      'Use a whole number from 0 to 24, or leave it empty to keep the built-in radius.',
    radiusHint: (value: number) => `Built in: ${String(value)} px.`,
    fontLegend: 'Font',
    fontSystem: 'The device’s system font',
    fontUploaded: 'An uploaded font',
    fontAsset: 'Font asset',
    fontNone: 'Upload a font below first.',
    fontNote:
      'An uploaded font is used by the web flow only; the Android SDK keeps its system font. The system font remains the fallback.',
    logoLegend: 'Logo',
    logoNone: 'No logo',
    logoAsset: 'Logo asset',
    logoDecorative: 'The logo is decorative',
    logoDecorativeHint:
      'A decorative logo is hidden from screen readers, and your organisation’s display name is shown as text beside it.',
    logoAltKey: 'Copy key of the logo’s text alternative',
    logoAltHint: 'Give its text per language on the template’s translations page.',
    save: 'Save styles',
    saving: 'Saving…',
    saved: (revision: number) => `Saved as revision ${String(revision)}.`,
    readOnly: 'You can read these styles; changing them needs theme-sets:write.',
    realScreens: {
      heading: 'Preview on real screens',
      note: 'The unsaved styles shown on a template’s screens, in the flow’s own preview: nothing is saved and no inquiry is made. The template’s current version is used.',
      template: 'Template',
      scheme: 'Variant',
      show: 'Preview these styles',
      showing: 'Loading the preview…',
      noTemplates: 'Reading templates needs inquiry-templates:read; the swatches above stand in.',
      empty: 'This environment has no template to preview with yet.',
    },
    previewHeading: 'Swatches',
    previewNote:
      'A sketch of the palette, not a flow screen. The template preview shows real screens with these unsaved styles once it is available.',
    previewSample: 'Sample text',
    previewMuted: 'Muted text',
    previewButton: 'Continue',
    previewError: 'Error message',
  },
  contrast: {
    heading: 'Contrast',
    caption: (variant: string) => `${variant} palette: every pair the gate checks`,
    foreground: 'Foreground',
    background: 'Background',
    purpose: 'Used for',
    ratio: 'Ratio (unrounded)',
    required: 'Required',
    result: 'Result',
    ratioValue: (ratio: number) => `${String(ratio)}:1`,
    requiredValue: (required: number) => `${String(required)}:1`,
    pass: 'Passes',
    warn: 'Passes, below 7:1 (warning only)',
    fail: 'Fails: a save is refused',
    purposeWords: {
      text: 'Text',
      link: 'Links (underlined)',
      'button-label': 'Button labels',
      control: 'Control outlines',
      focus: 'Focus ring',
    },
    summary: (failures: number, warnings: number) =>
      failures === 0
        ? `Every pair meets its minimum${warnings === 0 ? ' and 7:1.' : `; ${String(warnings)} text pairs are below 7:1, which only warns.`}`
        : `${String(failures)} pairs are below their minimum: the API will refuse this save.`,
    lineNote:
      'The line colour has no pair: it draws separators only, which are decorative. Form controls are outlined with the control colour.',
    notCovered: 'What this check does not cover',
    notCoveredItems: {
      screens:
        'It proves the palette’s pairs, not a screen: the accessibility audit checks screens.',
      images: 'Text over images.',
      logo: 'The logo’s own contrast.',
      fonts: 'Thin fonts and anti-aliasing.',
      forcedColours: 'Forced colours (such as Windows high contrast).',
      embedding: 'The page around an embedded flow.',
      copy: 'Your own copy.',
    },
    refusedHeading: 'The API refused the save: these pairs are below their minimum',
    refusedPair: (foreground: string, background: string, ratio: number, required: number) =>
      `${foreground} on ${background}: ${String(ratio)}:1, needs ${String(required)}:1`,
  },
  assets: {
    heading: 'Logo and font files',
    description:
      'A logo is a PNG, JPEG or WebP image of at most 256 KiB and 2,048 px a side; it is re-encoded before it is stored. A font is a WOFF2 file of at most 512 KiB. SVG is not accepted.',
    kind: 'Kind of file',
    logo: 'Logo',
    font: 'Font',
    file: 'File',
    attest:
      'I confirm that our licence for this font allows embedding it in web pages. The font is ours, not OpenVerify’s: OpenVerify ships no font.',
    unicodeRange: 'Unicode range (optional, fonts only)',
    unicodeRangeHint:
      'Such as U+0000-00FF. Characters outside it use the system font, so a script the font lacks still renders.',
    submit: 'Upload',
    uploaded: (kind: string, id: string) =>
      `The ${kind} was stored as ${id}. Choose it in the styles above, then save.`,
    kindWords: { logo: 'logo', font: 'font' },
    uploadedHeading: 'Uploaded in this visit',
    previewAlt: 'The uploaded logo',
    sizeLine: (width: number, height: number) => `${String(width)} × ${String(height)} px`,
    attestedLine: (at: string) => `Licence confirmed ${at} (UTC)`,
    noAssetList:
      'The API lists no stored files: note an asset id when you upload, or read it from a revision.',
  },
  revisions: {
    heading: 'Revisions',
    description:
      'Every save is kept, newest first. Restoring copies an earlier revision into a new one; it goes live as any save does, after the contrast check.',
    caption: 'Revisions',
    revision: 'Revision',
    created: 'Saved (UTC)',
    by: 'Saved by',
    origin: 'Origin',
    edit: 'An edit',
    restoredFrom: (revision: number) => `Restored from revision ${String(revision)}`,
    current: 'In use',
    restore: 'Restore',
    restoreTitle: (revision: number) => `Restore revision ${String(revision)}?`,
    restoreBody:
      'A new revision is saved with this revision’s name and styles, and flows that use the set render it from their next session load.',
    restored: (revision: number) => `Restored as revision ${String(revision)}.`,
    older: 'Older revisions',
  },
  problems: {
    theme_set_default:
      'This set is the environment’s default, so it cannot be archived. Make another set the default, or stop using it as the default, first.',
    asset_type_refused:
      'The file was refused: a logo must be a PNG, JPEG or WebP image and a font a WOFF2 file. SVG is not accepted.',
    theme_contrast_insufficient:
      'A palette pair is below its contrast minimum, so nothing was saved. The pairs are listed under Contrast.',
    busy: 'The image service is busy, so the logo was not stored. Try again in a few seconds.',
    tooLarge: 'The file is larger than its kind allows.',
    tooManyPixels:
      'The logo is larger than 2,048 px a side, or its re-encoded form passed 256 KiB.',
    tooManyUploads: 'Too many uploads in this environment this hour. Try again later.',
    fontFromKey:
      'The upload was refused: it needs theme-sets:write, and a font is uploaded by a person, who confirms its licence.',
    archivedEdit: 'This set is archived, so it cannot be changed.',
    revisionMissing: 'That revision does not exist for this set.',
  },
});

/** The template's theme tab, translations page, the locale review status and the builder panels. */
export const COPY_COPY = defineCopy({
  themeTab: {
    title: 'Theme',
    metadataTitle: 'Template theme',
    description:
      'Which theme set this template’s flows render. An inquiry may name its own set; otherwise the version’s set applies, else the environment’s default set, else the built-in look.',
    versionHeading: (number: number) => `Version ${String(number)}`,
    draftBadge: 'Draft',
    currentBadge: 'Published',
    choiceLabel: 'Theme set',
    environmentDefault: (name: string | null) =>
      name === null
        ? 'The environment’s default set (none today: the built-in look)'
        : `The environment’s default set (today: ${name})`,
    archivedChoice: (id: string) => `${id} (archived: flows fall back to the default)`,
    save: 'Save the draft',
    saved: 'The draft now names this theme set. It applies once the draft is published.',
    noDraft:
      'Published versions cannot change. Create a draft on the template’s overview to choose another set.',
    readOnly: 'You can read this choice; changing it needs inquiry-templates:write.',
    stale:
      'The draft changed since this page was opened, so nothing was saved. Reload the page to see the latest draft, then choose again.',
    noSets: 'This environment has no active theme set yet.',
    manageSets: 'Manage theme sets',
    publishNote:
      'At publish the API checks that the set is still an active set of this environment.',
  },
  translations: {
    title: 'Translations',
    metadataTitle: 'Template translations',
    description:
      'The texts this template’s flow shows, per language: the built-in texts you may reword and your screens’ own texts. Plain text only, with the placeholders each text allows.',
    sourceLine: (number: number, draft: boolean) =>
      `From version ${String(number)}${draft ? ' (draft)' : ' (published; a save makes a draft from it)'}.`,
    neverPublishes:
      'Saving writes the draft only; nothing is published until someone publishes it.',
    blankKeeps:
      'An empty cell keeps the text the draft holds: an import never deletes. To remove a text, edit the draft’s copy in the flow builder.',
    tableCaption: 'Texts per language',
    key: 'Text',
    rules: 'Rules',
    maxLength: (count: number) => `At most ${String(count)} characters`,
    placeholders: (names: string) => (names === '' ? 'No placeholder' : `Placeholders: ${names}`),
    multiline: 'Line breaks allowed',
    oneLine: 'One line',
    legal: (kind: string) => `Legal weight: ${kind}`,
    consent: 'Consent text',
    componentText: 'Screen text',
    builtInText: 'Built-in text',
    cellLabel: (key: string, locale: string) => `${key}, ${locale}`,
    addKey: 'Add a text',
    addKeyLabel: 'Text to add',
    addKeySubmit: 'Add',
    noRows: 'No text is reworded yet. Add a built-in text or a screen text to give it.',
    save: 'Save texts',
    saving: 'Saving…',
    saved: (count: number) => `${String(count)} texts were saved to the draft.`,
    nothingChanged: 'Change at least one text before saving.',
    refusedHeading: 'Nothing was saved: some texts break a rule',
    refusedCell: (key: string, locale: string, words: string) => `${key} (${locale}): ${words}`,
    readOnly: 'You can read these texts; changing them needs inquiry-templates:write.',
    validationHeading: 'Problems the draft holds',
  },
  codes: {
    copy_empty: 'The text is empty.',
    copy_too_long: 'The text is longer than this text allows.',
    copy_control_character:
      'The text holds a control character, or a line break where only one line is allowed.',
    copy_bidi_override:
      'The text holds a bidirectional embedding or override character (U+202A to U+202E), which makes it read differently from how it is stored.',
    copy_format_character:
      'The text holds an invisible format character. Only the marks U+200E and U+200F are allowed, and none in a text with legal weight.',
    copy_bidi_unbalanced: 'A bidirectional isolate (U+2066 to U+2068) is not closed by U+2069.',
    copy_markup: 'The text holds markup. Copy is plain text: no HTML, Markdown, links or entities.',
    copy_placeholder_invalid:
      'Braces may only stand around a placeholder name, such as {organization}.',
    copy_placeholder_unknown: 'The text uses a placeholder this text does not take.',
    copy_key_unknown: 'No built-in text or screen of this flow has this key.',
    consent_copy_missing_placeholder:
      'A biometric consent text must state the retention period through {days}, which the server fills.',
    consent_copy_incomplete:
      'A reworded consent text must be given in every enabled language: a fallback would record consent to words you did not write.',
    locale_unsupported:
      'This language is not one of the five built-in base languages (en, es, fr, de, ar), or the draft does not enable it. Region tags such as ar-EG are not accepted.',
    legal_copy_overridden:
      'This text has legal weight: in production, publishing needs the acknowledgement legal-copy:<key>.',
    locale_unreviewed:
      'A language whose built-in legal texts nobody has reviewed is enabled: in production, publishing needs the acknowledgement locale-unreviewed:<language>.',
    unknown: 'The text breaks a rule of the API.',
  },
  locales: {
    heading: 'Languages',
    description:
      'The languages the flow offers, and the one it falls back to. Base language tags only: the flow formats dates and numbers with the person’s full tag.',
    enabled: 'Enabled languages',
    defaultLocale: 'Default language',
    save: 'Save languages',
    saved: 'The draft’s languages were saved.',
    noDraft: 'Create a draft to change the languages.',
    names: { en: 'English', es: 'Spanish', fr: 'French', de: 'German', ar: 'Arabic' },
    statusCaption: 'Review status of the built-in texts',
    statusHeader: 'Review status',
    status: {
      source: 'Source language: every other catalog translates it.',
      'machine-drafted':
        'Machine-drafted: written by the build agents with no human review. Its consent, notice, decision and retention texts are drafts.',
      'partially-reviewed': (keys: string) =>
        `Partly reviewed: these texts changed after the review and are drafts: ${keys}.`,
      reviewed: (by: string, date: string) => `Reviewed by ${by} on ${date}.`,
    },
    unreviewedNote:
      'In production, publishing a version that enables a language that is not reviewed, where its built-in legal texts are shown, needs the acknowledgement locale-unreviewed:<language>. Sandbox warns only.',
  },
  rules: {
    consentHeading: 'Consent texts',
    consentItems: {
      everyLocale:
        'A reworded consent text must be given in every enabled language, or the version is not published (consent_copy_incomplete).',
      days: 'A reworded biometric consent text must state the retention period through {days}, which the server fills from the face-template retention setting (consent_copy_missing_placeholder).',
      legal:
        'In production, rewording a text with legal weight needs the acknowledgement legal-copy:<key> at publish. Sandbox warns only.',
      evidence:
        'Each consent the flow records carries the digest of the exact words shown, so a reworded text is recorded as yours.',
    },
    fallbackHeading: 'Which text a person sees',
    fallbackItems: {
      own: 'Your text in the person’s language.',
      builtIn: 'Else the built-in text in that language.',
      defaultOwn: 'Else your text in the default language.',
      defaultBuiltIn: 'Else the built-in text in the default language.',
      never: 'A raw key is never shown.',
    },
    plainHeading: 'Plain text',
    plainItems: {
      noMarkup:
        'No HTML, Markdown, links or entities: a link is a help or privacy URL of the version.',
      placeholders: 'Placeholders are {name}, and only those a text lists.',
      characters:
        'No control characters but line breaks where allowed, no bidirectional overrides, no invisible format characters but U+200E and U+200F, and isolates closed.',
      nfc: 'Texts are stored NFC-normalised.',
      noMachine: 'Nothing is machine-translated: what you save is what the flow shows.',
    },
  },
  csv: {
    heading: 'CSV import and export',
    description:
      'The file has the columns step, component, attribute and one per enabled language. Cells that a spreadsheet would run as a formula are written so they do not, and read back unchanged. At most 2 MiB and 20,000 rows.',
    download: 'Download translations.csv',
    file: 'CSV file',
    upload: 'Import CSV',
    uploading: 'Importing…',
    imported: (count: number) =>
      `The file was imported into the draft, which now holds ${String(count)} reworded texts. Nothing was published.`,
    refusedHeading: 'The file was refused; nothing was imported',
    problem: (where: string, words: string) => `${where}: ${words}`,
    header: 'Header',
    row: (row: number) => `Row ${String(row)}`,
    column: (column: string) => `column ${column}`,
    codes: {
      missing_column: 'A required column is missing or out of place: step, component, attribute.',
      unknown_column: 'A column is not a built-in language.',
      field_count_mismatch: 'The row has more or fewer cells than the header.',
      invalid_encoding: 'The file is not text in a supported encoding; save it as UTF-8.',
      invalid_value: 'A cell could not be read.',
      row_limit_exceeded: 'The file has more than 20,000 rows.',
      record_too_large: 'A row is too long.',
    },
    status: {
      400: 'The file could not be read: choose it again.',
      401: 'Your session ended: sign in again.',
      403: 'Your role cannot import translations: it needs inquiry-templates:write.',
      404: 'This template was not found.',
      409: 'The template changed meanwhile: reload the page and try again.',
      413: 'The file is larger than 2 MiB.',
      415: 'The file must be a CSV file.',
      429: 'Too many imports in this environment this hour: try again later.',
      502: 'The import failed: try again.',
    },
  },
  builder: {
    themeHeading: 'Theme',
    themeHint:
      'The set this version’s flows render. Edits to a set apply live, after the contrast check.',
    copyHeading: 'Languages and copy',
    copyHint:
      'Reword built-in texts and give your screens’ texts per language on the translations page.',
    overrides: (count: number) => `${String(count)} texts reworded`,
    openTranslations: 'Open translations',
    defaultMark: 'default',
  },
});
