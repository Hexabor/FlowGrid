export const elements = {
  navButtons: document.querySelectorAll(".nav-button"),
  navigationTargets: document.querySelectorAll("[data-view-target]"),
  views: document.querySelectorAll(".view"),
  form: document.querySelector("#movement-form"),
  movementModal: document.querySelector("#movement-modal"),
  openMovementModal: document.querySelector("#open-movement-modal"),
  closeMovementModal: document.querySelector("#close-movement-modal"),
  type: document.querySelector("#type"),
  typeToggleButtons: document.querySelectorAll(".type-toggle-button"),
  date: document.querySelector("#date"),
  dateTrigger: document.querySelector("#date-trigger"),
  datePicker: document.querySelector("#date-picker"),
  datePickerTitle: document.querySelector("#date-picker-title"),
  dateGrid: document.querySelector("#date-grid"),
  prevMonth: document.querySelector("#prev-month"),
  nextMonth: document.querySelector("#next-month"),
  amount: document.querySelector("#amount"),
  concept: document.querySelector("#concept"),
  category: document.querySelector("#category"),
  party: document.querySelector("#party"),
  recurrence: document.querySelector("#recurrence"),
  note: document.querySelector("#note"),
  isShared: document.querySelector("#is-shared"),
  sharedFields: document.querySelector("#shared-fields"),
  sharedContact: document.querySelector("#shared-contact"),
  sharedContactAdd: document.querySelector("#shared-contact-add"),
  sharedMode: document.querySelector("#shared-mode"),
  sharedUneven: document.querySelector("#shared-uneven"),
  sharedMyShare: document.querySelector("#shared-my-share"),
  sharedTheirShare: document.querySelector("#shared-their-share"),
  sharedTheirShareLabel: document.querySelector("#shared-their-share-label"),
  sharedUnevenFeedback: document.querySelector("#shared-uneven-feedback"),
  feedback: document.querySelector("#form-feedback"),
  submitButton: document.querySelector("#movement-form .primary-action"),
  submitLabel: document.querySelector("#movement-form .movement-submit-label"),
  categoryFilter: document.querySelector("#category-filter"),
  typeFilter: document.querySelector("#type-filter"),
  filterText: document.querySelector("#filter-text"),
  filterFieldMobile: document.querySelector("#filter-field-mobile"),
  filterConcept: document.querySelector("#filter-concept"),
  filterBar: document.querySelector("#filter-bar"),
  openFilter: document.querySelector("#open-filter"),
  // Two clear-filter buttons coexist in the DOM: the bar X (desktop) and
  // the top X (mobile, sitting next to "Filtrar" so the filter bar itself
  // never wraps to a second row when active). Both share data-role="reset".
  resetSearchButtons: document.querySelectorAll('[data-role="reset"]'),
  invitationModal: document.querySelector("#invitation-modal"),
  closeInvitationModal: document.querySelector("#close-invitation-modal"),
  invitationList: document.querySelector("#invitation-list"),
  invitationFeedback: document.querySelector("#invitation-feedback"),
  historyModal: document.querySelector("#history-modal"),
  closeHistoryModal: document.querySelector("#close-history-modal"),
  historyTitle: document.querySelector("#history-title"),
  historyList: document.querySelector("#history-list"),
  editCommentField: document.querySelector("#edit-comment-field"),
  editComment: document.querySelector("#edit-comment"),
  list: document.querySelector("#movement-list"),
  template: document.querySelector("#movement-template"),
  currentPeriod: document.querySelector("#current-period"),
  movementCount: document.querySelector("#movement-count"),
  monthPeriodLabel: document.querySelector("#month-period-label"),
  monthIncomeTotal: document.querySelector("#month-income-total"),
  monthExpenseTotal: document.querySelector("#month-expense-total"),
  monthBalanceTotal: document.querySelector("#month-balance-total"),
  monthConceptBreakdown: document.querySelector("#month-concept-breakdown"),
  monthCategoryBreakdown: document.querySelector("#month-category-breakdown"),
  yearPeriodLabel: document.querySelector("#year-period-label"),
  yearIncomeTotal: document.querySelector("#year-income-total"),
  yearExpenseTotal: document.querySelector("#year-expense-total"),
  yearBalanceTotal: document.querySelector("#year-balance-total"),
  yearConceptBreakdown: document.querySelector("#year-concept-breakdown"),
  yearCategoryBreakdown: document.querySelector("#year-category-breakdown"),
  sharedBalances: document.querySelector("#shared-balances"),
  sharedContactsCount: document.querySelector("#shared-contacts-count"),
  sharedContactFilter: document.querySelector("#shared-contact-filter"),
  sharedMobileContactPicker: document.querySelector("#shared-mobile-contact-picker"),
  sharedEntries: document.querySelector("#shared-entries"),
  paymentModal: document.querySelector("#payment-modal"),
  closePaymentModal: document.querySelector("#close-payment-modal"),
  paymentForm: document.querySelector("#payment-form"),
  paymentTitle: document.querySelector("#payment-title"),
  paymentContact: document.querySelector("#payment-contact"),
  paymentAmount: document.querySelector("#payment-amount"),
  paymentDate: document.querySelector("#payment-date"),
  paymentDateTrigger: document.querySelector("#payment-date-trigger"),
  paymentNote: document.querySelector("#payment-note"),
  paymentFeedback: document.querySelector("#payment-feedback"),
  contactsForm: document.querySelector("#contacts-form"),
  newContactName: document.querySelector("#new-contact-name"),
  newContactEmail: document.querySelector("#new-contact-email"),
  contactsList: document.querySelector("#contacts-list"),
  contactsCount: document.querySelector("#contacts-count"),
  conceptForm: document.querySelector("#concept-form"),
  categoryForm: document.querySelector("#category-form"),
  newConcept: document.querySelector("#new-concept"),
  newConceptCategory: document.querySelector("#new-concept-category"),
  newCategory: document.querySelector("#new-category"),
  conceptSort: document.querySelector("#concept-sort"),
  conceptGroup: document.querySelector("#concept-group"),
  conceptList: document.querySelector("#concept-list"),
  categoryList: document.querySelector("#category-list"),
  conceptCount: document.querySelector("#concept-count"),
  categoryCount: document.querySelector("#category-count"),
  settingsTabs: document.querySelectorAll(".settings-tab"),
  settingsPanels: document.querySelectorAll("[data-settings-panel]"),
  csvFile: document.querySelector("#csv-file"),
  csvImportButton: document.querySelector("#csv-import-button"),
  csvImportStatus: document.querySelector("#csv-import-status"),
  csvPreview: document.querySelector("#csv-preview"),
  csvExportButton: document.querySelector("#csv-export-button"),
  csvExportStatus: document.querySelector("#csv-export-status"),
  backupExport: document.querySelector("#backup-export"),
  backupFile: document.querySelector("#backup-file"),
  backupImport: document.querySelector("#backup-import"),
  backupStatus: document.querySelector("#backup-status"),
  wipeMovements: document.querySelector("#wipe-movements"),
  changelogList: document.querySelector("#changelog-list"),
  changelogCount: document.querySelector("#changelog-count"),
  sharedCallout: document.querySelector("#shared-callout"),
  feedbackForm: document.querySelector("#feedback-form"),
  feedbackSubject: document.querySelector("#feedback-subject"),
  feedbackMessage: document.querySelector("#feedback-message"),
  feedbackSubmit: document.querySelector("#feedback-submit"),
  feedbackStatus: document.querySelector("#feedback-status"),
  // Análisis (vista unificada con toggle mensual/anual).
  analysisView: document.querySelector("#analysis-view"),
  analysisModeButtons: document.querySelectorAll("[data-analysis-mode]"),
  analysisPanes: document.querySelectorAll("[data-analysis-pane]"),
  // Periódicos (recurring templates).
  recurringList: document.querySelector("#recurring-list"),
  recurringEmpty: document.querySelector("#recurring-empty"),
  recurringCount: document.querySelector("#recurring-count"),
  recurringModal: document.querySelector("#recurring-modal"),
  openRecurringModal: document.querySelector("#open-recurring-modal"),
  closeRecurringModal: document.querySelector("#close-recurring-modal"),
  recurringForm: document.querySelector("#recurring-form"),
  recurringType: document.querySelector("#recurring-type"),
  recurringConcept: document.querySelector("#recurring-concept"),
  recurringCategory: document.querySelector("#recurring-category"),
  recurringAmount: document.querySelector("#recurring-amount"),
  recurringPeriodicity: document.querySelector("#recurring-periodicity"),
  recurringDayOfMonth: document.querySelector("#recurring-day-of-month"),
  recurringMonthOfYear: document.querySelector("#recurring-month-of-year"),
  recurringMonthOfYearField: document.querySelector("#recurring-month-of-year-field"),
  recurringStartDate: document.querySelector("#recurring-start-date"),
  recurringStartDateTrigger: document.querySelector("#recurring-start-date-trigger"),
  recurringEndDate: document.querySelector("#recurring-end-date"),
  recurringEndDateTrigger: document.querySelector("#recurring-end-date-trigger"),
  recurringEndDateClear: document.querySelector("#recurring-end-date-clear"),
  convertToRecurring: document.querySelector("#convert-to-recurring"),
  // Confirmation modal: shared component for any robust delete dialog.
  // Each opener fills in the title, message, extra line, and the action
  // buttons via ui/confirm.js.
  confirmModal: document.querySelector("#confirm-modal"),
  closeConfirmModal: document.querySelector("#close-confirm-modal"),
  confirmTitle: document.querySelector("#confirm-title"),
  confirmMessage: document.querySelector("#confirm-message"),
  confirmExtra: document.querySelector("#confirm-extra"),
  confirmActions: document.querySelector("#confirm-actions"),
  recurringParty: document.querySelector("#recurring-party"),
  recurringNote: document.querySelector("#recurring-note"),
  recurringNotePreview: document.querySelector("#recurring-note-preview"),
  recurringSharedContact: document.querySelector("#recurring-shared-contact"),
  recurringSharedFields: document.querySelector("#recurring-shared-fields"),
  recurringSharedMode: document.querySelector("#recurring-shared-mode"),
  recurringSharedUneven: document.querySelector("#recurring-shared-uneven"),
  recurringSharedMyShare: document.querySelector("#recurring-shared-my-share"),
  recurringSharedTheirShare: document.querySelector("#recurring-shared-their-share"),
  recurringFeedback: document.querySelector("#recurring-feedback"),
  recurringSubmitLabel: document.querySelector("#recurring-submit-label"),
};

