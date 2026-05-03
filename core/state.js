export const state = {
  movements: [],
  settings: { categories: [], concepts: [] },
  contacts: [],
  sharedEntries: [],
  recurringTemplates: [],
  groups: [],
  groupMembers: [],
  datePickerMonth: new Date(),
  editingMovementId: null,
  pendingCsvMovements: [],
  pendingBackup: null,
  monthCursor: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  yearCursor: new Date(new Date().getFullYear(), 0, 1),
  // Mode toggle for the unified Análisis view. Persisted in localStorage
  // (key "flowgrid.analysis.mode.v1") so the user lands on whatever they
  // were last consulting — a click saved most of the time.
  analysisMode: "month",
  sharedFilterContactId: "all",
  movementSort: { key: "date", dir: "desc" },
  breakdownSort: { key: "balance", dir: "desc" },
  editingSharedEntryId: null,
  editingRecurringTemplateId: null,
  editingGroupId: null,
  // True while the form is editing a shared entry whose owner is a
  // linked partner (not the current user). Drives the un-flip of the
  // submitted form payload back to the owner's perspective and the
  // contact-selector lock.
  editingPartnerEntry: false,
  activeDateTarget: null,
  expandedMovementId: null,
  // Active card in the Periódicos list when in mobile collapsed-card
  // mode. Only one open at a time, mirroring the Movimientos pattern.
  expandedRecurringId: null,
};
