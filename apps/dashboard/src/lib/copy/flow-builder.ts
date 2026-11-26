/**
 * The flow builder's words (C155, C155.9; decision 33): `dashboard-flow-builder`'s.
 */
import { defineCopy } from './catalog';

export const FLOW_BUILDER_COPY = defineCopy({
  /** Each v2 step type in words (C147.3). */
  stepTypes: {
    consent: 'Consent',
    government_id: 'Government ID',
    selfie: 'Selfie',
    document: 'Document',
    phone_otp: 'Phone code',
    email_otp: 'Email code',
    database: 'Database',
    aamva: 'Driver licence record (AAMVA)',
    nfc: 'ID chip (NFC)',
    crypto_wallet: 'Crypto wallet',
    database_business: 'Business database',
    business_website: 'Business website',
    device_handoff: 'Move to a phone',
    completion: 'Completion',
    failure: 'Failure',
    screen: 'Screen',
    branch: 'Branch',
    action: 'Action',
    // C238.1 (Workflow 11A): the person's consent to a Connect share.
    share_consent: 'Sharing consent',
  },
  /** Each port in words (C147.4). */
  ports: {
    next: 'Next',
    exhausted: 'When attempts run out',
    else: 'Otherwise (else)',
    error: 'On error',
    route: (label: string) => `Route ${label}`,
    button: (key: string) => `Button ${key}`,
  },
  /** Where each fact a branch reads comes from (C150.10): person and client facts can be chosen. */
  sources: {
    verification: 'Verification',
    server: 'Server',
    person: 'Self-asserted',
    client: 'Client-reported',
    operator: 'Operator (API)',
  },
  outline: {
    label: 'Outline of the flow',
    goTo: (label: string) => `Go to ${label}`,
    notConnected: 'Not connected',
    unreachable: 'Not reachable from the start',
    /** C155.7: a step's mark against the compared version, as the canvas's badge says it. */
    marked: (label: string, mark: 'added' | 'changed') => `${label}, ${mark}`,
  },
  /** C155.7 (Workflow 9D): the draft against the current version, as badges and as a list. */
  comparison: {
    heading: (versionNumber: number) => `Compared with version ${String(versionNumber)}`,
    description:
      'The server’s diff of this draft as saved when the page opened against that version: added and changed steps carry a badge on the canvas and in the outline, and the list says every change, removed steps included. Reload the page to compare again after saving.',
  },
  palette: {
    oneOfEachVerification: (type: string) =>
      `The flow already has a ${type} step; a flow has at most one step of each verification type.`,
    endsTheFlow: (type: string) => `A ${type} step ends the flow; add steps before it.`,
    formNotOffered:
      'There is no form step in flow-spec 2: a screen holds form components instead, and a version 1 form is migrated to one.',
  },
  /** C155.4 (Workflow 9D): the modules, editor macros of plain steps; each says what it inserts. */
  modules: {
    labels: {
      government_id: 'Government ID',
      selfie: 'Selfie',
      document: 'Document',
      database: 'Database',
      phone: 'Phone',
      email: 'Email',
      success: 'Success screen',
      failed: 'Failed screen',
      country_select: 'Country select with branching',
    },
    verification: (type: string, explanation: boolean) =>
      `Inserts ${explanation ? 'an explanation screen, ' : ''}a ${type} step and, when its attempts run out, a fallback screen; both lead where this place led. A failed verification stays failed, and an inquiry that took the fallback goes to review at completion (C150.6).`,
    success: 'Inserts a Completion step: the person’s part ends here as completed.',
    failed:
      'Inserts a Failure step: the person’s part ends here as failed. Publishing may ask for an acknowledgement on a path that fails a person (C150.7).',
    countrySelect:
      'Inserts a screen asking for the country (a country select bound to the field address_country_code) and a branch on it with one route, United States, whose unknown value takes else; both routes lead where this place led until you connect them.',
    noPort: 'This step has no such port.',
    leadsTo: (label: string) =>
      `This port already leads to ${label}; a module that ends the flow goes where nothing follows yet.`,
    refused: (detail: string) => `The format’s rules refuse it here: ${detail}.`,
    explanationTitle: (type: string) => `About ${type}`,
    fallbackTitle: (type: string) => `${type}: could not complete`,
    countryTitle: 'Country',
    countryRoute: 'United States',
    dialog: (after: string) => `Add a module after ${after}`,
    dialogDescription:
      'A module inserts ordinary steps, which you then edit like any other; it is not a step type of its own. A module that cannot go here says why.',
    explanation: 'With an explanation screen before the verification',
    inserted: (module: string, after: string) => `Inserted the ${module} module after ${after}.`,
  },
  page: {
    title: 'Flow',
    description:
      'The steps a person goes through, decided on the server: the outline first, the canvas beside it.',
    noDraft: 'This template has no draft. A published version is never edited; make a draft from',
    overviewLink: 'the overview',
    draft: (versionNumber: number) => `Draft version ${String(versionNumber)}.`,
  },
  version: {
    preview: 'Preview this version',
  },
  builder: {
    toolbar: 'Flow builder actions',
    undo: 'Undo',
    redo: 'Redo',
    save: 'Save draft',
    publish: 'Publish…',
    status: 'Draft status',
    saving: 'Saving the draft…',
    saved: 'Saved. The draft keeps its problems until they are fixed; publishing needs none.',
    unsaved: 'Changes not saved yet.',
    saveFailed: (title: string) => `The draft was not saved: ${title}`,
    migrated:
      'This draft was written in flow-spec 1 and was migrated to flow-spec 2 when it was opened. It is saved as version 2 the next time it is saved; the stored version 1 draft is never rewritten.',
    readOnly: 'You can read this flow but not change it.',
    canvas: 'Canvas',
    selected: 'Selected step',
    nothingSelected: 'Choose a step in the outline to see its settings.',
    menu: (label: string) => `Actions for ${label}`,
    /** WCAG 2.5.7: the selected step's actions, for a single pointer (Workflow 9D). */
    selectedActions: 'Actions for the selected step',
    /** WCAG 2.5.7: placing the steps without dragging them, as the workflow editor's (C141.3). */
    tidy: 'Tidy up',
    noActions: 'This item has no actions.',
    edited: {
      added: (step: string, after: string) => `Added ${step} after ${after}.`,
      connected: (port: string, from: string, to: string) =>
        `${port} of ${from} now leads to ${to}.`,
      deleted: (step: string) => `Deleted ${step}.`,
      routeAdded: (branch: string) => `Added a route to ${branch}.`,
      routeMoved: (route: string, direction: string) => `Moved ${route} ${direction}.`,
      undone: 'Undone.',
      redone: 'Redone.',
      reloaded: 'Loaded the latest draft.',
      tidied: 'Tidied up the layout.',
    },
  },
  menu: {
    addAfter: 'Add a step after',
    addModule: 'Add a module after',
    addModuleHere: 'Add a module here',
    connect: (port: string) => `Connect ${port} to`,
    addFallback: 'Add a fallback when attempts run out',
    addRoute: 'Add a route',
    moveUp: 'Move route up',
    moveDown: 'Move route down',
    settings: 'Open settings',
    delete: 'Delete',
    goTo: 'Go to the step',
    noNext: 'This step ends the flow.',
    firstRoute: 'It is already the first route.',
    lastRoute: 'It is already the last route.',
    entryOnly: 'The flow needs at least one step.',
  },
  dialogs: {
    palette: (after: string) => `Add a step after ${after}`,
    paletteDescription:
      'Each step type of flow-spec 2. A type that cannot be added here says why. There is no form step: a screen holds form components.',
    connect: (port: string, from: string) => `Connect ${port} of ${from}`,
    connectDescription:
      'Only the steps this port may lead to are listed: the format cannot express the others.',
    connectTo: 'Lead to',
    connectNone: 'No step can be connected here.',
    connectConfirm: 'Connect',
    cancel: 'Cancel',
    delete: (label: string) => `Delete ${label}?`,
    deleteDescription:
      'Its edges go with it; a step that led into it now leads where it led. Undo brings it back.',
    deleteConfirm: 'Delete step',
    conflict: 'The draft changed since you opened it',
    conflictDescription:
      'Someone saved this draft after you opened it, so your change was not saved (412). Reload the latest draft to keep working on it; your unsaved changes are dropped.',
    conflictReload: 'Reload the latest draft',
    conflictAdded: (label: string) => `Added: ${label}`,
    conflictRemoved: (label: string) => `Removed: ${label}`,
    conflictChanged: (label: string) => `Changed: ${label}`,
    conflictEdges: 'The connections between steps changed.',
    conflictNone: 'No step changed; the version’s other members did.',
    publish: 'Publish this draft',
    publishDescription:
      'Publishing makes this draft the template’s version for new inquiries. Every inquiry already created keeps the version it pinned.',
    publishChecking: 'Checking every rule the API runs at publish…',
    publishProblems: 'Fix these before publishing:',
    publishAcknowledgements:
      'Publishing needs each of these acknowledgements. Read each reason; the acknowledgement is stored with your id and the time.',
    publishNote: 'Publish note',
    publishNoteHint: 'At most 255 characters, locked with the version.',
    publishConfirm: 'Publish version',
    published: 'Published. New inquiries use this version.',
  },
  /** C154.9: why each acknowledgement kind is asked for. */
  acknowledgements: {
    'adverse-path':
      'A path fails a person on a fact that is not a verification’s own outcome (C150.7). In production it also needs a decision basis and a contest route on the failure step.',
    fallback:
      'A verification step’s exhausted fallback continues instead of sending the inquiry to review when its attempts run out (C150.6).',
    heuristic:
      'A route reads a heuristic check, extraction or signal, which inherits that heuristic’s error rate whichever way it routes (C150.7).',
    'asserted-fact':
      'A route on a fact the person types or the client reports leads to completion through fewer verifications; that fact can be chosen (C150.10).',
    'unverified-path':
      'A completion can be reached through no verification, or skipping one another path requires (C151.13).',
    egress: 'An embedded workflow sends data out of OpenVerify (C152.2).',
    'legal-copy': 'Operator copy replaces a legal notice’s words (C162.2).',
    'locale-unreviewed':
      'An enabled locale’s built-in words are machine-drafted and not reviewed (C161.5).',
    'client-unable':
      'A document chip step’s fallback continues without review when a client reports that it cannot read chips. That report is self-asserted: any client can send it (C207.9).',
    'cloned-results':
      'The version relies on cloned results of this verification type: a passed check another organisation ran, copied through Connect, can satisfy its step instead of a check run here (C235.3).',
    'cloned-results-unbound':
      'The version relies on cloned results with no live selfie matched against the cloned portrait, so nothing in the flow binds the person to the copy (C235.8).',
    'share-consent-default-text':
      'A sharing consent step shows the built-in consent texts, which counsel has not yet reviewed (C238.10).',
  },
  versions: {
    actions: 'Actions',
    restore: (number: number) => `Restore version ${String(number)} as a draft`,
    restoreTitle: (number: number) => `Restore version ${String(number)} as a draft?`,
    restoreDescription:
      'A new draft is made from this version. The API refuses when the template already has a draft (draft_exists): publish or discard it first.',
    restoreConfirm: 'Restore as a draft',
    restored: (number: number) => `Version ${String(number)} was restored as a draft.`,
    compare: 'Compare versions',
    compareDescription:
      'The server’s diff of any two versions, as a list. A change with a consequence is never called layout only.',
    version: 'Version',
    against: 'Against',
    compareSubmit: 'Compare',
    usedBy: 'Used by',
    noneNamed: (kind: string) => `No ${kind} you can see`,
    hidden: (count: number, kind: string) => `${String(count)} ${kind} you cannot see`,
    embedOrigins: (origins: string) => `Embedded from: ${origins}`,
    deployments: 'Deployments',
    noDeployments: 'Nothing has been published from this template yet.',
  },
  /** C154.4, C154.5, C155.7 (Workflow 9D): copy and promote from the template page. */
  operations: {
    group: 'Copy and promote',
    copy: 'Copy template…',
    copyTitle: 'Copy this template',
    copyDescription:
      'Makes a new template whose draft copies this version (the current version when none is named). Nothing is published, and inquiries are never copied.',
    copyName: 'Name of the copy',
    copyDefault: (name: string) => `${name} (copy)`.slice(0, 100),
    copyConfirm: 'Copy template',
    copied: (name: string) => `Copied as ${name}. Its draft is ready to edit.`,
    open: (name: string) => `Open ${name}`,
    copyRefused: (title: string) => `The template was not copied: ${title}`,
    promote: 'Promote…',
    promoteTitle: (number: number) => `Promote version ${String(number)} to another environment`,
    promoteDescription:
      'Copies this published version as a draft of the template of the same name in the environment you choose, making that template on the first promote. Nothing is published there.',
    promoteTarget: 'Target environment',
    environment: (kind: 'sandbox' | 'production', id: string) =>
      `${kind === 'production' ? 'Production' : 'Sandbox'} (${id})`,
    noTarget: 'There is no other environment in this organization to promote to.',
    rights:
      'The API checks the rights itself: only a person can promote (an API key cannot), with inquiry-templates:write in both environments, read from your role assignments in the target, and environments:production when either environment is production. A theme set is copied only with theme-sets:write in the target.',
    notCopiedHeading: 'What a promote does not copy',
    notCopied: {
      records: 'Inquiries, verifications and every other record made with the template.',
      draft:
        'The target’s draft: a promote never replaces one; the API refuses while the target template has a draft (draft_exists).',
      references:
        'Lists and workflows: the target’s own are named instead, by name and kind; when none or several match, the promote is refused.',
      themeSets: 'A theme set the target already has by name: the target’s is used.',
    },
    promoteConfirm: (number: number) => `Promote version ${String(number)}`,
    promoted: (number: number, environment: string, themeSets: number) =>
      `Version ${String(number)} is a draft in ${environment}.${themeSets === 0 ? '' : ` ${String(themeSets)} theme set${themeSets === 1 ? ' was' : 's were'} copied with it.`}`,
    promoteRefused: (reason: string) => `The version was not promoted: ${reason}`,
    refusals: {
      draftExists:
        'the template in the target already has a draft; publish or discard it there first.',
      notPublished: 'a promote copies a published version only.',
      forbidden:
        'the API needs your rights in both environments (inquiry-templates:write, and environments:production when either is production).',
      notFound: 'the target environment or the template was not found.',
      unresolved: (details: string) =>
        `some references have no single match in the target: ${details}`,
    },
    cancel: 'Cancel',
  },
  diff: {
    consequences: 'Consequences',
    changes: 'Changes',
    consequenceWords: {
      required_check_relaxed: 'A required check was turned off or made optional',
      ga_check_replaced_by_beta: 'A generally available check was replaced by a beta one',
      verification_step_removed: 'A verification step was removed',
      verification_step_skippable: 'A verification step can now be skipped on some path',
      consent_text_changed: 'A consent text changed: new sessions need fresh consent',
      unreviewed_locale_enabled: 'A locale whose words nobody has reviewed was enabled',
    },
    stepAdded: (id: string) => `Step added: ${id}`,
    stepRemoved: (id: string) => `Step removed: ${id}`,
    stepChanged: (id: string, pointers: string) => `Step changed: ${id} (${pointers})`,
    edgeAdded: (id: string) => `Connection added: ${id}`,
    edgeRemoved: (id: string) => `Connection removed: ${id}`,
    edgeRetargeted: (id: string) => `Connection re-targeted: ${id}`,
    routeOrder: (id: string) => `Route order changed: ${id}`,
    member: (member: string, pointer: string) => `${member} changed at ${pointer}`,
    theme: 'Theme set changed',
    layoutOnly: 'Only the layout changed: nothing a person sees or the server decides.',
    same: 'The two versions hold the same content.',
    members: {
      'verification-config': 'Verification config',
      settings: 'Settings',
      'report-config': 'Report config',
      'field-schemas': 'Field schemas',
      copy: 'Copy',
      locales: 'Locales',
    },
  },
  branch: {
    condition: (label: string) => `Condition of the route ${label}`,
    changed: (label: string) => `Changed the route ${label}.`,
    facts: 'Facts the branch reads',
    noFacts: 'No route reads a fact yet.',
    unknownPath: 'not a path this flow can read here: publishing refuses it (scope_path_unknown)',
    absent:
      'There is no lists. path and no signal that is not flow-provisional: lists are screened on the inquiry’s first terminal move, after the person’s part, and those signals are computed at completion, so a flow cannot read them. A self-asserted fact is typed or chosen by the person, and a client-reported one comes from their device or app: either can be chosen.',
  },
  /** C150.5, C150.9, C150.11 (Workflow 9D): a branch's warnings and its wait, in words. */
  branchWarnings: {
    heading: 'Warnings at this branch',
    note: 'A warning never blocks saving or publishing and is never counted as an error.',
    client_signal_before_screen:
      'A route reads a client-collected signal, but no screen after consent comes before this branch: until the person has been through one, the signal reads unknown (not_yet_collected) and each route’s onNull decides (C150.9). Put a screen after consent before this branch.',
    tipping_off_route: (route: string) =>
      `${route} sends a person somewhere else on a list or screening result, which they can notice (C150.11). Recommended: keep their path unchanged and flag the inquiry for review with an action step (flag_for_review) instead.`,
    other: (detail: string) => detail,
  },
  wait: {
    legend: 'Wait for facts (waitFor)',
    description:
      'The branch may wait for facts that can still be unknown when it is reached (signals still computing), showing the person a waiting screen polled every 2 seconds (C150.5). A route that reads a signal must name it here, or publishing refuses it (signal_wait_missing).',
    seconds: 'Longest wait, in seconds',
    secondsHint: (cap: number) =>
      `From 1 to ${String(cap)} seconds. A new wait starts at 5 seconds (provisional: two of the session’s 2-second polls and a margin).`,
    secondsRefused: (cap: number) =>
      `The wait must be a whole number from 1 to ${String(cap)} seconds.`,
    notWaited: (paths: string) => `Signals a route reads that are not in the wait: ${paths}.`,
    none: 'No fact here can be waited for: only facts that can be unknown are offered.',
    after: 'After the wait, an unknown value follows',
    routeOnNull: (route: string, choice: string) => `Route ${route}: ${choice}`,
    noOnNull: 'no onNull chosen yet',
    added: (path: string) => `The branch now waits for ${path}.`,
    removed: (path: string) => `The branch no longer waits for ${path}.`,
    secondsChanged: (seconds: number) => `The branch waits at most ${String(seconds)} seconds.`,
  },
  /** C155.5 (Workflow 9D): the screen editor. */
  screen: {
    heading: 'Components of the screen',
    description:
      'Every component in order, containers before what they hold. Move one with its buttons, never only by dragging; each change is checked by the format’s screen rules before it is made.',
    library: 'Add a component',
    kind: 'Kind',
    add: 'Add',
    imageRefused:
      'An image shows a theme asset, chosen by its id: add it in the step as JSON once the asset is uploaded to a theme set.',
    moveUp: 'Move up',
    moveDown: 'Move down',
    into: 'Into the container before it',
    out: 'Out of its container',
    remove: 'Remove',
    edit: 'Edit',
    refused: 'The format does not accept this change.',
    row: (kind: string, id: string, depth: number) =>
      `${kind} ${id}${depth > 1 ? `, inside a container (level ${String(depth)})` : ''}`,
    moved: (id: string) => `Moved the component ${id}.`,
    added: (kind: string) => `Added a ${kind} component.`,
    removed: (id: string) => `Removed the component ${id}.`,
    changed: (id: string) => `Changed the component ${id}.`,
    tabs: 'Component settings',
    data: 'Data',
    logic: 'Logic',
    design: 'Design',
    field: 'Field it fills',
    fieldHint: 'A field of this version’s field schemas; the format refuses one it does not hold.',
    required: 'Required',
    minLength: 'Fewest characters',
    maxLength: 'Most characters',
    noData: 'This component fills no field.',
    visibleWhen: (id: string) => `Show ${id} when`,
    logicHint:
      'Compared only with the screen’s own fields, by the strict visibility rules the flow and the server both run; personal data is never compared with typed text.',
    designNote:
      'A flow-spec 2 component has no style of its own: its look comes from the version’s theme set (Theme tab), whose editor shows the live contrast of every colour pair. Style overrides per component are not built.',
  },
  stepPanel: {
    heading: (name: string) => `Step: ${name}`,
    missing: 'This step is no longer in the flow. Choose another step in the outline.',
  },
});
