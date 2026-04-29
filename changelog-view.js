import { elements } from "./dom.js";
import { formatDate } from "./utils.js";

export function renderChangelog() {
  const entries = window.FlowGridChangelog ?? [];
  elements.changelogCount.textContent = `${entries.length} sesiones`;
  elements.changelogList.innerHTML = "";

  if (!entries.length) {
    elements.changelogList.innerHTML = '<p class="empty-state">No hay novedades registradas.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();

  entries.forEach((entry) => {
    const item = document.createElement("article");
    const date = document.createElement("time");
    const meta = document.createElement("div");
    const title = document.createElement("h3");
    const list = document.createElement("ul");

    item.className = "changelog-item";
    meta.className = "changelog-meta";
    date.dateTime = entry.date;
    date.textContent = formatDate(entry.date);
    meta.append(date);

    if (entry.commit) {
      const commit = document.createElement("code");
      commit.textContent = entry.commit;
      meta.append(commit);
    }

    title.textContent = entry.title;

    entry.changes.forEach((change) => {
      const listItem = document.createElement("li");
      listItem.textContent = change;
      list.append(listItem);
    });

    item.append(meta, title, list);
    fragment.append(item);
  });

  elements.changelogList.append(fragment);
}
