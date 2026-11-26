/**
 * The English strings of `dashboard-template-forms`' pages and components (C155.9, decision 33):
 * the template's settings tab, the generated forms (`components/schema-form/`), the check panels
 * (`components/check-panels/`) and the report template forms. Translating the console later is a
 * data change here. Plain text only.
 */
import { defineCopy } from './catalog';

export const TEMPLATE_FORMS_COPY = defineCopy({
  settingsPage: {
    title: 'Template settings',
    metadataTitle: 'Template settings',
    breadcrumbTemplates: 'Templates',
    breadcrumbSettings: 'Settings',
    versionDraft: (versionNumber: number) =>
      `Editing the draft, version ${String(versionNumber)}. Saving changes the draft only; publishing it is the builder's.`,
    versionReadOnly: (versionNumber: number) =>
      `Version ${String(versionNumber)} is not a draft, so its settings are read-only. Start a draft from the template's page to change them.`,
    versionNoWrite: (versionNumber: number) =>
      `You can read version ${String(versionNumber)}'s settings; changing them needs inquiry-templates:write.`,
    inForce: 'Settings in force',
    inForceDescription:
      'What new inquiries of this version use. A setting the version leaves out takes its default.',
  },
  schemaForm: {
    required: (name: string) => `${name} (required)`,
    notSet: 'Not set',
    yes: 'Yes',
    no: 'No',
    none: (name: string) => `${name}: none`,
    noneHint: 'None (null) is a value of its own, not the same as leaving the setting out.',
    readOnlyNotSet: 'Not set',
    readOnlyNone: 'None',
    problem: 'Problem',
    formProblems: 'These values are refused:',
  },
  memberForm: {
    editAsJson: (legend: string) => `Edit ${legend} as JSON`,
    editAsForm: (legend: string) => `Edit ${legend} as a form`,
    jsonLabel: (legend: string) => `${legend} (JSON)`,
    jsonDescription:
      'The member as the API takes it. Switching back to the form needs valid JSON of the member.',
    jsonInvalid: 'This is not valid JSON of the member, so the form cannot show it.',
    save: (legend: string) => `Save ${legend}`,
    saving: 'Saving…',
    saved: (legend: string) => `Saved ${legend} to the draft.`,
    refusedBeforeSending: 'Nothing was sent: correct the values marked above first.',
    savedProblems:
      'The saved draft has problems here; it is kept, and publishing waits until they are solved:',
    stale:
      'The draft changed since this page was opened, so nothing was saved. Reload the page to see the latest draft, then make your change again.',
  },
  verificationConfig: {
    legend: 'Verification checks',
    description:
      'Which checks run for each verification type of this draft, which decide it, and their settings. The builder shows the same panels beside each verification step.',
    save: 'Save verification checks',
    none: 'This draft configures no verification type.',
  },
  sections: {
    settings:
      'How long an inquiry, its sessions and its links last, how many sessions it may have, and how long it is kept.',
    links:
      'The help and privacy links a person sees, who may frame this template, and where a finished flow returns. A member left empty is not sent, so the draft keeps its value; choose none to clear one.',
    'report-config': 'The reports run when an inquiry of this version completes.',
    'signal-config': 'The signals collected, and the rules that send an inquiry to review.',
    'list-config': 'The lists screened at completion, and what a match does.',
  },
  members: {
    settings: 'Settings',
    links: 'Links, embedding and redirects',
    'report-config': 'Reports on completion',
    'signal-config': 'Signals',
    'list-config': 'List screening',
  },
  notes: {
    timing: (hours: string) =>
      `Warning: below 20 hours (${hours} hours here). WCAG 2.2.1 asks that a person can turn off, adjust or extend a time limit; a window this short can end before someone who needs more time finishes.`,
    defaultIs: (value: string) => `Left empty, the default applies: ${value}.`,
    redirectStatus:
      'The status in the redirect is a hint only: anyone can type it into a URL. Read the inquiry from the API before acting on it.',
    embedOrigins:
      "Each must be one of the environment's allowed embed origins; left empty, all of them may frame this template.",
    links: 'An https: address of at most 2,048 characters, shown to the person by a link button.',
  },
  checkPanels: {
    typeHeading: (apiType: string) => `${apiType} checks`,
    typeOptions: (apiType: string) => `${apiType} options`,
    noTypeOptions: 'This verification type takes no option of its own.',
    enabled: (check: string) => `Run ${check}`,
    required: (check: string) => `Require ${check} to pass`,
    requiredNeedsEnabled: 'A check that does not run cannot be required.',
    tier: { R: 'R: real logic', H: 'H: heuristic', A: 'A: an adapter with a sandbox provider' },
    tierLine: (tier: string, alternate: string) =>
      alternate === '' ? `Tier ${tier}` : `Tier ${tier}, with ${alternate}`,
    type: {
      user_behavior: 'Type: user behavior (what the person did)',
      fraud: 'Type: fraud (signs of a forged or misused identity)',
    },
    stage: { ga: 'Stage: GA', beta: 'Stage: beta', sunset: 'Stage: sunset' },
    betaBadge: 'Beta',
    betaNote:
      'A beta check is a heuristic or model-based check without a calibration report: its result can be wrong, so treat it as a signal.',
    defaultRequirement: {
      required: 'By default: run and required',
      advisory: 'By default: run, not required',
      disabled: 'By default: not run',
    },
    decision: {
      decides: 'Run and required: when it fails, the verification does not pass.',
      'runs-not-deciding':
        'Run, not required: it runs but does not decide the verification (ADR 0002, section 3c).',
      'read-by-branch':
        'Run, not required: it does not decide the verification, but a branch of this draft reads it, so it can change the path a person takes.',
      'not-run': 'Not run: it gives no result, and a branch that reads it meets null.',
    },
    branchesHeading: (check: string) => `Branches of this draft that read ${check}`,
    noBranches: 'No branch of this draft reads it.',
    branchLine: (branch: string, route: string) => `${branch}: route "${route}"`,
    config: (check: string) => `${check} settings`,
    configNone: 'This check takes no settings.',
    typeProblems: 'The contract refuses this configuration:',
    facts: (check: string) => `Facts of ${check}`,
    announce: {
      enabled: (check: string) => `${check} now runs.`,
      disabled: (check: string) => `${check} no longer runs.`,
      required: (check: string) => `${check} is now required.`,
      notRequired: (check: string) => `${check} is no longer required.`,
      config: (check: string) => `Changed the settings of ${check}.`,
      options: (apiType: string) => `Changed the ${apiType} options.`,
    },
  },
  reportForms: {
    draftForm: 'Edit the draft configuration as a form',
    draftLegend: (type: string) => `${type} configuration`,
    save: 'Save the configuration',
    saved: 'Saved the draft configuration.',
    jsonFallback:
      'The same configuration as JSON is below, for anything the form shows as JSON or to paste a whole document.',
    searchListsDefault:
      "Left empty, every enabled source of the type's kind is pinned when the draft is saved.",
    listIdsNull:
      'None (null) means each report names its own lists in its query; a report that names none is refused with report_lists_required.',
    listIdsMode: {
      own: 'Each report names its own lists (null)',
      chosen: 'Only the lists chosen here',
    },
    newLink: 'New report template',
    newTitle: 'New report template',
    newDescription:
      'A template of one report type, published as version 1 at once. Every key you leave out takes its default; the API pins the source lists when it is created.',
    name: 'Name',
    type: 'Report type',
    create: 'Create the template',
    creating: 'Creating…',
    breadcrumb: 'Report templates',
  },
  stepForm: {
    legend: (step: string) => `Settings of ${step}`,
    announce: (step: string, member: string) => `Changed ${member} of ${step}.`,
    captureByDevice:
      'Client-reported guidance: each device class offers only the methods ticked here. The server cannot prove how a photo was taken, so the production camera rules stay as they are.',
    deviceGroup: (device: string) => `Capture methods on ${device}`,
    noMethods: 'None ticked: this device class follows captureMethods.',
  },
  listPicker: {
    all: 'Every active list of the environment (all)',
    none: 'No list (none)',
    chosen: 'Only the lists chosen here',
    choices: 'Lists',
    noLists: 'This environment has no list to choose.',
    kind: (name: string, kind: string) => `${name} (${kind})`,
    unknown: (id: string) => `${id} (not an active list of this environment)`,
  },
});
