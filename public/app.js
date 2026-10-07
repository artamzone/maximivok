import { createObjectMaterialsSummary } from "./materials.js";

const objectMaterials = createObjectMaterialsSummary();
const form = document.querySelector("#heating-form");
const roomsContainer = document.querySelector("#rooms");
const roomTemplate = document.querySelector("#room-template");
const addRoomButton = document.querySelector("#add-room");
const newObjectButton = document.querySelector("#new-object");
const objectList = document.querySelector("#object-list");
const objectBrowser = document.querySelector(".object-browser");
const objectToggle = document.querySelector("#toggle-objects");
const mobileLayout = window.matchMedia("(max-width: 640px)");

function setObjectsExpanded(expanded) {
  objectBrowser.classList.toggle("objects-expanded", expanded);
  objectToggle.setAttribute("aria-expanded", String(expanded));
  objectToggle.textContent = expanded ? "Скрыть объекты" : "Показать объекты";
}

objectToggle.addEventListener("click", () => {
  setObjectsExpanded(objectToggle.getAttribute("aria-expanded") !== "true");
});
mobileLayout.addEventListener("change", () => setObjectsExpanded(!mobileLayout.matches));
setObjectsExpanded(!mobileLayout.matches);
const resultElement = document.querySelector("#result");
const saveNote = document.querySelector("#save-note");
const saveCardButton = document.querySelector("#save-card");
const submitButton = form.querySelector('button[type="submit"]');
let nextRoomId = 1;
let activeObjectId = null;

const statusLabels = {
  calculated: "Рассчитано",
  requires_engineer_review: "Требуется проверка инженера",
  impossible: "Невозможно рассчитать",
  unverified: "Не проверено",
  confirmed: "Подтверждено",
};

const sourceLabels = {
  "": "Не указан",
  client: "Клиент",
  engineer: "Инженер",
  project_document: "Проектная документация",
  calculation: "Расчётный модуль",
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formControl(name) {
  const control = form.elements.namedItem(name);
  if (!control) throw new Error(`Поле ${name} не найдено.`);
  return control;
}

function nullableValue(name) {
  const value = String(formControl(name).value).trim();
  return value === "" ? null : value;
}

function numberValue(element) {
  return element.value.trim() === "" ? null : Number(element.value);
}

function booleanValue(element) {
  return element.value === "" ? null : element.value === "true";
}

function updateRoomNumbers() {
  const cards = [...roomsContainer.querySelectorAll(".room-card")];
  cards.forEach((card, index) => {
    card.querySelector(".room-number").textContent = String(index + 1);
    card.querySelector(".remove-room").disabled = false;
  });
}

function syncRoomHeight(card) {
  const inherited = card.querySelector('[data-field="useHouseCeilingHeight"]').checked;
  const height = card.querySelector('[data-field="ceilingHeightM"]');
  height.readOnly = inherited;
  height.placeholder = inherited ? "Из данных дома" : "Индивидуальная высота";
  if (inherited) height.value = formControl("houseCeilingHeightM").value;
}

formControl("houseCeilingHeightM").addEventListener("input", () => {
  roomsContainer.querySelectorAll(".room-card").forEach(syncRoomHeight);
});

function addRoom(initial = {}) {
  const fragment = roomTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".room-card");
  let roomId = initial.id;
  if (!roomId) {
    do { roomId = `room-${nextRoomId++}`; }
    while ([...roomsContainer.children].some((room) => room.dataset.roomId === roomId));
  }
  card.dataset.roomId = roomId;
  for (const [field, value] of Object.entries(initial)) {
    if (field === "id") continue;
    const control = card.querySelector(`[data-field="${field}"]`);
    if (!control) continue;
    if (control.type === "checkbox") control.checked = Boolean(value);
    else control.value = value === null ? "" : String(value);
  }
  const inherit = card.querySelector('[data-field="useHouseCeilingHeight"]');
  inherit.checked = initial.useHouseCeilingHeight ?? (initial.ceilingHeightM == null);
  inherit.addEventListener("change", () => syncRoomHeight(card));
  syncRoomHeight(card);
  for (const [countField, presenceField] of [
    ["standardWindowCount", "hasStandardWindows"],
    ["panoramicWindowCount", "hasPanoramicWindows"],
    ["radiatorCount", "hasRadiator"],
  ]) {
    const count = card.querySelector(`[data-field="${countField}"]`);
    const presence = card.querySelector(`[data-field="${presenceField}"]`);
    const syncPresence = () => {
      if (count.value.trim() !== "") presence.value = Number(count.value) > 0 ? "true" : "false";
    };
    count.addEventListener("input", () => {
      if (count.value.trim() === "") presence.value = "";
      else syncPresence();
    });
    presence.addEventListener("change", () => {
      if (presence.value === "false") count.value = "0";
      else if (presence.value === "" || numberValue(count) === 0) count.value = "";
    });
    syncPresence();
  }
  card.querySelector(".remove-room").addEventListener("click", () => {
    card.remove();
    updateRoomNumbers();
  });
  roomsContainer.append(card);
  updateRoomNumbers();
}

