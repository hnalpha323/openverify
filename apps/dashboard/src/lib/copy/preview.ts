/**
 * C155.9, decision 33 (Workflow 9C, `dashboard-preview`): the English strings of the template
 * preview, simulate, the presets and the workflow canvas overlay, so translating the console later is
 * a data change. Our own words. Functions build the strings that carry a value; none carries a
 * person's value (a simulated scope or a preset's values never appear in copy).
 */
import { defineCopy } from './catalog';

export const PREVIEW_COPY = defineCopy({
  page: {
    title: 'Preview',
    metadataTitle: 'Template preview',
    breadcrumb: 'Preview',
    description:
      'See a draft on real screens and walk its paths with synthetic values. Nothing here creates an inquiry, calls a provider or stores a run.',
    versionLabel: 'Version',
    versionNumber: (number: number) => `Version ${String(number)}`,
    draftBadge: 'Draft',
  },
  banner: {
    heading: 'What differs from a live flow',
    items: {
      camera: 'No camera and no uploads: capture steps are still placeholders.',
      checks: 'No checks run and no provider is called: every outcome is simulated.',
      validations:
        'The server-side validations do not run here: patterns, field writes and consent digests.',
      stored: 'Nothing is stored: no inquiry, no run and no step record.',
      // C221.9 (Phase 10): the Android SDK renders the same steps natively.
      android:
        'The Android app draws these screens with the system font and Material components, so its screens differ from this preview in type and shape.',
    },
  },
  frame: {
    title: 'Flow preview',
    regionLabel: 'Flow preview frame',
    sameOrigin:
      'The preview cannot be shown: the flow is served from the console’s own origin. Serve the flow from a different origin (OPENVERIFY_FLOW_PUBLIC_URL), so the preview frame keeps its own origin.',
    notConfigured:
      'The preview cannot be shown: the flow origin is not configured (OPENVERIFY_FLOW_PUBLIC_URL).',
    configurationError: 'Configuration error',
    waiting: 'Waiting for the preview to start.',
    ready: 'The preview is showing the draft.',
    tooLarge: 'The preview document is too large to send to the frame (more than 1 MiB).',
    malformed: 'The preview could not read the document it was sent.',
    assetRefused: 'The preview refused a theme asset: it was not a PNG, JPEG, WebP or WOFF2 file.',
    unknownError: 'The preview reported an error.',
    navigated: (step: string) => `The preview is showing step ${step}.`,
  },
  controls: {
    groupLabel: 'Preview settings',
    viewport: 'Width',
    viewportOption: (width: number) => `${String(width)} px`,
    scheme: 'Colour scheme',
    schemes: { light: 'Light', dark: 'Dark', auto: 'Automatic' },
    locale: 'Language',
    pseudoLocale: (locale: string) =>
      locale === 'en-XA'
        ? 'en-XA (pseudo-locale: accented and longer)'
        : 'ar-XB (pseudo-locale: right to left)',
    step: 'Step',
    outcome: 'Simulated outcome of this step',
    outcomes: { passed: 'Passed', failed: 'Failed', needs_review: 'Needs review' },
    outcomeUnset: 'Not set (the placeholder states no outcome)',
    refresh: 'Refresh preview',
  },
  assets: {
    notReadable:
      'The theme’s logo or font is not shown: it could not be read (theme-sets:read is needed).',
    tooLarge: 'The theme’s logo and font are not shown: together they are larger than 1 MiB.',
  },
  contrast: {
    heading: 'Contrast gate',
    failed: 'This palette fails the contrast gate. The preview still shows it, so you can see it.',
    passed: 'This palette passes the contrast gate.',
    scope: 'The gate checks the palette’s pairs, not a whole screen.',
  },
  problems: {
    heading: 'The preview could not be resolved',
    locale: 'Language',
    themeSet: 'Theme',
    styles: 'Styles',
    flow: 'Flow',
    scope: 'Simulated values',
    preset: 'Preset',
    other: 'Request',
    rateLimited:
      'Too many previews in the last minute. The preview waits and tries again; nothing was lost.',
  },
  simulate: {
    heading: 'Simulate a path',
    description:
      'Choose what each verification, check, signal and list answers, and see the path the engine would take. The path is simulated: it is never stored as a run or a step record.',
    run: 'Simulate',
    running: 'Simulating…',
    simulatedLabel: 'Simulated',
    preset: 'Preset',
    noPreset: 'No preset: use the values below',
    presetLabel: 'synthetic values only',
    builtIn: 'Built in',
    scopeHidden:
      'This preset’s values are hidden: you need pii:view to see or edit them. You can still simulate with it.',
    savePreset: 'Save as preset',
    presetName: 'Preset name',
    deletePreset: 'Delete preset',
    deleteConfirm: (name: string) => `Delete the preset “${name}”?`,
    saved: 'Preset saved.',
    deleted: 'Preset deleted.',
    syntheticOnly: 'Use synthetic values only. Never paste a real person’s details here.',
    verifications: 'Verifications',
    verificationStatus: 'Status',
    verificationStatusOption: {
      unset: 'Not simulated (the path waits here)',
      null: 'Unknown (null)',
    },
    checks: 'Check overrides',
    checksHint: 'One per line: check name, then passed, failed, not_applicable or null.',
    extractions: 'Extracted values (JSON)',
    fields: 'Fields (JSON)',
    signals: 'Signals',
    signalsHint: 'Only signals a flow may read before completion can be set.',
    signalState: 'Simulated value',
    signalValue: 'Value',
    signalModes: { unset: 'Not set', null: 'Unknown (null)', set: 'Set to a value' },
    signalUnset: 'Not set',
    signalNull: 'Unknown (null)',
    lists: 'List outcomes',
    listOptions: { unset: 'Not set', matched: 'Matched', none: 'No match', null: 'Unknown (null)' },
    listLabel: (list: string) => `List ${list}`,
    workflowLabel: (step: string) => `Workflow step ${step}`,
    valueExpected: {
      integer: 'a whole number is expected.',
      number: 'a number is expected.',
      boolean: 'true or false is expected.',
    },
    formInvalid: 'Check the simulated values',
    unknownStatusOption: 'Unknown (null)',
    device: 'Device',
    deviceKind: 'Device kind',
    devicePlatform: 'Platform',
    deviceUnset: 'Not set',
    deviceNull: 'Unknown (null)',
    workflows: 'Workflow outputs',
    workflowStatus: 'Run status',
    workflowErrorType: 'Error type',
    workflowOutputs: 'Outputs (JSON)',
    inquiry: 'Inquiry',
    inquiryTags: 'Tags (comma separated)',
    jsonInvalid: (label: string) => `${label} is not valid JSON.`,
    checkLineInvalid: (line: number) =>
      `Line ${String(line)} is not “check name, status” with passed, failed, not_applicable or null.`,
  },
  path: {
    heading: 'Simulated path',
    listLabel: 'Simulated path, step by step',
    port: (port: string) => `Left by ${port}`,
    noPort: 'The path ends here',
    route: (key: string | null) => (key === null ? 'Route: else' : `Route: ${key}`),
    conditionResult: {
      true: 'condition true',
      false: 'condition false',
      null: 'condition unknown',
    },
    onNull: (choice: string) => `onNull used: ${choice}`,
    nullPaths: (paths: string) => `Unknown facts: ${paths}`,
    waited: 'Waited here',
    notes: (notes: string) => `Recorded notes: ${notes}`,
    facts: 'Facts the route read',
    factSource: {
      verification: 'verification',
      server: 'server',
      person: 'self-asserted',
      client: 'client-reported',
      operator: 'operator',
    },
    factTier: (tier: string | null) => (tier === null ? 'no tier' : `tier ${tier}`),
    factStage: (stage: string | null) => (stage === null ? 'no stage' : `stage ${stage}`),
    beta: 'Beta heuristic',
    outcome: 'Outcome',
    outcomeStatus: (status: string) => `Inquiry status: ${status.replaceAll('_', ' ')}`,
    verificationTypes: 'Verifications on the path',
    fallbacks: 'Fallbacks taken',
    flags: 'Flags',
    none: 'None',
    halted: (reason: string) => `The path stopped: ${reason}`,
    pending:
      'The path stops before a completion: a verification or workflow on it has no simulated status.',
    differencesLabel: 'How a live inquiry can differ from this simulated path',
    differences: {
      failureStep:
        'A failure step is shown failed here, even where the decision record a live inquiry keeps would send it to review instead: the consent the person recorded is not simulated.',
      nullSignal:
        'An unknown (null) signal has no reason here, so it never counts as needs review, while an errored check, also unknown, always does in a live inquiry.',
    },
  },
  overlay: {
    heading: 'Test run over the draft',
    listLabel: 'Test run path, step by step',
    description:
      'The sandbox test run drawn over the version: each step’s state as an icon and a word, on the list and on the read-only canvas.',
    simulatedEffect: 'its effect was simulated',
    pick: 'Test run',
    none: 'No test run selected',
    noRuns: 'No sandbox test run yet. Start one from the test runs page.',
    states: {
      succeeded: 'Succeeded',
      failed: 'Failed',
      skipped: 'Skipped',
      waiting: 'Waiting',
      overridden: 'Overridden',
    },
  },
});

export type PreviewCopy = typeof PREVIEW_COPY;
