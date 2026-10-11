// UI вкладки /santeh?objectId=... — TASK-04, подэтап E2 + правильная модель комнат (TaskCheck P1).
// Комнаты с уникальным roomId (из отопления или ручной ввод), внутри — массив fixtures.

const FIXTURE_TYPES = [
  { type: "bath", name: "Ванна", hotWater: true, coldWater: true, sewageDiameter: 50, drainsToFloor: false },
  { type: "shower_cabin", name: "Душевая кабина", hotWater: true, coldWater: true, sewageDiameter: 50, drainsToFloor: true },
  { type: "sink", name: "Раковина", hotWater: true, coldWater: true, sewageDiameter: 50, drainsToFloor: false },
  { type: "hygiene_shower", name: "Гигиенический душ", hotWater: true, coldWater: true, sewageDiameter: 50, drainsToFloor: false },
  { type: "kitchen_sink", name: "Кухонная мойка", hotWater: true, coldWater: true, sewageDiameter: 50, drainsToFloor: false },
  { type: "toilet", name: "Унитаз", hotWater: false, coldWater: true, sewageDiameter: 110, drainsToFloor: false },
  { type: "washing_machine", name: "Стиральная машина", hotWater: false, coldWater: true, sewageDiameter: 50, drainsToFloor: false },
  { type: "dishwasher", name: "Посудомоечная машина", hotWater: false, coldWater: true, sewageDiameter: 50, drainsToFloor: false },
];

const SEWAGE_WORK_IDS = [
  { id: "sewage_point_50", name: "Точка канализации Ø50" },
  { id: "sewage_point_110", name: "Точка канализации Ø110" },
  { id: "sewer_main", name: "Прокладка лежака (м)" },
  { id: "sewage_standpipe", name: "Фановый стояк" },
];

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

const priceFormat = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 });
// Стоимость: null/отсутствие → "Не рассчитано" (не "0 ₽"). 0 отображается явно как 0 ₽.
function formatCost(kopecks) {
  if (kopecks === null || kopecks === undefined) return "Не рассчитано";
  return priceFormat.format(kopecks / 100);
}
// Совместимость со старым именем; теперь различает null и 0.
const kopToRub = formatCost;
const dateText = (iso) => new Date(iso).toLocaleString("ru-RU");

// Объединённый бейдж: costStatus и status — разные статусы. В UI выводим оба с пояснением.
function statusBadge(status) {
  const map = {
    calculated: ["status-calculated", "рассчитано"],
    requires_engineer_review: ["status-review", "нужна проверка"],
    impossible: ["status-impossible", "невозможно"],
  };
  const [cls, label] = map[status] ?? ["status-empty", status ?? "—"];
  return node("span", label, `status ${cls}`);
}

// Бейдж стоимости: учитывает её отдельно от статуса блока. "Снимок цен не передан" → не 0 ₽.
function costStatusLabel(costStatus) {
  if (costStatus === "calculated") return "стоимость посчитана";
  if (costStatus === "requires_engineer_review") return "стоимость требует проверки";
  if (costStatus === "impossible") return "стоимость не рассчитана";
  return "стоимость неизвестна";
}

const params = new URLSearchParams(location.search);
const objectIdRaw = params.get("objectId");
if (!objectIdRaw || objectIdRaw.length > 100 || params.getAll("objectId").length !== 1) {
  const error = document.querySelector("#santeh-error");
  error.textContent = "Откройте сантехнику из сохранённой карточки: ?objectId=<id>. Сначала сохраните карточку на главной.";
  error.hidden = false;
  document.querySelector("#santeh-status").textContent = "Объект не выбран.";
} else {
  void initializeSanteh(objectIdRaw);
}

/** Возвращает уникальный roomId: «room-<n>» пока нет коллизий. */
function makeRoomId(existingIds) {
  let n = 1;
  while (existingIds.has(`room-${n}`)) n += 1;
  return `room-${n}`;
}

