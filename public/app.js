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
  return Number(element.value);
}

function updateRoomNumbers() {
  const cards = [...roomsContainer.querySelectorAll(".room-card")];
  cards.forEach((card, index) => {
    card.querySelector(".room-number").textContent = String(index + 1);
    card.querySelector(".remove-room").disabled = cards.length === 1;
  });
}

function addRoom(initial = {}) {
  const fragment = roomTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".room-card");
  card.dataset.roomId = initial.id ?? `room-${nextRoomId++}`;
  for (const [field, value] of Object.entries(initial)) {
    if (field === "id") continue;
    const control = card.querySelector(`[data-field="${field}"]`);
    if (!control) continue;
    if (control.type === "checkbox") control.checked = Boolean(value);
    else control.value = String(value);
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
  if (rooms.length === 0) {
    addRoom({ name: "Гостиная", areaM2: 30, floorHeatingAreaM2: 25 });
    addRoom({ name: "Спальня", areaM2: 18, floorHeatingAreaM2: 15 });
  } else {
    rooms.forEach((room) => addRoom(room));
  }
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
    if (floorHeatingAreaM2 > areaM2) {
      throw new Error(`В помещении «${get("name").value}» площадь тёплого пола больше площади помещения.`);
    }
    return {
      id: card.dataset.roomId,
      name: get("name").value.trim(),
      areaM2,
      ceilingHeightM: numberValue(get("ceilingHeightM")),
      hasStandardWindows: get("hasStandardWindows").checked,
      hasPanoramicWindows: get("hasPanoramicWindows").checked,
      floorHeatingAreaM2,
      hasRadiator: get("hasRadiator").checked,
    };
  });
  const electricPower = String(data.get("availableElectricPowerKw") ?? "").trim();
  const circuitLength = String(data.get("circuitLengthM") ?? "").trim();
  return {
    houseAreaM2: Number(data.get("houseAreaM2")),
    rooms,
    heatSource: data.get("heatSource"),
    availableElectricPowerKw: electricPower === "" ? null : Number(electricPower),
    residents: Number(data.get("residents")),
    baths: Number(data.get("baths")),
    showers: Number(data.get("showers")),
    includeIndirectWaterHeater: data.has("includeIndirectWaterHeater"),
    ...(circuitLength === "" ? {} : { circuitLengthM: Number(circuitLength) }),
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

function renderReport(report, parameters = [], savedMessage = "") {
  const radiatorItems = report.radiators.length === 0
    ? "<li>Радиаторы не указаны.</li>"
    : report.radiators.map((radiator) => `<li><strong>${escapeHtml(radiator.roomName)}</strong>: ${radiator.requiredPowerW === null ? "проверяет инженер" : `${radiator.requiredPowerW} Вт`}</li>`).join("");
  const messages = [...report.warnings, ...report.errors];
  const messageBlock = messages.length === 0
    ? ""
    : `<div class="result-block"><h3>Предупреждения</h3><ul class="warning-list">${messages.map((item) => `<li>${escapeHtml(item.message)}</li>`).join("")}</ul></div>`;
  resultElement.innerHTML = `
    ${savedMessage === "" ? "" : `<p class="success-box">${escapeHtml(savedMessage)}</p>`}
    <div class="result-heading"><div><p class="eyebrow">Результат</p><h2>Расчёт отопления</h2></div><span class="status ${statusClass(report.status)}">${escapeHtml(statusLabels[report.status] ?? report.status)}</span></div>
    <div class="result-grid">
      <div class="metric"><span>Труба ТП</span><strong>${report.floorHeating.pipeLengthM} м</strong></div>
      <div class="metric"><span>Контуры</span><strong>${report.floorHeating.circuitCount}</strong></div>
      <div class="metric"><span>Коллекторы</span><strong>${report.floorHeating.collectors.join(" + ") || "—"}</strong></div>
      <div class="metric"><span>Котёл</span><strong>${report.boiler.recommendedPowerKw === null ? "Проверка" : `${report.boiler.recommendedPowerKw} кВт`}</strong></div>
      <div class="metric"><span>Монтаж ТП</span><strong>${report.floorHeating.installationCostRub.toLocaleString("ru-RU")} ₽</strong></div>
      <div class="metric"><span>Утеплитель</span><strong>${report.floorHeating.insulationInstallationCostRub.toLocaleString("ru-RU")} ₽</strong></div>
    </div>
    <div class="result-block"><h3>Радиаторы</h3><ul>${radiatorItems}</ul></div>
    <div class="result-block"><h3>Котельная</h3><p>${escapeHtml(report.boilerRoom.note)}</p></div>
    ${messageBlock}
    ${renderParameters(parameters)}
    <details><summary>Полный JSON-отчёт</summary><pre>${escapeHtml(JSON.stringify(report, null, 2))}</pre></details>
  `;
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
  setValue("heatSource", input.heatSource);
  setValue("availableElectricPowerKw", input.availableElectricPowerKw);
  setValue("circuitLengthM", input.circuitLengthM);
  setValue("residents", input.residents);
  setValue("baths", input.baths);
  setValue("showers", input.showers);
  formControl("includeIndirectWaterHeater").checked = input.includeIndirectWaterHeater;
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
    resultElement.innerHTML = '<p class="success-box">Карточка сохранена. Расчёт можно добавить после заполнения исходных данных.</p>';
    resultElement.hidden = false;
    saveNote.textContent = "Карточка сохранена. Расчётов пока может не быть.";
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

resetRooms();
void loadObjects();
