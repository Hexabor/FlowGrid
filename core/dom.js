export const elements = {
  navButtons: document.querySelectorAll(".nav-button"),
  navigationTargets: document.querySelectorAll("[data-view-target]"),
  views: document.querySelectorAll(".view"),
  form: document.querySelector("#movement-form"),
  movementModal: document.querySelector("#movement-modal"),
  openMovementModal: document.querySelector("#open-movement-modal"),
  homeAddMovementCta: document.querySelector("#home-add-movement-cta"),
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
  partySuggestions: document.querySelector("#party-suggestions"),
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
  // Bloque "compartir con un grupo" del modal de gasto. Se muestra
  // cuando el picker selecciona un value con prefijo "group:".
  sharedGroupFields: document.querySelector("#shared-group-fields"),
  sharedGroupPayer: document.querySelector("#shared-group-payer"),
  sharedGroupMode: document.querySelector("#shared-group-mode"),
  sharedGroupShares: document.querySelector("#shared-group-shares"),
  sharedGroupFeedback: document.querySelector("#shared-group-feedback"),
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
  sharedMobileBackToAll: document.querySelector("#shared-mobile-back-to-all"),
  sharedMobilePickerRow: document.querySelector(".shared-mobile-picker-row"),
  sharedMobilePickerLabel: document.querySelector(".shared-mobile-picker"),
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
  recurringDayOfMonthField: document.querySelector("#recurring-day-of-month-field"),
  recurringMonthOfYear: document.querySelector("#recurring-month-of-year"),
  recurringMonthOfYearField: document.querySelector("#recurring-month-of-year-field"),
  recurringCustomizeDayToggle: document.querySelector("#recurring-customize-day-toggle"),
  recurringStartDate: document.querySelector("#recurring-start-date"),
  recurringStartDateTrigger: document.querySelector("#recurring-start-date-trigger"),
  recurringEndDate: document.querySelector("#recurring-end-date"),
  recurringEndDateTrigger: document.querySelector("#recurring-end-date-trigger"),
  recurringEndDateClear: document.querySelector("#recurring-end-date-clear"),
  convertToRecurring: document.querySelector("#convert-to-recurring"),
  // Grupos (gestión en Configuración → Grupos).
  groupsList: document.querySelector("#groups-list"),
  groupsEmpty: document.querySelector("#groups-empty"),
  groupsCount: document.querySelector("#groups-count"),
  groupCreateForm: document.querySelector("#group-create-form"),
  newGroupName: document.querySelector("#new-group-name"),
  groupModal: document.querySelector("#group-modal"),
  closeGroupModal: document.querySelector("#close-group-modal"),
  groupModalTitle: document.querySelector("#group-modal-title"),
  groupRenameForm: document.querySelector("#group-rename-form"),
  groupRenameInput: document.querySelector("#group-rename-input"),
  groupAdminBadge: document.querySelector("#group-admin-badge"),
  groupRoleHint: document.querySelector("#group-role-hint"),
  groupMembersList: document.querySelector("#group-members-list"),
  groupAddMemberForm: document.querySelector("#group-add-member-form"),
  groupAddMemberSelect: document.querySelector("#group-add-member-select"),
  groupNewContactForm: document.querySelector("#group-new-contact-form"),
  groupNewContactName: document.querySelector("#group-new-contact-name"),
  groupNewContactEmail: document.querySelector("#group-new-contact-email"),
  groupLeaveButton: document.querySelector("#group-leave-button"),
  groupDeleteButton: document.querySelector("#group-delete-button"),
  groupModalDone: document.querySelector("#group-modal-done"),
  // Toggle Contactos/Grupos dentro de la vista "Contactos y grupos".
  // OJO: el selector va con `button[...]` para no matchear contenedores
  // que también lleven el atributo (eso fue el bug del 2026-05-03 — el
  // listener del padre disparaba después del de los botones y machacaba
  // la decisión de toggle).
  contactsModeButtons: document.querySelectorAll("button[data-contacts-mode]"),
  contactsPanes: document.querySelectorAll("[data-contacts-pane]"),
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
  recurringSharedGroupInfo: document.querySelector("#recurring-shared-group-info"),
  recurringGroupHint: document.querySelector("#recurring-group-hint"),
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
  // Re-querying en cada llamada para evitar cualquier issue de NodeList
  // capturado en frío al cargar el módulo. classList.add/remove
  // explícitos en lugar de toggle(force) por si el navegador interpreta
  // raro el segundo argumento.
  document.querySelectorAll("[data-analysis-mode]").forEach((btn) => {
    if (btn.dataset.analysisMode === normalised) {
      btn.classList.add("is-active");
    } else {
      btn.classList.remove("is-active");
    }
  });
  document.querySelectorAll("[data-analysis-pane]").forEach((pane) => {
    pane.hidden = pane.dataset.analysisPane !== normalised;
  });
  try {
    localStorage.setItem(ANALYSIS_MODE_KEY, normalised);
  } catch {
    // ignore
  }
}