function resetRooms(rooms = []) {
  roomsContainer.replaceChildren();
  nextRoomId = 1;
  rooms.forEach((room) => addRoom(room));
}

function collectCard() {
  return {
    client: {
      name: String(formControl("clientName").value).trim(),
      phone: nullableValue("clientPhone"),
      email: nullableValue("clientEmail"),
      notes: nullableValue("clientNotes"),
    },
    object: {
      address: String(formControl("objectAddress").value).trim(),
      name: nullableValue("objectName"),
      notes: nullableValue("objectNotes"),
    },
  };
}

function collectInput() {
  const data = new FormData(form);
  const rooms = [...roomsContainer.querySelectorAll(".room-card")].map((card) => {
    const get = (field) => card.querySelector(`[data-field="${field}"]`);
    const areaM2 = numberValue(get("areaM2"));
    const floorHeatingAreaM2 = numberValue(get("floorHeatingAreaM2"));
    if (floorHeatingAreaM2 !== null && areaM2 !== null && floorHeatingAreaM2 > areaM2) {
      throw new Error(`В помещении «${get("name").value}» площадь тёплого пола больше площади помещения.`);
    }
    return {
      id: card.dataset.roomId,
      name: get("name").value.trim(),
      areaM2,
      ceilingHeightM: numberValue(get("ceilingHeightM")),
      useHouseCeilingHeight: get("useHouseCeilingHeight").checked,
      standardWindowCount: numberValue(get("standardWindowCount")),
      panoramicWindowCount: numberValue(get("panoramicWindowCount")),
      radiatorCount: numberValue(get("radiatorCount")),
      hasStandardWindows: booleanValue(get("hasStandardWindows")),
      hasPanoramicWindows: booleanValue(get("hasPanoramicWindows")),
      floorHeatingAreaM2,
      hasRadiator: booleanValue(get("hasRadiator")),
    };
  });
  const electricPower = String(data.get("availableElectricPowerKw") ?? "").trim();
  const circuitLength = String(data.get("circuitLengthM") ?? "").trim();
  return {
    houseAreaM2: numberValue(formControl("houseAreaM2")),
    houseCeilingHeightM: numberValue(formControl("houseCeilingHeightM")),
    rooms,
    heatSource: data.get("heatSource"),
    availableElectricPowerKw: electricPower === "" ? null : Number(electricPower),
    residents: numberValue(formControl("residents")),
    baths: numberValue(formControl("baths")),
    showers: numberValue(formControl("showers")),
    includeIndirectWaterHeater: booleanValue(formControl("includeIndirectWaterHeater")),
    circuitLengthM: circuitLength === "" ? null : Number(circuitLength),
  };
}

function leafPaths(value, prefix) {
  if (Array.isArray(value)) return value.flatMap((item, index) => leafPaths(item, `${prefix}[${index}]`));
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => leafPaths(item, `${prefix}.${key}`));
  }
  return [prefix];
}

