/**
 * The console's English words for `dashboard-cases-reports` (C155.9, decision 33): the case
 * completions of C172 and the report, verification, print and trust-store completions of C173.
 * Translating the console later is a change of this data, never of the components that read it.
 * Every string is ours; none names another product.
 */
export const CASES_REPORTS_COPY = {
  checklists: {
    title: 'Checklists',
    description:
      'Each item is checked by a person, who is recorded with the time. Nothing is checked on anyone’s behalf; a status an unchecked item names cannot be entered until it is checked.',
    empty: 'This case’s version has no checklist.',
    checkedBy: 'Checked by',
    checkedAt: 'at',
    notChecked: 'Not checked',
    requiredFor: 'Needed before',
    check: 'Check',
    uncheck: 'Uncheck',
    pending: 'Saving…',
    checked: 'The item was checked.',
    unchecked: 'The item was unchecked.',
    readOnly: 'You can read this checklist; checking an item needs permission to change cases.',
    workflowRun: 'a workflow run',
  },
  statusSwitcher: {
    requiresFields: 'Fields this status needs filled in first',
    requiresItems: 'Checklist items this status needs checked first',
    noneRequired: 'Nothing has to be filled in or checked first.',
  },
  presetComments: {
    label: 'Preset comment',
    choose: 'Choose a preset comment',
    insert: 'Insert preset comment',
    description:
      'Inserting a preset puts its words in the comment box, where you can change them. Nothing is posted until you add the comment.',
  },
  placements: {
    statusSwitcher: 'Actions for this status change',
    header: 'Actions',
    module: 'Actions for this part of the case',
  },
  layout: {
    title: 'Case page layout',
    description:
      'Choose how many columns the case page has and where each module goes. Move modules with the buttons, or drag them with a mouse; both do the same. A module a reader lacks the permissions for is not shown to them, and publishing refuses a module the layout cannot hold.',
    columns: 'Columns',
    column: 'Column',
    collapsed: 'Collapsed at first',
    notPlaced: 'Not in the layout',
    useDefault: 'Use the default layout',
    start: 'Lay out the modules',
    defaultChosen: 'Saving now keeps the default layout.',
    changes: 'Layout changes',
    notHeld: 'which you do not hold; publishing will refuse it',
    columnsDescription: 'On a narrow screen the columns follow one another.',
    dragHint: 'Drag a module onto a column or before another module, or use its buttons.',
    defaultLayout:
      'This version uses the default layout: every module the reader may see, in one column.',
    save: 'Save layout',
    saving: 'Saving…',
    saved: 'Saved the layout.',
    moved: 'Moved',
    needs: 'needs',
  },
  versionMembers: {
    checklistsTitle: 'Checklists and preset comments',
    checklistsDescription:
      'Checklists are JSON: each has a key, a label and items, each item with a key, a label and the statuses it must be checked before. Preset comments have a key, a label and plain text without placeholders.',
    checklists: 'Checklists',
    presetComments: 'Preset comments',
    save: 'Save checklists and comments',
    saved: 'Saved the checklists and preset comments.',
    requiresFields: 'Needs filled in',
    layout: 'Layout',
    noChecklists: 'No checklist',
    noPresetComments: 'No preset comment',
  },
  print: {
    button: 'Print',
    recording: 'Recording the print…',
    recordsUse:
      'Printing from this button is recorded in the audit log. A print from the browser’s own menu or shortcut is not.',
    footerEnvironment: 'Environment',
    printedBy: 'Printed by',
    containsPersonalData: 'Contains personal data.',
    masked: 'Personal data is masked on this printout.',
    redacted: 'redacted',
  },
  reports: {
    coverage:
      'Complete means every enabled source was screened; a source not enabled, or not screened, is not covered.',
    runNotes: 'Notes of the latest run',
    noRunNotes: 'The latest run left no note.',
    noRunYet: 'No run has finished yet.',
    detailReadsCapped:
      'Only the newest reports were read in full; open a report for whether its run found the inquiry already decided.',
  },
  verificationFiles: {
    title: 'Files',
    description:
      'The files this verification holds, by their metadata only; open one from its own page.',
    empty: 'This verification holds no file.',
    redactedAt: 'Redacted',
  },
  graphExpand: {
    expand: 'Expand',
    expanding: 'Expanding…',
    description:
      'Runs a new query one step out from this node and adds what it finds to the graph. It counts towards the graph query limit, so it runs only when you ask.',
    expanded: 'The node was expanded.',
    canvasLimit:
      'The expansion found more than the canvas can show; the table lists everything the query returned.',
    needsPiiView: 'Expanding this kind needs pii:view',
    refusals: {
      403: 'Expanding a value needs graph:write, and pii:view for a value that identifies a person.',
      404: 'That node is no longer in the stored result.',
      422: 'An account is expanded around with its template, not from here.',
    },
  },
} as const;