export function openMovementModal() {
  elements.movementModal.hidden = false;
  elements.concept.focus();
}

export function closeMovementModal() {
  elements.movementModal.hidden = true;
}

const VIEW_STORAGE_KEY = "flowgrid.view.v1";
const ANALYSIS_MODE_KEY = "flowgrid.analysis.mode.v1";

// Migrate previously persisted view names: the old per-period views
// month/year are gone, both replaced by the unified analysis view.
const VIEW_ALIASES = { month: "analysis", year: "analysis" };

function readAnalysisMode() {
  try {
    const stored = localStorage.getItem(ANALYSIS_MODE_KEY);
    if (stored === "month" || stored === "year") return stored;
  } catch {
    // ignore
  }
  return "month";
}

export function setAnalysisMode(mode) {
  const normalised = mode === "year" ? "year" : "month";
  if (elements.analysisView) {
    elements.analysisView.dataset.mode = normalised;
  }
  elements.analysisModeButtons?.forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.analysisMode === normalised);
  });
  elements.analysisPanes?.forEach((pane) => {
    pane.hidden = pane.dataset.analysisPane !== normalised;
  });
  try {
    localStorage.setItem(ANALYSIS_MODE_KEY, normalised);
  } catch {
    // ignore
  }
}

export function setView(viewName) {
  const resolved = VIEW_ALIASES[viewName] ?? viewName;
  elements.views.forEach((view) => view.classList.toggle("is-active", view.dataset.view === resolved));
  elements.navButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.viewTarget === resolved);
  });
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, resolved);
  } catch {
    // localStorage may be unavailable (private mode, quota); ignore.
  }
  if (resolved === "analysis") {
    setAnalysisMode(readAnalysisMode());
  }
}

export function restoreLastView() {
  let stored;
  try {
    stored = localStorage.getItem(VIEW_STORAGE_KEY);
  } catch {
    return;
  }
  if (!stored) return;
  const exists = Array.from(elements.views).some((view) => view.dataset.view === stored);
  if (exists) setView(stored);
}

export function setSettingsPanel(panelName) {
  elements.settingsTabs.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.settingsTarget === panelName);
  });
  elements.settingsPanels.forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.settingsPanel === panelName);
  });
}
