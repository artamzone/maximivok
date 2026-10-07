function node(tag, text, className = "") {
  const result = document.createElement(tag);
  result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}

function kopecks(value) {
  const amount = BigInt(value);
  return `${new Intl.NumberFormat("ru-RU").format(amount / 100n)},${String(amount % 100n).padStart(2, "0")} ₽`;
}

const priceFormat = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 20 });
const priceText = (value) => value === null ? "Цена не указана" : `${priceFormat.format(value)}${value === 0 ? " — требует проверки" : ""}`;

async function api(url, options) {
  const response = await fetch(url, options);
  const value = await response.json();
  if (!response.ok) throw new Error([value.error ?? "Ошибка запроса", ...(value.issues ?? [])].join("\n"));
  return value;
}

export async function initializeMaterials() {
  const params = new URLSearchParams(location.search);
  if (!params.has("objectId")) return null;
  const panel = document.querySelector("#materials-panel");
  panel.hidden = false;
  const errorBox = document.querySelector("#materials-error");
  const message = document.querySelector("#materials-message");
  const objectId = params.get("objectId");
  if (!objectId?.trim() || objectId.length > 100 || params.getAll("objectId").length !== 1) {
    errorBox.textContent = "Некорректный объект. Откройте материалы из сохранённой карточки.";
    errorBox.hidden = false;
    message.textContent = "Материалы не загружены.";
    return null;
  }
  document.querySelector("h1").textContent = "Материалы объекта";
  const endpoint = `/api/objects/${encodeURIComponent(objectId)}/materials`;
  const form = document.querySelector("#materials-form");
  const controls = document.querySelector("#materials-controls");
  const list = document.querySelector("#materials-selection");
  const empty = document.querySelector("#materials-empty");
  const saveButton = document.querySelector("#materials-save");
  const history = document.querySelector("#materials-version");
  const historyView = document.querySelector("#materials-version-view");
  let selection = [];
  let versions = [];
  let baseVersionId = null;
  let dirty = false;
  let busy = false;
  let ready = false;
  let historyRequest = 0;
  const snapshots = new Map();

  function showError(error) {
    errorBox.textContent = error instanceof Error ? error.message : "Не удалось выполнить запрос.";
    errorBox.hidden = false;
  }
  function changed() {
    dirty = true;
    saveButton.disabled = false;
    errorBox.hidden = true;
    message.textContent = "Есть несохранённые изменения. Суммы будут рассчитаны по ценам каталога при сохранении.";
  }
  function renderSelection() {
    list.replaceChildren();
    empty.hidden = selection.length > 0;
    for (const item of selection) {
      const row = node("li", undefined, "materials-row");
      row.dataset.productId = item.productId;
      const info = node("div", undefined, "materials-info");
      info.append(node("strong", item.name), node("p", `Единица: ${item.unit}. Цена в черновике: ${priceText(item.priceRub)}`, "muted"));
      const label = node("label", `Количество, ${item.unit}`);
      const input = document.createElement("input");
      input.type = "number";
      input.step = "any";
      input.min = "0";
      input.required = true;
      input.value = item.quantity;
      input.setAttribute("aria-label", `Количество: ${item.name}`);
      input.addEventListener("input", () => {
        item.quantity = input.value;
        input.setCustomValidity("");
        changed();
      });
      label.append(input);
      const remove = node("button", "Убрать", "secondary");
      remove.type = "button";
      remove.setAttribute("aria-label", `Убрать: ${item.name}`);
      remove.addEventListener("click", () => {
        selection = selection.filter((entry) => entry.productId !== item.productId);
        changed();
        renderSelection();
      });
      row.append(info, label, remove);
      list.append(row);
    }
  }
  function renderSnapshot(version) {
    historyView.replaceChildren();
    historyView.dataset.versionId = version.id;
    historyView.append(node("h3", `Версия ${version.versionNumber} · ${new Date(version.createdAt).toLocaleString("ru-RU")}`));
    historyView.append(node("p", `Известная стоимость материалов: ${kopecks(version.knownTotalKopecks)}`, "catalog-price"));
    historyView.append(node("p", `Без цены: ${version.unpricedCount}. С нулевой ценой: ${version.zeroPriceCount}.`, "hint"));
    if (version.unpricedCount || version.zeroPriceCount) historyView.append(node("p", "Стоимость неполная или требует проверки инженера. Неизвестная цена не равна нулю.", "warning-list"));
    const lines = node("ul", undefined, "materials-snapshot");
    for (const item of version.items) {
      const row = node("li");
      row.append(node("strong", item.name), node("p", `${item.quantity} ${item.unit} · Цена: ${priceText(item.priceRub)} · Сумма: ${item.lineTotalKopecks === null ? "неизвестна" : kopecks(item.lineTotalKopecks)}`));
      row.append(node("p", `Артикул: ${item.article ?? "не указан"} · Источник: ${item.source}`, "muted"));
      lines.append(row);
    }
    historyView.append(version.items.length ? lines : node("p", "Пустая комплектация.", "muted"));
  }
  function renderVersions(selected) {
    history.replaceChildren();
    history.disabled = versions.length === 0;
    for (const version of versions) {
      const option = node("option", `v${version.versionNumber} · ${new Date(version.createdAt).toLocaleString("ru-RU")}`);
      option.value = version.id;
      history.append(option);
    }
    if (selected) history.value = selected;
  }
  function useLatest(version) {
    baseVersionId = version?.id ?? null;
    selection = version ? version.items.map((item) => ({ ...item, quantity: String(item.quantity) })) : [];
    dirty = false;
    saveButton.disabled = false;
    renderSelection();
    historyRequest++;
    renderVersions(baseVersionId);
    if (version) { snapshots.set(version.id, version); renderSnapshot(version); }
    else historyView.replaceChildren(node("p", "Сохранённых версий пока нет.", "muted"));
  }
  async function reload() {
    if (busy || (dirty && !window.confirm("Загрузить последнюю версию и заменить несохранённый черновик материалов?"))) return;
    busy = true;
    controls.disabled = true;
    errorBox.hidden = true;
    try {
      const collection = await api(endpoint);
      document.querySelector("#materials-object").textContent = `${collection.object.clientName} · ${collection.object.address}${collection.object.name ? ` · ${collection.object.name}` : ""}`;
      versions = collection.versions;
      useLatest(collection.latest);
      ready = true;
      message.textContent = collection.latest ? `Открыта версия ${collection.latest.versionNumber}. Новое сохранение обновит цены.` : "Выберите товары из каталога ниже и введите количества.";
    } catch (error) { showError(error); }
    finally { busy = false; controls.disabled = false; }
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !ready) return;
    for (const input of list.querySelectorAll("input")) {
      input.setCustomValidity(Number.isFinite(Number(input.value)) && Number(input.value) > 0 ? "" : "Введите число больше нуля");
    }
    if (!form.reportValidity()) return;
    if (selection.length === 0 && !window.confirm("Сохранить новую пустую комплектацию? Предыдущие версии останутся в истории.")) return;
    busy = true;
    controls.disabled = true;
    errorBox.hidden = true;
    message.textContent = "Сохраняю новую версию по актуальным ценам…";
    try {
      const saved = await api(endpoint, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseVersionId, items: selection.map((item) => ({ productId: item.productId, quantity: Number(item.quantity), expectedUnit: item.unit })) }),
      });
      versions.unshift(saved);
      useLatest(saved);
      message.textContent = `Сохранена версия ${saved.versionNumber}. Известная стоимость: ${kopecks(saved.knownTotalKopecks)}. Без цены: ${saved.unpricedCount}; с нулевой ценой: ${saved.zeroPriceCount}.`;
    } catch (error) {
      message.textContent = "Сохранение не подтверждено. Черновик оставлен на экране. При потере связи загрузите последнюю версию перед повтором.";
      showError(error);
    } finally { busy = false; controls.disabled = false; }
  });
  document.querySelector("#materials-reload").addEventListener("click", () => { void reload(); });
  history.addEventListener("change", async () => {
    const id = ++historyRequest;
    const versionId = history.value;
    historyView.replaceChildren(node("p", "Загрузка версии…"));
    try {
      const version = snapshots.get(versionId) ?? await api(`${endpoint}/${encodeURIComponent(versionId)}`);
      if (id !== historyRequest) return;
      snapshots.set(versionId, version);
      renderSnapshot(version);
    } catch (error) { if (id === historyRequest) historyView.replaceChildren(node("p", error.message, "error-box")); }
  });
  window.addEventListener("beforeunload", (event) => {
    if (dirty) { event.preventDefault(); event.returnValue = ""; }
  });
  await reload();
  return {
    addProduct(product) {
      if (busy) return;
      if (!ready) { showError(new Error("Сначала загрузите материалы объекта.")); return; }
      const existing = selection.find((item) => item.productId === product.id);
      if (existing) message.textContent = "Этот товар уже выбран. Измените количество в существующей строке.";
      else {
        if (selection.length >= 500) { showError(new Error("В одной версии допускается не более 500 строк.")); return; }
        selection.push({ productId: product.id, name: product.name, unit: product.unit, priceRub: product.priceRub, quantity: "" });
        changed();
        renderSelection();
      }
      panel.scrollIntoView({ behavior: "smooth", block: "start" });
      const row = [...list.children].find((entry) => entry.dataset.productId === product.id);
      row?.querySelector("input")?.focus({ preventScroll: true });
    },
  };
}

