const form = document.querySelector("#heating-form");
const roomsContainer = document.querySelector("#rooms");
const roomTemplate = document.querySelector("#room-template");
const addRoomButton = document.querySelector("#add-room");
const resultElement = document.querySelector("#result");
const submitButton = form.querySelector('button[type="submit"]');
let nextRoomId = 1;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
  card.dataset.roomId = `room-${nextRoomId++}`;
  for (const [field, value] of Object.entries(initial)) {
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

const statusLabels = {
  calculated: "Рассчитано",
  requires_engineer_review: "Требуется проверка инженера",
  impossible: "Невозможно рассчитать",
};

function statusClass(status) {
  if (status === "calculated") return "status-calculated";
  if (status === "impossible") return "status-impossible";
  return "status-review";
}

function renderReport(report) {
  const radiatorItems = report.radiators.length === 0
    ? "<li>Радиаторы не указаны.</li>"
    : report.radiators.map((radiator) => `<li><strong>${escapeHtml(radiator.roomName)}</strong>: ${radiator.requiredPowerW === null ? "проверяет инженер" : `${radiator.requiredPowerW} Вт`}</li>`).join("");
  const messages = [...report.warnings, ...report.errors];
  const messageBlock = messages.length === 0
    ? ""
    : `<div class="result-block"><h3>Предупреждения</h3><ul class="warning-list">${messages.map((item) => `<li>${escapeHtml(item.message)}</li>`).join("")}</ul></div>`;

  resultElement.innerHTML = `
    <div class="result-header">
      <div><p class="eyebrow">Результат</p><h2>Расчёт отопления</h2></div>
      <span class="status ${statusClass(report.status)}">${escapeHtml(statusLabels[report.status] ?? report.status)}</span>
    </div>
    <div class="metrics">
      <div class="metric"><span>Труба тёплого пола</span><strong>${report.floorHeating.pipeLengthM} м</strong></div>
      <div class="metric"><span>Контуры</span><strong>${report.floorHeating.circuitCount}</strong></div>
      <div class="metric"><span>Коллекторы</span><strong>${report.floorHeating.collectors.length === 0 ? "—" : report.floorHeating.collectors.join(" + ")}</strong></div>
      <div class="metric"><span>Смесительные узлы</span><strong>${report.floorHeating.mixingUnitCount}</strong></div>
      <div class="metric"><span>Монтаж ТП</span><strong>${report.floorHeating.installationCostRub.toLocaleString("ru-RU")} ₽</strong></div>
      <div class="metric"><span>Укладка утеплителя</span><strong>${report.floorHeating.insulationInstallationCostRub.toLocaleString("ru-RU")} ₽</strong></div>
      <div class="metric"><span>Мощность котла</span><strong>${report.boiler.recommendedPowerKw === null ? "Инженер" : `${report.boiler.recommendedPowerKw} кВт`}</strong></div>
      <div class="metric"><span>Объём бойлера</span><strong>${report.waterHeater.recommendedVolumeL === null ? "—" : `${report.waterHeater.recommendedVolumeL} л`}</strong></div>
    </div>
    <div class="result-block"><h3>Радиаторы</h3><ul>${radiatorItems}</ul></div>
    <div class="result-block"><h3>Котельная</h3><p>${escapeHtml(report.boilerRoom.note)}</p></div>
    ${messageBlock}
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

addRoomButton.addEventListener("click", () => addRoom());
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  submitButton.disabled = true;
  submitButton.textContent = "Выполняется расчёт…";
  try {
    const response = await fetch("/api/calculate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(collectInput()),
    });
    const payload = await response.json();
    if (!response.ok) throw Object.assign(new Error(payload.error ?? "Ошибка расчёта"), { issues: payload.issues ?? [] });
    renderReport(payload);
  } catch (error) {
    renderError(error instanceof Error ? error.message : "Не удалось выполнить расчёт.", error.issues ?? []);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Рассчитать отопление";
  }
});

addRoom({ name: "Гостиная", areaM2: 30, floorHeatingAreaM2: 25 });
addRoom({ name: "Спальня", areaM2: 18, floorHeatingAreaM2: 15 });
