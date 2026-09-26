// Selector de tema visual de la app. Hoy hay dos modos: "classic"
// (verde teal sobre fondo gris suave, default) y "rosa-palo" (acento
// rosa empolvado #d97a98 sobre fondo rosa muy claro). Implementado vía
// custom properties CSS — el HTML lleva `data-theme="rosa-palo"` en
// <html> cuando se aplica, y el bloque correspondiente del CSS redefine
// las variables (`--bg`, `--teal`, `--teal-hover`, `--nav`).
//
// Nota: este tema se llamó "lavanda" hasta 2026-06, pero el color real
// nunca fue lavanda (violeta claro) sino rosa palo. readTheme() migra
// el valor antiguo guardado en localStorage para no resetear a quien ya
// lo tenía elegido.
//
// Persistencia: localStorage. La preferencia sobrevive entre
// sesiones (a diferencia de la vista activa, que vive en
// sessionStorage). El script inline en index.html aplica el tema
// antes del bootstrap del módulo para evitar el flash inicial.

const THEME_STORAGE_KEY = "flowgrid.theme.v1";
const VALID_THEMES = new Set(["classic", "rosa-palo"]);
// Valores legacy → valor actual. "lavanda" era el nombre erróneo del
// tema rosa palo.
const THEME_ALIASES = { lavanda: "rosa-palo" };

export function readTheme() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (!stored) return "classic";
    const migrated = THEME_ALIASES[stored] ?? stored;
    if (VALID_THEMES.has(migrated)) return migrated;
  } catch {
    // ignore
  }
  return "classic";
}

export function applyTheme(theme) {
  const normalised = VALID_THEMES.has(theme) ? theme : "classic";
  if (normalised === "classic") {
    // Sin atributo: usa los valores por defecto de :root.
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = normalised;
  }
  try {
    localStorage.setItem(THEME_STORAGE_KEY, normalised);
  } catch {
    // ignore
  }
  // Sincroniza el estado visual del selector de la pantalla
  // Configuración → Tema (si está renderizado).
  syncThemeToggleVisual(normalised);
}

function syncThemeToggleVisual(theme) {
  const buttons = document.querySelectorAll("[data-theme-value]");
  buttons.forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.themeValue === theme);
  });
}

// Wire-up: clicks sobre los botones del selector aplican y
// persisten. El boot lee el storage y aplica al iniciar.
document.querySelectorAll("[data-theme-value]").forEach((btn) => {
  btn.addEventListener("click", () => {
    applyTheme(btn.dataset.themeValue);
  });
});

// Aplicar al cargar — pone el atributo data-theme y refleja el
// botón activo. El script inline ya pone el atributo antes del
// bootstrap para evitar flash; esta llamada solo confirma el
// estado del selector visual.
applyTheme(readTheme());