function collectCalculation() {
  const input = collectInput();
  const source = formControl("parameterSource").value;
  const verificationStatus = formControl("parameterStatus").value;
  return {
    input,
    parameterMetadata: leafPaths(input, "input").map((path) => ({ path, source, verificationStatus })),
  };
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body ? { "content-type": "application/json", ...(options.headers ?? {}) } : options.headers,
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error ?? "Ошибка запроса");
    error.issues = payload.issues ?? [];
    throw error;
  }
  return payload;
}

function statusClass(status) {
  if (status === "calculated" || status === "confirmed") return "status-calculated";
  if (status === "impossible") return "status-impossible";
  return "status-review";
}

function renderParameters(parameters) {
  const rows = parameters.map((parameter) => `
    <tr>
      <td>${parameter.kind === "input" ? "Ввод" : "Результат"}</td>
      <td><code>${escapeHtml(parameter.path)}</code></td>
      <td>${escapeHtml(sourceLabels[parameter.source] ?? parameter.source)}</td>
      <td>${escapeHtml(statusLabels[parameter.verificationStatus] ?? parameter.verificationStatus)}</td>
    </tr>
  `).join("");
  return `
    <details class="parameter-details">
      <summary>Источники и статусы параметров (${parameters.length})</summary>
      <div class="table-wrap"><table><thead><tr><th>Тип</th><th>Параметр</th><th>Источник</th><th>Статус</th></tr></thead><tbody>${rows}</tbody></table></div>
    </details>
  `;
}

function formatAmount(value, unit = "") {
  return value === null || value === undefined ? "Нет данных" : `${Number(value).toLocaleString("ru-RU")}${unit}`;
}

function missingList(block) {
  const labels = {
    rooms: "помещения", houseAreaM2: "площадь дома", heatSource: "источник тепла",
    availableElectricPowerKw: "доступная электрическая мощность",
    includeIndirectWaterHeater: "нужен ли бойлер", residents: "число жильцов", baths: "число ванн",
    circuitLengthM: "длина контура",
    showers: "число душей", floorHeatingAreaM2: "площадь ТП", hasRadiator: "наличие радиатора",
    areaM2: "площадь помещения", ceilingHeightM: "высота потолка",
    houseCeilingHeightM: "высота потолков дома",
    hasStandardWindows: "обычные окна", hasPanoramicWindows: "панорамные окна",
  };
  const missing = block.missingParameters ?? [];
  if (missing.length === 0) return "";
  return `<p>Не хватает: ${missing.map((path) => {
    const match = path.match(/^rooms\[(\d+)\]\.(.+)$/);
    return escapeHtml(match ? `помещение ${Number(match[1]) + 1}: ${labels[match[2]] ?? match[2]}` : labels[path] ?? path);
  }).join("; ")}.</p>`;
}