// La vista activa se persiste en sessionStorage (vive solo durante la
// sesión del navegador): así si el usuario refresca dentro de la app
// no pierde contexto, pero al cerrar y volver a abrir arranca en
// Home. localStorage hacía que la última vista persistiera para
// siempre, comportamiento que el usuario consideró ruido al abrir.
export function setView(viewName, { skipHistoryPush = false } = {}) {
  const resolved = VIEW_ALIASES[viewName] ?? viewName;
  elements.views.forEach((view) => view.classList.toggle("is-active", view.dataset.view === resolved));
  elements.navButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.viewTarget === resolved);
  });
  try {
    sessionStorage.setItem(VIEW_STORAGE_KEY, resolved);
  } catch {
    // sessionStorage may be unavailable (private mode, quota); ignore.
  }
  // History API: cada cambio de vista deja una entrada en el historial
  // del navegador, así el gesto "atrás" del móvil (o el botón back del
  // browser) deshace el último cambio en lugar de salir de la app.
  // skipHistoryPush evita el bucle cuando el cambio viene de popstate.
  if (!skipHistoryPush) {
    const currentState = history.state;
    if (!currentState || currentState.view !== resolved) {
      try {
        history.pushState({ view: resolved }, "", "");
      } catch {
        // Algunos navegadores rechazan pushState en file:// o limites.
      }
    }
  }
  if (resolved === "analysis") {
    setAnalysisMode(readAnalysisMode());
  }
  if (resolved === "contacts-groups") {
    setContactsMode(readContactsMode());
  }
}

export function restoreLastView() {
  let stored;
  try {
    stored = sessionStorage.getItem(VIEW_STORAGE_KEY);
  } catch {
    return;
  }
  if (!stored) return;
  const exists = Array.from(elements.views).some((view) => view.dataset.view === stored);
  if (exists) setView(stored, { skipHistoryPush: true });
}

// Inicializa el History API al arrancar la app: replaceState con la
// vista actual para que cualquier pushState posterior tenga un estado
// "anterior" al que volver via popstate. Sin esto, el primer back
// del usuario sacaría de la app (no hay entry previa que restaurar).
export function initHistoryNav() {
  const activeView =
    document.querySelector(".view.is-active")?.dataset.view ?? "home";
  try {
    history.replaceState({ view: activeView }, "", "");
  } catch {
    // ignore
  }
  window.addEventListener("popstate", (event) => {
    const view = event.state?.view ?? "home";
    setView(view, { skipHistoryPush: true });
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

const CONTACTS_MODE_KEY = "flowgrid.contacts.mode.v1";

function readContactsMode() {
  try {
    const stored = localStorage.getItem(CONTACTS_MODE_KEY);
    if (stored === "contacts" || stored === "groups") return stored;
  } catch {
    // ignore
  }
  return "contacts";
}

// Toggle entre los sub-paneles "Contactos" y "Grupos" dentro de la
// vista top-level "Contactos y grupos". Persiste en localStorage para
// que volver a abrir la vista te lleve donde estabas.
export function setContactsMode(mode) {
  const normalised = mode === "groups" ? "groups" : "contacts";
  // Re-query fresco + add/remove explícitos por las mismas razones que
  // setAnalysisMode más arriba.
  document.querySelectorAll("button[data-contacts-mode]").forEach((btn) => {
    if (btn.dataset.contactsMode === normalised) {
      btn.classList.add("is-active");
    } else {
      btn.classList.remove("is-active");
    }
  });
  document.querySelectorAll("[data-contacts-pane]").forEach((pane) => {
    pane.hidden = pane.dataset.contactsPane !== normalised;
  });
  try {
    localStorage.setItem(CONTACTS_MODE_KEY, normalised);
  } catch {
    // ignore
  }
}

// Llamar al entrar a la vista "Contactos y grupos" para restaurar la
// subpestaña que el usuario tenía la última vez.
export function applyStoredContactsMode() {
  setContactsMode(readContactsMode());
}