/** Read-only summary on the object page. Never updates its form or heating report. */
export function createObjectMaterialsSummary() {
  const panel = document.querySelector("#object-materials-panel");
  const details = document.querySelector("#object-materials-details");
  const summary = document.querySelector("#object-materials-summary");
  const content = document.querySelector("#object-materials-content");
  const hint = document.querySelector("#materials-link-hint");
  const link = document.querySelector("#object-materials-link");
  const errorBox = document.querySelector("#object-materials-error");
  const retry = document.querySelector("#object-materials-retry");
  let objectId = null;
  let requestId = 0;
  let controller;

  function countLabel(count) {
    const last = count % 10;
    const teen = count % 100 >= 11 && count % 100 <= 14;
    return `${count} ${!teen && last === 1 ? "позиция" : !teen && last >= 2 && last <= 4 ? "позиции" : "позиций"}`;
  }
  function renderVersion(version) {
    const count = version?.items.length ?? 0;
    summary.textContent = `Добавленные материалы — ${countLabel(count)}`;
    link.textContent = count === 0 ? "Добавить материалы" : "Перейти в материалы";
    hint.textContent = "Материалы пока не добавлены.";
    hint.hidden = count > 0;
    if (!version) return;
    content.append(node("p", `Версия ${version.versionNumber} · ${new Date(version.createdAt).toLocaleString("ru-RU")}`, "hint"));
    if (count > 0) {
      const wrap = node("div", undefined, "table-wrap object-materials-table");
      wrap.tabIndex = 0;
      wrap.setAttribute("role", "region");
      wrap.setAttribute("aria-label", "Список сохранённых материалов");
      const table = node("table");
      const head = node("thead");
      const headings = node("tr");
      for (const label of ["Товар", "Количество", "Ед.", "Цена", "Сумма"]) {
        const th = node("th", label);
        th.setAttribute("scope", "col");
        headings.append(th);
      }
      head.append(headings);
      const body = node("tbody");
      for (const item of version.items) {
        const row = node("tr");
        const name = node("td");
        name.append(node("strong", item.name), node("p", `Артикул: ${item.article ?? "не указан"}`, "muted"));
        row.append(name, node("td", String(item.quantity)), node("td", item.unit),
          node("td", priceText(item.priceRub)),
          node("td", item.lineTotalKopecks === null ? "Неизвестна" : kopecks(item.lineTotalKopecks)));
        body.append(row);
      }
      table.append(head, body);
      wrap.append(table);
      content.append(wrap);
    } else content.append(node("p", "В этой сохранённой версии нет товаров.", "muted"));
    content.append(node("p", `Известная стоимость материалов: ${kopecks(version.knownTotalKopecks)}`, "catalog-price"));
    if (version.unpricedCount || version.zeroPriceCount) {
      content.append(node("p", `Без цены: ${version.unpricedCount}. С нулевой ценой: ${version.zeroPriceCount}. Стоимость неполная или требует проверки инженера.`, "warning-list"));
    }
    content.append(node("p", "Последняя сохранённая комплектация. Она не привязана к версии расчёта отопления и не является полной стоимостью объекта.", "hint"));
  }
  async function refresh() {
    controller?.abort();
    const id = ++requestId;
    const requestedObject = objectId;
    content.replaceChildren();
    errorBox.hidden = true;
    retry.hidden = true;
    hint.hidden = false;
    link.hidden = requestedObject === null;
    if (requestedObject === null) {
      link.href = "/catalog";
      summary.textContent = "Добавленные материалы — 0 позиций";
      hint.textContent = "Сначала сохраните карточку объекта.";
      panel.setAttribute("aria-busy", "false");
      return;
    }
    link.href = `/catalog?objectId=${encodeURIComponent(requestedObject)}`;
    link.title = "Открыть материалы объекта в новой вкладке";
    summary.textContent = "Добавленные материалы — загрузка…";
    hint.textContent = "Загрузка сохранённых материалов…";
    panel.setAttribute("aria-busy", "true");
    controller = new AbortController();
    try {
      const collection = await api(`/api/objects/${encodeURIComponent(requestedObject)}/materials`, { signal: controller.signal });
      if (id !== requestId || requestedObject !== objectId) return;
      if (collection.object?.id !== requestedObject) throw new Error("Получены материалы другого объекта.");
      renderVersion(collection.latest);
    } catch (error) {
      if (id !== requestId || requestedObject !== objectId || error.name === "AbortError") return;
      content.replaceChildren();
      summary.textContent = "Добавленные материалы — не загружены";
      link.textContent = "Перейти в материалы";
      hint.hidden = true;
      errorBox.textContent = "Не удалось загрузить сохранённые материалы. Повторите загрузку или перейдите на страницу материалов.";
      errorBox.hidden = false;
      retry.hidden = false;
    } finally {
      if (id === requestId) panel.setAttribute("aria-busy", "false");
    }
  }
  retry.addEventListener("click", () => { void refresh(); });
  return {
    async setObject(id) {
      if (objectId !== id) {
        details.open = false;
        link.textContent = "Перейти в материалы";
      }
      objectId = id;
      await refresh();
    },
    refresh,
  };
}
