export const elements = {
  navButtons: document.querySelectorAll(".nav-button"),
  navigationTargets: document.querySelectorAll("[data-view-target]"),
  views: document.querySelectorAll(".view"),
  form: document.querySelector("#movement-form"),
  movementModal: document.querySelector("#movement-modal"),
  openMovementModal: document.querySelector("#open-movement-modal"),
  closeMovementModal: document.querySelector("#close-movement-modal"),
  type: document.querySelector("#type"),
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
  categoryFilter: document.querySelector("#category-filter"),
  typeFilter: document.querySelector("#type-filter"),
  search: document.querySelector("#search"),
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
  backupExport: document.querySelector("#backup-export"),
  backupFile: document.querySelector("#backup-file"),
  backupImport: document.querySelector("#backup-import"),
  backupStatus: document.querySelector("#backup-status"),
  changelogList: document.querySelector("#changelog-list"),
  changelogCount: document.querySelector("#changelog-count"),
};

export function openMovementModal() {
  elements.movementModal.hidden = false;
  elements.concept.focus();
}

export function closeMovementModal() {
  elements.movementModal.hidden = true;
}

export function setView(viewName) {
  elements.views.forEach((view) => view.classList.toggle("is-active", view.dataset.view === viewName));
  elements.navButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.viewTarget === viewName);
  });
}

export function setSettingsPanel(panelName) {
  elements.settingsTabs.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.settingsTarget === panelName);
  });
  elements.settingsPanels.forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.settingsPanel === panelName);
  });
}