function renderReport(report, parameters = [], savedMessage = "") {
  const radiatorItems = report.radiators.length === 0
    ? `<li>${report.input.rooms.length === 0 ? "Нет данных о помещениях." : "Радиаторы не нужны."}</li>`
    : report.radiators.map((radiator) => `<li><strong>${escapeHtml(radiator.roomName)}</strong>: ${radiator.requiredPowerW === null ? escapeHtml(statusLabels[radiator.status]) : `${radiator.requiredPowerW} Вт суммарно для комнаты`} · радиаторов: ${formatAmount(radiator.radiatorCount, " шт.")}${missingList(radiator)}</li>`).join("");
  const messages = [...report.warnings, ...report.errors];
  const messageBlock = messages.length === 0
    ? ""
    : `<div class="result-block"><h3>Предупреждения</h3><ul class="warning-list">${messages.map((item) => `<li>${escapeHtml(item.message)}</li>`).join("")}</ul></div>`;
  resultElement.innerHTML = `
    ${savedMessage === "" ? "" : `<p class="success-box">${escapeHtml(savedMessage)}</p>`}
    <div class="result-heading"><div><p class="eyebrow">Результат</p><h2>Расчёт отопления</h2></div><span class="status ${statusClass(report.status)}">${escapeHtml(statusLabels[report.status] ?? report.status)}</span></div>
    <div class="result-grid">
      <div class="metric"><span>Труба ТП</span><strong>${formatAmount(report.floorHeating.pipeLengthM, " м")}</strong></div>
      <div class="metric"><span>Контуры</span><strong>${formatAmount(report.floorHeating.circuitCount)}</strong></div>
      <div class="metric"><span>Коллекторы</span><strong>${report.floorHeating.circuitCount === null ? "Нет данных" : report.floorHeating.collectors.join(" + ") || "—"}</strong></div>
      <div class="metric"><span>Котёл</span><strong>${report.boiler.recommendedPowerKw === null ? (report.boiler.status === "impossible" ? "Нет данных" : "Проверка") : `${report.boiler.recommendedPowerKw} кВт`}</strong></div>
      <div class="metric"><span>Работы: монтаж ТП</span><strong>${formatAmount(report.floorHeating.installationCostRub, " ₽")}</strong></div>
      <div class="metric"><span>Работы: укладка утеплителя</span><strong>${formatAmount(report.floorHeating.insulationInstallationCostRub, " ₽")}</strong></div>
    </div>
    <div class="result-block"><h3>Тёплый пол — ${escapeHtml(statusLabels[report.floorHeating.status])}</h3>${missingList(report.floorHeating)}<p>Смесительные узлы: ${formatAmount(report.floorHeating.mixingUnitCount)}</p></div>
    <div class="result-block"><h3>Стоимость известных работ</h3><p>Выше указаны только монтаж ТП и укладка утеплителя. Отобранные товары показаны отдельно в блоке «Товаров отобрано». Стоимость материалов в текущем этапе не входит в КП. Это не полная стоимость отопления.</p>${report.workPrices ? `<p>Расценки этого расчёта (версия ${escapeHtml(report.workPrices.revision)}): монтаж ТП — ${formatAmount(report.workPrices.floorHeatingRubPerM2, " ₽/м²")}; утеплитель — ${formatAmount(report.workPrices.insulationRubPerM2, " ₽/м²")}.</p>` : ""}</div>
    <div class="result-block"><h3>Параметры помещений</h3><ul>${report.input.rooms.map((room) => `<li><strong>${escapeHtml(room.name)}</strong>: потолок ${formatAmount(room.ceilingHeightM, " м")}${room.useHouseCeilingHeight ? " (из дома)" : ""}; обычных окон ${formatAmount(room.standardWindowCount)}; панорамных окон ${formatAmount(room.panoramicWindowCount)}; радиаторов ${formatAmount(room.radiatorCount)}.</li>`).join("")}</ul></div>
    <div class="result-block"><h3>Радиаторы</h3><ul>${radiatorItems}</ul><p class="hint">Мощность указана для всей комнаты, не для одного радиатора. Количество сохранено для дальнейшего подбора по паспортной мощности.</p></div>
    <div class="result-block"><h3>Котёл — ${escapeHtml(statusLabels[report.boiler.status])}</h3><p>${escapeHtml(report.boiler.note)}</p>${missingList(report.boiler)}</div>
    <div class="result-block"><h3>Бойлер — ${escapeHtml(statusLabels[report.waterHeater.status])}</h3><p>${escapeHtml(report.waterHeater.note)}</p><p>Объём: ${report.input.includeIndirectWaterHeater === false ? "Не нужен" : formatAmount(report.waterHeater.recommendedVolumeL, " л")}</p>${missingList(report.waterHeater)}</div>
    <div class="result-block"><h3>Котельная — ${escapeHtml(statusLabels[report.boilerRoom.status])}</h3><p>${escapeHtml(report.boilerRoom.note)}</p>${missingList(report.boilerRoom)}</div>
    <details><summary>Применённые правила</summary><ul>${report.appliedRules.map((rule) => `<li>${escapeHtml(rule.code)} — ${escapeHtml(rule.description)}</li>`).join("")}</ul></details>
    ${messageBlock}
    ${renderParameters(parameters)}
    <details><summary>Полный JSON-отчёт</summary><pre>${escapeHtml(JSON.stringify(report, null, 2))}</pre></details>
    <div class="submit-actions"><button type="button" class="secondary" id="export-input">Скачать исходные данные JSON</button><button type="button" class="secondary" id="export-report">Скачать отчёт JSON</button></div>
  `;
  const download = (value, filename) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + "\n"], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };
  resultElement.querySelector("#export-input").addEventListener("click", () => download(report.input, "heating-input.json"));
  resultElement.querySelector("#export-report").addEventListener("click", () => download(report, "heating-report.json"));
  resultElement.hidden = false;
  resultElement.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderError(message, issues = []) {
  resultElement.innerHTML = `<div class="error-box"><strong>${escapeHtml(message)}</strong>${issues.length === 0 ? "" : `<ul>${issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}</ul>`}</div>`;
  resultElement.hidden = false;
  resultElement.scrollIntoView({ behavior: "smooth", block: "start" });
}