async function initializeSanteh(objectId) {
  const objectIdEncoded = encodeURIComponent(objectId);
  const errorBox = document.querySelector("#santeh-error");
  const status = document.querySelector("#santeh-status");
  const objectLabel = document.querySelector("#santeh-object");
  const waterForm = document.querySelector("#water-form");
  const waterControls = document.querySelector("#water-controls");
  const waterRooms = document.querySelector("#water-rooms");
  const addRoomButton = document.querySelector("#add-water-room");
  const recirculationCheckbox = document.querySelector("#water-has-recirculation");
  const recirculationLength = document.querySelector("#water-recirculation-length");
  const waterResult = document.querySelector("#water-result");
  const waterSaveButton = document.querySelector("#water-save");
  const waterCalculateButton = document.querySelector("#water-calculate");
  const sewageControls = document.querySelector("#sewage-controls");
  const sewageTrapCount = document.querySelector("#sewage-trap-count");
  const sewageStandpipes = document.querySelector("#sewage-standpipes");
  const sewageAlready = document.querySelector("#sewage-already-executed");
  const sewageMains = document.querySelector("#sewage-mains");
  const sewageAddMain = document.querySelector("#sewage-add-main");
  const sewageResult = document.querySelector("#sewage-result");
  const sewageSaveButton = document.querySelector("#sewage-save");
  const sewageCalculateButton = document.querySelector("#sewage-calculate");
  const waterVersions = document.querySelector("#water-versions");
  const sewageVersions = document.querySelector("#sewage-versions");

  let objectDetails = null;
  /**
   * Модель комнат (TaskCheck P1):
   * rooms: [{ id, name, hasRecirculation: bool|null, fixtures: [{ type, count, lengthM, comment }] }]
   * id — уникальный roomId; name — для UI; hasRecirculation — на комнату;
   * fixtures — массив приборов с типом, количеством, длиной трассы и комментарием.
   */
  let rooms = [];
  let mainRows = []; // [{ id, roomIds, lengthM, alreadyExecuted }] — roomIds берутся из rooms[].id
  let plumbingRevision = 0;
  let sewageRevision = 0;
  let busy = false;
  let dirty = false;

  function showError(error) {
    errorBox.textContent = error instanceof Error ? error.message : "Не удалось выполнить запрос.";
    errorBox.hidden = false;
  }
  function markDirty() {
    dirty = true;
    waterSaveButton.disabled = false;
    sewageSaveButton.disabled = false;
    errorBox.hidden = true;
  }
  function syncRecirculationState() {
    // Глобальный чекбокс «включена рециркуляция» теперь управляет только длиной петли.
    // Сама рециркуляция задаётся per-room в комнате.
    recirculationLength.disabled = !recirculationCheckbox.checked;
    if (!recirculationCheckbox.checked) recirculationLength.value = "";
  }
  function setBusy(value) {
    busy = value;
    waterControls.disabled = value;
    sewageControls.disabled = value;
    waterSaveButton.disabled = value || !dirty;
    sewageSaveButton.disabled = value || !dirty;
    waterCalculateButton.disabled = value;
    sewageCalculateButton.disabled = value;
  }

  /** ID всех текущих комнат — для уникальности roomId. */
  function existingRoomIds() {
    return new Set(rooms.map((r) => r.id));
  }

  function buildPlumbingInput() {
    const recircRaw = recirculationLength.value;
    const recirculationLengthM = recircRaw === "" ? null : Number(recircRaw);
    // Глобальный чекбокс «включена рециркуляция» — это переключатель длины петли.
    // Само наличие рециркуляции (recirculationPoints) — на уровне комнаты.
    const cleanedRooms = rooms
      .filter((r) => r.id && r.fixtures.length > 0)
      .map((r) => ({
        roomId: r.id,
        hasRecirculation: r.hasRecirculation === undefined ? null : r.hasRecirculation,
        fixtures: r.fixtures
          .filter((f) => f.type)
          .map((f) => ({
            type: f.type,
            count: Math.max(0, Math.floor(Number(f.count) || 0)),
            lengthM: f.lengthM === null || f.lengthM === undefined || f.lengthM === "" ? null : Number(f.lengthM),
            comment: f.comment ?? "",
          })),
      }));
    return {
      rooms: cleanedRooms,
      hotWaterSource: waterForm.elements.namedItem("hotWaterSource").value,
      recirculationLengthM,
    };
  }

  function buildSewageInput() {
    const trapRaw = sewageTrapCount.value;
    const trapCount = trapRaw === "" ? null : Number(trapRaw);
    const standpipesRaw = sewageStandpipes.value;
    const standpipes = standpipesRaw === "" ? 0 : Number(standpipesRaw);
    const alreadyExecuted = [...sewageAlready.querySelectorAll("input[type='checkbox']")].filter((cb) => cb.checked).map((cb) => cb.value);
    return {
      sewer: {
        trapCount,
        alreadyExecuted,
        sewerMains: mainRows.filter((m) => m.roomIds.length > 0).map((m) => ({
          id: m.id,
          fromRoomIds: m.roomIds,
          lengthM: m.lengthM,
          alreadyExecuted: m.alreadyExecuted,
        })),
        standpipes,
      },
      plumbing: buildPlumbingInput(),
    };
  }

  // ============ Комнаты (новая модель) ============

  function renderRoomCard(card, room, index) {
    card.replaceChildren();
    card.dataset.roomIndex = String(index);

    const head = node("div", undefined, "santeh-room-head");
    const title = node("span", `Комната #${index + 1}`, "santeh-room-title");
    head.append(title);

    const nameLabel = node("label", "Название");
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.maxLength = 200;
    nameInput.placeholder = "Например, Ванная 1 этаж";
    nameInput.value = room.name ?? "";
    nameInput.addEventListener("input", () => { rooms[index].name = nameInput.value; markDirty(); });
    nameLabel.append(nameInput);
    head.append(nameLabel);

    const idLabel = node("label", "ID комнаты");
    const idInput = document.createElement("input");
    idInput.type = "text";
    idInput.maxLength = 200;
    idInput.value = room.id;
    idInput.addEventListener("change", () => {
      const newId = idInput.value.trim();
      if (newId === "" || newId === room.id) {
        idInput.value = room.id;
        return;
      }
      const clash = rooms.some((r, i) => i !== index && r.id === newId);
      if (clash) {
        showError(new Error(`ID "${newId}" уже используется другой комнатой.`));
        idInput.value = room.id;
        return;
      }
      rooms[index].id = newId;
      renderMains();
      markDirty();
    });
    idLabel.append(idInput);
    head.append(idLabel);

    const recircLabel = node("label");
    const recircSelect = document.createElement("select");
    for (const [value, label] of [
      ["", "Неизвестно"],
      ["true", "Включена"],
      ["false", "Отключена"],
    ]) {
      const opt = node("option", label);
      opt.value = value;
      recircSelect.append(opt);
    }
    const currentRecirc = room.hasRecirculation;
    recircSelect.value = currentRecirc === true ? "true" : currentRecirc === false ? "false" : "";
    recircSelect.addEventListener("change", () => {
      const v = recircSelect.value;
      rooms[index].hasRecirculation = v === "" ? null : v === "true";
      markDirty();
    });
    recircLabel.append(node("span", "Рециркуляция ГВС"), recircSelect);
    head.append(recircLabel);

    const remove = node("button", "Удалить комнату", "secondary");
    remove.type = "button";
    remove.addEventListener("click", () => {
      rooms.splice(index, 1);
      renderAllRooms();
      renderMains();
      markDirty();
    });
    head.append(remove);

    card.append(head);

    const fixturesList = node("div", undefined, "santeh-fixtures-list");
    room.fixtures.forEach((fixture, fIndex) => {
      const row = node("div", undefined, "santeh-fixture-row");
      renderFixtureRow(row, room, index, fIndex);
      fixturesList.append(row);
    });
    card.append(fixturesList);

    const addFixture = node("button", "+ Добавить прибор", "secondary");
    addFixture.type = "button";
    addFixture.addEventListener("click", () => {
      rooms[index].fixtures.push({ type: "", count: 1, lengthM: null, comment: "" });
      renderRoomCard(card, room, index);
      renderMains();
      markDirty();
    });
    card.append(addFixture);
  }

  function renderFixtureRow(row, room, roomIndex, fixtureIndex) {
    row.replaceChildren();
    row.dataset.fixtureIndex = String(fixtureIndex);

    const head = node("div", undefined, "santeh-fixture-head");
    const typeLabel = node("label", "Прибор");
    const typeSelect = document.createElement("select");
    const blankOption = node("option", "— выберите —");
    blankOption.value = "";
    typeSelect.append(blankOption);
    for (const def of FIXTURE_TYPES) {
      const flags = [];
      if (def.hotWater) flags.push("ГВС");
      if (def.coldWater) flags.push("ХВС");
      if (def.sewageDiameter) flags.push(`Ø${def.sewageDiameter}`);
      const option = node("option", `${def.name} (${flags.join(", ")})`);
      option.value = def.type;
      typeSelect.append(option);
    }
    typeSelect.value = room.fixtures[fixtureIndex]?.type ?? "";
    typeSelect.addEventListener("change", () => {
      rooms[roomIndex].fixtures[fixtureIndex].type = typeSelect.value;
      renderMains();
      markDirty();
    });
    typeLabel.append(typeSelect);
    head.append(typeLabel);

    const countLabel = node("label", "Кол-во");
    const countInput = document.createElement("input");
    countInput.type = "number";
    countInput.min = "0";
    countInput.step = "1";
    countInput.value = String(room.fixtures[fixtureIndex]?.count ?? 1);
    countInput.addEventListener("input", () => {
      rooms[roomIndex].fixtures[fixtureIndex].count = Math.max(0, Math.floor(Number(countInput.value) || 0));
      markDirty();
    });
    countLabel.append(countInput);
    head.append(countLabel);

    const remove = node("button", "Удалить", "secondary");
    remove.type = "button";
    remove.addEventListener("click", () => {
      rooms[roomIndex].fixtures.splice(fixtureIndex, 1);
      renderRoomCard(row.parentElement.parentElement, room, roomIndex);
      renderMains();
      markDirty();
    });
    head.append(remove);
    row.append(head);

    const lengthLabel = node("label", "Длина трассы к прибору, м");
    const lengthInput = document.createElement("input");
    lengthInput.type = "number";
    lengthInput.min = "0";
    lengthInput.step = "0.1";
    const initialLength = room.fixtures[fixtureIndex]?.lengthM;
    lengthInput.value = initialLength === null || initialLength === undefined ? "" : String(initialLength);
    lengthInput.placeholder = "Неизвестно";
    lengthInput.addEventListener("input", () => {
      const v = lengthInput.value;
      rooms[roomIndex].fixtures[fixtureIndex].lengthM = v === "" ? null : Number(v);
      markDirty();
    });
    lengthLabel.append(lengthInput);
    row.append(lengthLabel);

    const commentLabel = node("label", "Комментарий");
    const commentInput = document.createElement("input");
    commentInput.type = "text";
    commentInput.maxLength = 500;
    commentInput.placeholder = "Например, основная ванная";
    commentInput.value = room.fixtures[fixtureIndex]?.comment ?? "";
    commentInput.addEventListener("input", () => {
      rooms[roomIndex].fixtures[fixtureIndex].comment = commentInput.value;
      markDirty();
    });
    commentLabel.append(commentInput);
    row.append(commentLabel);
  }

  function renderAllRooms() {
    waterRooms.replaceChildren();
    if (rooms.length === 0) {
      waterRooms.append(node("p", "Комнат пока нет. Добавьте хотя бы одну, чтобы задать приборы.", "muted"));
      return;
    }
    rooms.forEach((room, index) => {
      const card = node("div", undefined, "santeh-room-card");
      renderRoomCard(card, room, index);
      waterRooms.append(card);
    });
  }

  function addRoom(initial = {}) {
    const ids = existingRoomIds();
    const id = initial.id && !ids.has(initial.id) ? initial.id : makeRoomId(ids);
    rooms.push({
      id,
      name: initial.name ?? "",
      hasRecirculation: initial.hasRecirculation === undefined ? null : initial.hasRecirculation,
      fixtures: Array.isArray(initial.fixtures) ? initial.fixtures.map((f) => ({
        type: f.type ?? "",
        count: Math.max(0, Math.floor(Number(f.count) || 0)),
        lengthM: f.lengthM ?? null,
        comment: f.comment ?? "",
      })) : [],
    });
    renderAllRooms();
    renderMains();
    markDirty();
  }

  // ============ Лежаки канализации ============

  function renderMains() {
    sewageMains.replaceChildren();
    if (rooms.length === 0) {
      sewageMains.append(node("p", "Сначала добавьте комнаты — здесь можно будет выбрать их для лежаков.", "muted"));
    }
    mainRows.forEach((main, index) => {
      const row = node("div", undefined, "santeh-main");
      const heading = node("p", `Лежак #${index + 1}`, "hint");
      row.append(heading);

      // Чекбоксы по комнатам, у которых есть канализационные приборы.
      const sewageRooms = rooms.filter((r) =>
        r.fixtures.some((f) => {
          const def = FIXTURE_TYPES.find((d) => d.type === f.type);
          return def && def.sewageDiameter;
        }),
      );
      if (sewageRooms.length === 0) {
        row.append(node("p", "В комнатах пока нет приборов со стоком. Добавьте приборы в комнате выше.", "muted"));
      } else {
        const roomsBlock = node("div", undefined, "santeh-main-rooms");
        for (const r of sewageRooms) {
          const defs = r.fixtures
            .filter((f) => f.type)
            .map((f) => FIXTURE_TYPES.find((d) => d.type === f.type)?.name)
            .filter(Boolean);
          const label = node("label");
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.dataset.mainRoom = r.id;
          cb.value = r.id;
          cb.checked = main.roomIds.includes(r.id);
          cb.addEventListener("change", () => {
            if (cb.checked) {
              if (!main.roomIds.includes(r.id)) main.roomIds.push(r.id);
            } else {
              main.roomIds = main.roomIds.filter((id) => id !== r.id);
            }
            markDirty();
          });
          const title = r.name?.trim() ? r.name : r.id;
          label.append(cb, ` ${title} (${defs.join(", ") || "нет приборов"})`);
          roomsBlock.append(label);
        }
        row.append(roomsBlock);
      }

      const lengthLabel = node("label", "Длина лежака, м");
      const lengthInput = document.createElement("input");
      lengthInput.type = "number";
      lengthInput.min = "0";
      lengthInput.step = "0.1";
      lengthInput.value = String(main.lengthM);
      lengthInput.addEventListener("input", () => { main.lengthM = Number(lengthInput.value || 0); markDirty(); });
      lengthLabel.append(lengthInput);
      row.append(lengthLabel);

      const executedLabel = node("label");
      const executedCb = document.createElement("input");
      executedCb.type = "checkbox";
      executedCb.checked = main.alreadyExecuted;
      executedCb.addEventListener("change", () => { main.alreadyExecuted = executedCb.checked; markDirty(); });
      executedLabel.append(executedCb, " Уже выполнено");
      row.append(executedLabel);

      const remove = node("button", "Удалить", "secondary");
      remove.type = "button";
      remove.addEventListener("click", () => { mainRows.splice(index, 1); renderMains(); markDirty(); });
      row.append(remove);
      sewageMains.append(row);
    });
  }

  function addMain() {
    mainRows.push({ id: `main-${Date.now()}-${mainRows.length + 1}`, roomIds: [], lengthM: 0, alreadyExecuted: false });
    renderMains();
    markDirty();
  }

  function renderSewageWorkChecklist() {
    sewageAlready.replaceChildren();
    for (const work of SEWAGE_WORK_IDS) {
      const label = node("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = work.id;
      cb.addEventListener("change", markDirty);
      label.append(cb, ` ${work.name}`);
      sewageAlready.append(label);
    }
  }

  // ============ Результаты расчёта ============

  function renderWaterResult(report) {
    waterResult.replaceChildren();
    waterResult.hidden = false;
    const grid = node("div", "result-grid");
    for (const [label, value] of [
      ["Статус расчёта", statusBadge(report.status)],
      ["ХВС точек", String(report.coldWaterPoints)],
      ["ГВС точек", String(report.hotWaterPoints)],
      ["Рециркуляция точек", report.recirculationPoints === null ? "—" : String(report.recirculationPoints)],
      ["Статус стоимости", statusBadge(report.costStatus)],
      ["Стоимость", formatCost(report.costSubtotalKopecks)],
    ]) {
      const metric = node("div", undefined, "metric");
      metric.append(node("span", label), node("strong", typeof value === "string" ? value : ""));
      if (typeof value !== "string") metric.append(value);
      grid.append(metric);
    }
    waterResult.append(grid);
    if (report.costSubtotalKopecks === null) {
      const hint = node("p", `Пояснение: ${costStatusLabel(report.costStatus)} — сумма неизвестна, не подставляется 0 ₽.`, "hint");
      waterResult.append(hint);
    }
    if (report.costLines.length > 0) {
      const lines = node("table");
      const head = node("thead");
      const headings = node("tr");
      for (const label of ["Работа", "Кол-во", "Ед.", "Цена, ₽/ед.", "Сумма, ₽"]) headings.append(node("th", label));
      head.append(headings);
      const body = node("tbody");
      for (const line of report.costLines) {
        const row = node("tr");
        row.append(node("td", line.name), node("td", String(line.quantity)), node("td", line.unit), node("td", String(line.unitPriceRub)), node("td", priceFormat.format(line.totalKopecks / 100)));
        body.append(row);
      }
      lines.append(head, body);
      waterResult.append(node("h3", "Смета"), lines);
    }
    if (report.warnings.length > 0 || report.costWarnings.length > 0) {
      const box = node("div", undefined, "warning-list");
      for (const warning of [...report.warnings, ...report.costWarnings]) box.append(node("p", `${warning.code}: ${warning.message}`));
      waterResult.append(node("h3", "Предупреждения"), box);
    }
  }
  function renderSewageResult(report) {
    sewageResult.replaceChildren();
    sewageResult.hidden = false;
    const grid = node("div", "result-grid");
    for (const [label, value] of [
      ["Статус расчёта", statusBadge(report.status)],
      ["Ø50 точек", String(report.points50)],
      ["Ø110 точек", String(report.points110)],
      ["Длина лежаков, м", String(report.lengthM)],
      ["Статус стоимости", statusBadge(report.costStatus)],
      ["Стоимость", formatCost(report.costSubtotalKopecks)],
    ]) {
      const metric = node("div", undefined, "metric");
      metric.append(node("span", label), node("strong", typeof value === "string" ? value : ""));
      if (typeof value !== "string") metric.append(value);
      grid.append(metric);
    }
    sewageResult.append(grid);
    if (report.costSubtotalKopecks === null) {
      const hint = node("p", `Пояснение: ${costStatusLabel(report.costStatus)} — сумма неизвестна, не подставляется 0 ₽.`, "hint");
      sewageResult.append(hint);
    }
    if (report.costLines.length > 0) {
      const lines = node("table");
      const head = node("thead");
      const headings = node("tr");
      for (const label of ["Работа", "Кол-во", "Ед.", "Цена, ₽/ед.", "Сумма, ₽"]) headings.append(node("th", label));
      head.append(headings);
      const body = node("tbody");
      for (const line of report.costLines) {
        const row = node("tr");
        row.append(node("td", line.name), node("td", String(line.quantity)), node("td", line.unit), node("td", String(line.unitPriceRub)), node("td", priceFormat.format(line.totalKopecks / 100)));
        body.append(row);
      }
      lines.append(head, body);
      sewageResult.append(node("h3", "Смета"), lines);
    }
    if (report.warnings.length > 0) {
      const box = node("div", undefined, "warning-list");
      for (const warning of report.warnings) box.append(node("p", `${warning.code}: ${warning.message}`));
      sewageResult.append(node("h3", "Предупреждения"), box);
    }
  }
  function renderVersions() {
    waterVersions.replaceChildren();
    if (objectDetails.plumbingCalculations.length === 0) waterVersions.append(node("li", "Сохранённых версий пока нет.", "muted"));
    for (const version of objectDetails.plumbingCalculations) {
      const li = node("li");
      li.append(
        node("strong", dateText(version.createdAt)),
        " расчёт: ",
        statusBadge(version.report.status),
        " стоимость: ",
        statusBadge(version.report.costStatus),
        node("span", ` · ХВС ${version.report.coldWaterPoints}, ГВС ${version.report.hotWaterPoints} · ${formatCost(version.report.costSubtotalKopecks)}`, "muted"),
      );
      waterVersions.append(li);
    }
    sewageVersions.replaceChildren();
    if (objectDetails.sewageCalculations.length === 0) sewageVersions.append(node("li", "Сохранённых версий пока нет.", "muted"));
    for (const version of objectDetails.sewageCalculations) {
      const li = node("li");
      const standpipes = version.input.sewer.standpipes ?? 0;
      li.append(
        node("strong", dateText(version.createdAt)),
        " расчёт: ",
        statusBadge(version.report.status),
        " стоимость: ",
        statusBadge(version.report.costStatus),
        node("span", ` · Ø50 ${version.report.points50}, Ø110 ${version.report.points110}, ${version.report.lengthM} м, ${standpipes} стояков · ${formatCost(version.report.costSubtotalKopecks)}`, "muted"),
      );
      sewageVersions.append(li);
    }
  }

  // ============ Загрузка и предзаполнение ============

  function populateFromHeating(heatingInput) {
    // Из отопления берём только roomId (id помещения) и name; всё остальное вручную.
    if (!heatingInput || !Array.isArray(heatingInput.rooms)) return [];
    return heatingInput.rooms
      .filter((r) => r && typeof r.id === "string" && r.id.length > 0)
      .map((r) => ({
        id: r.id,
        name: r.name ?? "",
        hasRecirculation: null,
        fixtures: [],
      }));
  }

  function populateFromSavedPlumbing(saved) {
    if (!saved) return null;
    return {
      rooms: (saved.rooms ?? []).map((r) => ({
        id: r.roomId,
        name: "",
        hasRecirculation: r.hasRecirculation === undefined ? null : r.hasRecirculation,
        fixtures: (r.fixtures ?? []).map((f) => ({
          type: f.type,
          count: Math.max(0, Math.floor(Number(f.count) || 0)),
          lengthM: f.lengthM ?? null,
          comment: f.comment ?? "",
        })),
      })),
      recirculationLengthM: saved.recirculationLengthM ?? null,
      hotWaterSource: saved.hotWaterSource ?? "unknown",
    };
  }

  async function reloadObject() {
    setBusy(true);
    errorBox.hidden = true;
    status.textContent = "Загрузка объекта…";
    try {
      objectDetails = await api(`/api/objects/${objectIdEncoded}`);
      objectLabel.textContent = `${objectDetails.client.name} · ${objectDetails.object.address}${objectDetails.object.name ? ` · ${objectDetails.object.name}` : ""}`;
      renderSewageWorkChecklist();
      renderVersions();
      renderSewageWorkChecklist();
      renderVersions();

      // Порядок предзаполнения:
      // 1) последняя сохранённая версия водоснабжения (если есть);
      // 2) иначе — последняя версия отопления (только roomId, без приборов);
      // 3) иначе — пустой список с возможностью ручного добавления.
      const lastPlumbing = objectDetails.plumbingCalculations[0];
      const plumbingLoaded = populateFromSavedPlumbing(lastPlumbing?.input);
      if (plumbingLoaded) {
        rooms = plumbingLoaded.rooms;
        recirculationLength.value = plumbingLoaded.recirculationLengthM !== null && plumbingLoaded.recirculationLengthM !== undefined ? String(plumbingLoaded.recirculationLengthM) : "";
        waterForm.elements.namedItem("hotWaterSource").value = plumbingLoaded.hotWaterSource;
      } else {
        const lastHeating = objectDetails.calculations[0];
        rooms = populateFromHeating(lastHeating?.input);
        recirculationLength.value = "";
        waterForm.elements.namedItem("hotWaterSource").value = "unknown";
        if (rooms.length === 0) {
          statusHint("Комнат из отопления нет. Добавьте комнаты вручную кнопкой «+ Добавить комнату».");
        }
      }
      // Глобальный чекбокс «включена рециркуляция» — производный: true, если хотя бы в одной комнате включена.
      recirculationCheckbox.checked = rooms.some((r) => r.hasRecirculation === true) || (recirculationLength.value !== "");
      syncRecirculationState();
      renderAllRooms();

      // Канализация: из последней версии.
      const lastSewage = objectDetails.sewageCalculations[0];
      if (lastSewage) {
        sewageStandpipes.value = String(lastSewage.input.sewer.standpipes ?? 0);
        sewageTrapCount.value = lastSewage.input.sewer.trapCount !== null && lastSewage.input.sewer.trapCount !== undefined ? String(lastSewage.input.sewer.trapCount) : "";
        mainRows = (lastSewage.input.sewer.sewerMains ?? []).map((m) => ({ id: m.id, roomIds: [...m.fromRoomIds], lengthM: m.lengthM, alreadyExecuted: m.alreadyExecuted }));
        for (const work of SEWAGE_WORK_IDS) {
          const cb = sewageAlready.querySelector(`input[value='${work.id}']`);
          if (cb) cb.checked = lastSewage.input.sewer.alreadyExecuted.includes(work.id);
        }
      } else {
        mainRows = [];
        sewageStandpipes.value = "";
        sewageTrapCount.value = "";
      }
      renderMains();

      dirty = false;
      waterSaveButton.disabled = true;
      sewageSaveButton.disabled = true;
      status.textContent = `Загружено. Версий водоснабжения: ${objectDetails.plumbingCalculations.length}, канализации: ${objectDetails.sewageCalculations.length}.`;
    } catch (error) {
      showError(error);
      const detail = error instanceof Error ? error.message : String(error);
      status.textContent = `Не удалось загрузить объект: ${detail}`;
    } finally { setBusy(false); }
  }

  function statusHint(message) {
    status.textContent = message;
  }

  async function api(url, options) {
    const response = await fetch(url, options);
    const value = await response.json();
    if (!response.ok) throw new Error([value.error ?? "Ошибка запроса", ...(value.issues ?? [])].join("\n"));
    return value;
  }

  async function calculateWater() {
    setBusy(true);
    errorBox.hidden = true;
    try {
      const input = buildPlumbingInput();
      const report = await api("/api/plumbing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      plumbingRevision = report.workPrices?.revision ?? plumbingRevision;
      renderWaterResult(report);
      status.textContent = `Расчёт выполнен. Снимок цен редакции ${plumbingRevision}. Стоимость: ${formatCost(report.costSubtotalKopecks)} (${costStatusLabel(report.costStatus)}).`;
    } catch (error) { showError(error); status.textContent = "Расчёт не выполнен."; }
    finally { setBusy(false); }
  }
  async function calculateSewage() {
    setBusy(true);
    errorBox.hidden = true;
    try {
      const input = buildSewageInput();
      const report = await api("/api/sewage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      sewageRevision = report.workPrices?.revision ?? sewageRevision;
      renderSewageResult(report);
      status.textContent = `Канализация: Ø50 ${report.points50}, Ø110 ${report.points110}, лежаки ${report.lengthM} м, стоимость ${formatCost(report.costSubtotalKopecks)} (${costStatusLabel(report.costStatus)}). Снимок цен редакции ${sewageRevision}.`;
    } catch (error) {
      showError(error);
      status.textContent = `Расчёт канализации не выполнен: ${error instanceof Error ? error.message : String(error)}`;
    }
    finally { setBusy(false); }
  }
  async function saveWater() {
    setBusy(true);
    errorBox.hidden = true;
    try {
      const input = buildPlumbingInput();
      const sample = await api("/api/plumbing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      plumbingRevision = sample.workPrices?.revision ?? plumbingRevision;
      await api(`/api/objects/${objectIdEncoded}/plumbing`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ input, parameterMetadata: [], workPrices: { ...sample.workPrices, baseRevision: plumbingRevision } }),
      });
      status.textContent = `Версия водоснабжения сохранена.`;
      dirty = false;
      waterSaveButton.disabled = true;
      objectDetails = await api(`/api/objects/${objectIdEncoded}`);
      renderVersions();
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  }
  async function saveSewage() {
    setBusy(true);
    errorBox.hidden = true;
    try {
      const input = buildSewageInput();
      const sample = await api("/api/sewage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      sewageRevision = sample.workPrices?.revision ?? sewageRevision;
      await api(`/api/objects/${objectIdEncoded}/sewage`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ input, parameterMetadata: [], workPrices: { ...sample.workPrices, baseRevision: sewageRevision } }),
      });
      status.textContent = `Версия канализации сохранена.`;
      dirty = false;
      sewageSaveButton.disabled = true;
      objectDetails = await api(`/api/objects/${objectIdEncoded}`);
      renderVersions();
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  }
  addRoomButton.addEventListener("click", () => addRoom());
  recirculationCheckbox.addEventListener("change", () => { syncRecirculationState(); markDirty(); });
  recirculationLength.addEventListener("input", markDirty);
  sewageStandpipes.addEventListener("input", markDirty);
  sewageTrapCount.addEventListener("input", markDirty);
  waterCalculateButton.addEventListener("click", () => { void calculateWater(); });
  waterSaveButton.addEventListener("click", () => { void saveWater(); });
  sewageCalculateButton.addEventListener("click", () => { void calculateSewage(); });
  sewageSaveButton.addEventListener("click", () => { void saveSewage(); });
  sewageAddMain.addEventListener("click", addMain);
  window.addEventListener("beforeunload", (event) => {
    if (dirty) { event.preventDefault(); event.returnValue = ""; }
  });
  syncRecirculationState();
  await reloadObject();
}
