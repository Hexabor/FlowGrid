import { elements } from "../core/dom.js";
import { formatDate } from "../core/utils.js";

// Renderiza el changelog en formato compacto: las entradas arrancan
// colapsadas (solo título visible) y se expanden al pulsarlas, igual
// que un acordeón. La fecha solo aparece como separador cuando cambia
// respecto a la entrada anterior — así un mismo día con N entradas
// muestra la fecha una sola vez. Ese separador queda sticky dentro de
// su propia sección, mismo patrón que .month-group en Movimientos.
export function renderChangelog() {
  // Ordenamos por fecha descendente para garantizar que las entradas
  // del mismo día queden contiguas (independientemente del orden en
  // que se hayan añadido al array fuente) y que el conjunto vaya de
  // la novedad más reciente a la más antigua.
  const entries = (window.FlowGridChangelog ?? [])
    .slice()
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  elements.changelogCount.textContent = `${entries.length} sesiones`;
  elements.changelogList.innerHTML = "";

  if (!entries.length) {
    elements.changelogList.innerHTML = '<p class="empty-state">No hay novedades registradas.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();
  let currentSection = null;
  let currentDate = null;

  entries.forEach((entry) => {
    if (entry.date !== currentDate) {
      // Nueva fecha: cierro la sección anterior abriendo otra. Cada
      // sección es el "containing block" del sticky de su propio
      // header de fecha, así al llegar al siguiente día el header se
      // desadhiere de forma natural en lugar de quedar pegado.
      currentSection = document.createElement("div");
      currentSection.className = "changelog-date-section";
      const header = document.createElement("div");
      header.className = "changelog-date-header";
      const time = document.createElement("time");
      time.dateTime = entry.date;
      time.textContent = formatDate(entry.date);
      header.append(time);
      currentSection.append(header);
      fragment.append(currentSection);
      currentDate = entry.date;
    }

    const item = document.createElement("details");
    item.className = "changelog-item";

    const summary = document.createElement("summary");
    const title = document.createElement("h3");
    title.className = "changelog-title";
    title.textContent = entry.title;
    summary.append(title);
    if (entry.commit) {
      const commit = document.createElement("code");
      commit.className = "changelog-commit";
      commit.textContent = entry.commit;
      summary.append(commit);
    }
    item.append(summary);

    if (Array.isArray(entry.changes) && entry.changes.length) {
      const list = document.createElement("ul");
      list.className = "changelog-changes";
      entry.changes.forEach((change) => {
        const li = document.createElement("li");
        li.textContent = change;
        list.append(li);
      });
      item.append(list);
    }

    currentSection.append(item);
  });

  elements.changelogList.append(fragment);
}