function formatDate(value) {
  if (!value) return "Нет расчётов";
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function renderObjectList(objects) {
  if (objects.length === 0) {
    objectList.innerHTML = '<p class="muted">Сохранённых объектов пока нет.</p>';
    return;
  }
  objectList.innerHTML = objects.map((object) => `
    <button class="object-item${object.id === activeObjectId ? " active" : ""}" type="button" data-object-id="${escapeHtml(object.id)}">
      <strong>${escapeHtml(object.objectName ?? object.address)}</strong>
      <span>${escapeHtml(object.clientName)}</span>
      <span class="status ${object.latestCalculationStatus === null ? "status-empty" : statusClass(object.latestCalculationStatus)}">${escapeHtml(object.latestCalculationStatus === null ? "Без расчёта" : (statusLabels[object.latestCalculationStatus] ?? "Без расчёта"))}</span>
      <small>${escapeHtml(object.address)} · ${escapeHtml(formatDate(object.latestCalculationAt))}</small>
    </button>
  `).join("");
  objectList.querySelectorAll("[data-object-id]").forEach((button) => {
    button.addEventListener("click", () => void loadObject(button.dataset.objectId));
  });
}

async function loadObjects() {
  void objectMaterials.setObject(activeObjectId);
  try {
    const payload = await api("/api/objects");
    renderObjectList(payload.objects);
  } catch (error) {
    objectList.innerHTML = `<p class="error-text">${escapeHtml(error.message)}</p>`;
  }
}

function setValue(name, value) {
  formControl(name).value = value ?? "";
}

function populateInput(input) {
  setValue("houseAreaM2", input.houseAreaM2);
  setValue("houseCeilingHeightM", input.houseCeilingHeightM);
  setValue("heatSource", input.heatSource);
  setValue("availableElectricPowerKw", input.availableElectricPowerKw);
  setValue("circuitLengthM", input.circuitLengthM);
  setValue("residents", input.residents);
  setValue("baths", input.baths);
  setValue("showers", input.showers);
  setValue("includeIndirectWaterHeater", input.includeIndirectWaterHeater);
  resetRooms(input.rooms);
}

async function loadObject(objectId) {
  try {
    const details = await api(`/api/objects/${encodeURIComponent(objectId)}`);
    activeObjectId = details.id;
    form.reset();
    resetRooms();
    resultElement.hidden = true;
    resultElement.replaceChildren();
    setValue("clientName", details.client.name);
    setValue("clientPhone", details.client.phone);
    setValue("clientEmail", details.client.email);
    setValue("clientNotes", details.client.notes);
    setValue("objectName", details.object.name);
    setValue("objectAddress", details.object.address);
    setValue("objectNotes", details.object.notes);
    const latest = details.calculations[0];
    if (latest) {
      populateInput(latest.input);
      const inputParameter = latest.parameters.find((parameter) => parameter.kind === "input");
      if (inputParameter) {
        setValue("parameterSource", inputParameter.source);
        setValue("parameterStatus", inputParameter.verificationStatus);
      }
      renderReport(latest.report, latest.parameters, "Загружена последняя сохранённая версия.");
    }
    saveNote.textContent = `Карточка сохранена. Новый расчёт будет добавлен как отдельная версия (${details.calculations.length + 1}).`;
    await loadObjects();
    if (mobileLayout.matches) setObjectsExpanded(false);
  } catch (error) {
    renderError(error.message, error.issues ?? []);
  }
}

function startNewObject() {
  activeObjectId = null;
  if (mobileLayout.matches) setObjectsExpanded(false);
  form.reset();
  resetRooms();
  resultElement.hidden = true;
  resultElement.replaceChildren();
  saveNote.textContent = "Можно сохранить только карточку, заполнив имя клиента и адрес.";
  void loadObjects();
  formControl("clientName").focus();
}

addRoomButton.addEventListener("click", () => addRoom());
newObjectButton.addEventListener("click", startNewObject);
saveCardButton.addEventListener("click", async () => {
  const requiredControls = [formControl("clientName"), formControl("objectAddress")];
  if (!requiredControls.every((control) => control.reportValidity())) return;
  saveCardButton.disabled = true;
  saveCardButton.textContent = "Сохраняется…";
  try {
    const card = collectCard();
    if (activeObjectId === null) {
      const details = await api("/api/objects", { method: "POST", body: JSON.stringify(card) });
      activeObjectId = details.id;
    } else {
      await api(`/api/objects/${encodeURIComponent(activeObjectId)}`, {
        method: "PATCH",
        body: JSON.stringify(card),
      });
    }
    resultElement.innerHTML = '<p class="success-box">Данные клиента и реквизиты объекта сохранены. Изменения параметров отопления не сохранены; для этого нажмите «Сохранить и рассчитать». Ранее сохранённые версии не изменены.</p>';
    resultElement.hidden = false;
    saveNote.textContent = "Карточка сохранена отдельно от параметров отопления.";
    await loadObjects();
  } catch (error) {
    renderError(error instanceof Error ? error.message : "Не удалось сохранить карточку.", error.issues ?? []);
  } finally {
    saveCardButton.disabled = false;
    saveCardButton.textContent = "Сохранить карточку";
  }
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  submitButton.disabled = true;
  submitButton.textContent = "Сохраняется…";
  try {
    const card = collectCard();
    const calculation = collectCalculation();
    let savedCalculation;
    if (activeObjectId === null) {
      const details = await api("/api/objects", {
        method: "POST",
        body: JSON.stringify({ ...card, calculation }),
      });
      activeObjectId = details.id;
      savedCalculation = details.calculations[0];
    } else {
      await api(`/api/objects/${encodeURIComponent(activeObjectId)}`, {
        method: "PATCH",
        body: JSON.stringify(card),
      });
      savedCalculation = await api(`/api/objects/${encodeURIComponent(activeObjectId)}/calculations`, {
        method: "POST",
        body: JSON.stringify(calculation),
      });
    }
    if (!savedCalculation) throw new Error("Сохранённый расчёт не получен от сервера.");
    renderReport(savedCalculation.report, savedCalculation.parameters, "Карточка и расчёт сохранены в SQLite.");
    saveNote.textContent = "Карточка сохранена. Следующий расчёт будет добавлен как отдельная версия.";
    await loadObjects();
  } catch (error) {
    renderError(error instanceof Error ? error.message : "Не удалось сохранить расчёт.", error.issues ?? []);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Сохранить и рассчитать";
  }
});

function refreshMaterialsOnReturn() {
  if (document.visibilityState === "visible") void objectMaterials.refresh();
}
window.addEventListener("focus", refreshMaterialsOnReturn);
document.addEventListener("visibilitychange", refreshMaterialsOnReturn);

resetRooms();
void loadObjects();
