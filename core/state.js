export const state = {
  movements: [],
  settings: { categories: [], concepts: [] },
  contacts: [],
  sharedEntries: [],
  datePickerMonth: new Date(),
  editingMovementId: null,
  pendingCsvMovements: [],
  pendingBackup: null,
  monthCursor: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  yearCursor: new Date(new Date().getFullYear(), 0, 1),
  sharedFilterContactId: "all",
  movementSort: { key: "date", dir: "desc" },
  breakdownSort: { key: "balance", dir: "desc" },
  editingSharedEntryId: null,
  // True while the form is editing a shared entry whose owner is a
  // linked partner (not the current user). Drives the un-flip of the
  // submitted form payload back to the owner's perspective and the
  // contact-selector lock.
  editingPartnerEntry: false,
  activeDateTarget: null,
  expandedMovementId: null,
};
