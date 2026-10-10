import { lineTotalKopecks } from "./money.js";
import { getPlumbingFixture, plumbingFixtures } from "./plumbing-config.js";
import { ivokPriceRub, workDefinitions } from "./works-data.js";
import type {
  AppliedRule,
  CalculationStatus,
  PlumbingCostLine,
  PlumbingFixtureEntry,
  PlumbingInput,
  PlumbingReport,
  PlumbingRoomInput,
  PlumbingRoomReport,
  PlumbingWorkPrices,
  ReportMessage,
} from "./types.js";

const STATUS_RANK: Record<CalculationStatus, number> = {
  calculated: 0,
  requires_engineer_review: 1,
  impossible: 2,
};

function stricter(a: CalculationStatus, b: CalculationStatus): CalculationStatus {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

const rule = (code: string, description: string): AppliedRule => ({ code, description });
const warning = (code: string, message: string): ReportMessage => ({ code, message });

/** Есть ли в комнате хотя бы один прибор, у которого разрешена рециркуляция. */
function recirculationEligible(fixtures: PlumbingFixtureEntry[]): boolean {
  return fixtures.some(
    (fixture) => fixture.count > 0 && getPlumbingFixture(fixture.type).recirculationAllowed,
  );
}

function findWorkDefinition(id: string): { id: string; name: string; unit: string } | undefined {
  return workDefinitions.find((work) => work.id === id);
}

function calculateRoom(
  input: PlumbingRoomInput,
  index: number,
  warnings: ReportMessage[],
  errors: ReportMessage[],
): PlumbingRoomReport {
  const path = `rooms[${index}]`;
  const coldWaterPoints = input.fixtures.reduce((sum, fixture) => {
    if (fixture.count === 0) return sum;
    return getPlumbingFixture(fixture.type).coldWater ? sum + fixture.count : sum;
  }, 0);
  const hotWaterPoints = input.fixtures.reduce((sum, fixture) => {
    if (fixture.count === 0) return sum;
    return getPlumbingFixture(fixture.type).hotWater ? sum + fixture.count : sum;
  }, 0);

  const eligible = recirculationEligible(input.fixtures);
  let recirculationPoints: number | null = null;
  let status: CalculationStatus = "calculated";
  if (!eligible) {
    recirculationPoints = 0;
  } else if (input.hasRecirculation === true) {
    recirculationPoints = hotWaterPoints;
  } else if (input.hasRecirculation === false) {
    recirculationPoints = 0;
  } else {
    status = "requires_engineer_review";
    warnings.push(warning(
      "GHRS_REVIEW_NEEDED",
      `Рециркуляция ГВС в комнате "${input.roomId || path}" не определена инженером; требуется проверка.`,
    ));
  }

  if (input.roomId === "") {
    status = stricter(status, "impossible");
    errors.push(warning("PLUMBING_ROOM_ID_MISSING", `Идентификатор комнаты не задан (${path}).`));
  }

  const missingParameters: string[] = [];
  if (input.fixtures.length === 0) {
    missingParameters.push(`${path}.fixtures`);
  }

  if (missingParameters.length > 0) status = stricter(status, "impossible");

  return {
    roomId: input.roomId,
    coldWaterPoints,
    hotWaterPoints,
    recirculationPoints,
    status,
    ...(missingParameters.length > 0 ? { missingParameters } : {}),
  };
}

/**
 * E2: расчёт стоимости водоснабжения.
 * Без снимка возвращает пустые cost-поля и costStatus = impossible (выше).
 * С петлёй рециркуляции: если есть ГВС-приборы и hasRecirculation=true хотя бы в одной комнате,
 * а recirculationLengthM > 0 — добавляется строка plumbing_recirculation.
 * Если длина петли не задана при включённой рециркуляции — costStatus = requires_engineer_review
 * с предупреждением PLUMBING_RECIRCULATION_LENGTH_MISSING.
 * Трапы по-прежнему относятся к канализации (D) и здесь не считаются.
 */
function calculateCost(
  hotWaterPoints: number,
  workPrices: PlumbingWorkPrices,
  recirculationActive: boolean,
  recirculationLengthM: number | null,
): {
  costStatus: CalculationStatus;
  costSubtotalKopecks: number | null;
  costLines: PlumbingCostLine[];
  costWarnings: ReportMessage[];
  costAppliedRules: AppliedRule[];
} {
  const costAppliedRules: AppliedRule[] = [];
  const costWarnings: ReportMessage[] = [];
  const costLines: PlumbingCostLine[] = [];

  const workPoint = findWorkDefinition("heating_water_point");
  if (workPoint === undefined) {
    costWarnings.push(warning("PLUMBING_WORK_DEFINITION_MISSING",
      "В справочнике работ нет позиции для точки ХВС+ГВС."));
    return {
      costStatus: "impossible",
      costSubtotalKopecks: null,
      costLines: [],
      costWarnings,
      costAppliedRules,
    };
  }

  const markup = workPrices.markupPercent;
  if (hotWaterPoints > 0) {
    const unitPriceRub = ivokPriceRub(workPrices.waterHotPointRub, markup);
    if (unitPriceRub === 0) {
      costWarnings.push(warning("PLUMBING_ZERO_PRICE",
        "Нулевая цена точки ХВС+ГВС требует проверки инженера."));
    }
    const totalKopecks = lineTotalKopecks(unitPriceRub, hotWaterPoints);
    costLines.push({
      code: workPoint.id,
      name: workPoint.name,
      quantity: hotWaterPoints,
      unit: "точка",
      unitPriceRub,
      totalKopecks,
    });
    costAppliedRules.push(rule(
      "PLUMBING_COST_WATER_POINTS",
      `Стоимость точек ХВС+ГВС: ${hotWaterPoints} × ${unitPriceRub} ₽/точка (наценка ${markup}%).`,
    ));
  }

  // Рециркуляция-петля: одна труба от бойлера через приборы ГВС обратно к бойлеру.
  if (recirculationActive) {
    const length = recirculationLengthM ?? 0;
    if (length > 0) {
      const workRecirculation = findWorkDefinition("plumbing_recirculation");
      if (workRecirculation === undefined) {
        costWarnings.push(warning("PLUMBING_WORK_DEFINITION_MISSING",
          "В справочнике работ нет позиции для рециркуляции ГВС."));
      } else {
        const unitPriceRub = ivokPriceRub(workPrices.recirculationPerMeterRub, markup);
        const totalKopecks = lineTotalKopecks(unitPriceRub, length);
        costLines.push({
          code: workRecirculation.id,
          name: workRecirculation.name,
          quantity: length,
          unit: "м",
          unitPriceRub,
          totalKopecks,
        });
        costAppliedRules.push(rule(
          "PLUMBING_COST_RECIRCULATION",
          `Стоимость петли рециркуляции: ${length} м × ${unitPriceRub} ₽/м (наценка ${markup}%).`,
        ));
      }
    } else {
      costWarnings.push(warning("PLUMBING_RECIRCULATION_LENGTH_MISSING",
        "Включена рециркуляция ГВС, но длина петли не задана. Укажите длину или снимите признак рециркуляции."));
    }
  }

  // Трапы: количество в B не передаётся (канализация — подэтап D), строка не формируется.
  costAppliedRules.push(rule(
    "PLUMBING_COST_TRAPS_DEFERRED",
    "Количество трапов и схема канализации в подэтапе B не заданы; стоимость рассчитывается в подэтапе D.",
  ));

  const recirculationRequiresReview = recirculationActive && (recirculationLengthM === null || recirculationLengthM === 0);
  if (hotWaterPoints === 0 && !recirculationRequiresReview) {
    return {
      costStatus: "calculated",
      costSubtotalKopecks: 0,
      costLines,
      costWarnings,
      costAppliedRules,
    };
  }

  const subtotal = costLines.reduce((sum, line) => sum + line.totalKopecks, 0);
  if (subtotal > Number.MAX_SAFE_INTEGER) {
    costWarnings.push(warning("PLUMBING_COST_OVERFLOW",
      "Стоимость водоснабжения превышает безопасный денежный диапазон."));
    return {
      costStatus: "impossible",
      costSubtotalKopecks: null,
      costLines,
      costWarnings,
      costAppliedRules,
    };
  }

  if (recirculationRequiresReview) {
    return {
      costStatus: "requires_engineer_review",
      costSubtotalKopecks: subtotal,
      costLines,
      costWarnings,
      costAppliedRules,
    };
  }

  return {
    costStatus: "calculated",
    costSubtotalKopecks: subtotal,
    costLines,
    costWarnings,
    costAppliedRules,
  };
}

export function calculatePlumbing(
  input: PlumbingInput,
  workPrices?: PlumbingWorkPrices,
): PlumbingReport {
  const appliedRules: AppliedRule[] = [];
  const warnings: ReportMessage[] = [];
  const errors: ReportMessage[] = [];

  appliedRules.push(rule(
    "PLUMBING_FIXTURE_MATRIX",
    "Точки ХВС и ГВС считаются по фиксированной матрице приборов: " +
      plumbingFixtures.map((fixture) => fixture.name).join(", ") + ".",
  ));

  const rooms = input.rooms.map((room, index) =>
    calculateRoom(room, index, warnings, errors),
  );

  const coldWaterPoints = rooms.reduce((sum, room) => sum + room.coldWaterPoints, 0);
  const hotWaterPoints = rooms.reduce((sum, room) => sum + room.hotWaterPoints, 0);

  const anyEligibleForRecirculation = input.rooms.some(
    (room) => recirculationEligible(room.fixtures),
  );
  let coldWaterStatus: CalculationStatus = "calculated";
  let hotWaterStatus: CalculationStatus = "calculated";
  let recirculationStatus: CalculationStatus = "calculated";

  if (hotWaterPoints > 0 && (input.hotWaterSource === "unknown" || input.hotWaterSource === null)) {
    hotWaterStatus = "impossible";
    errors.push(warning(
      "GHRS_HOT_WATER_SOURCE_MISSING",
      "Источник горячей воды не выбран; требуется решение инженера.",
    ));
  }
  if (hotWaterPoints > 0 && input.hotWaterSource === "none") {
    hotWaterStatus = "impossible";
    errors.push(warning(
      "GHRS_HOT_WATER_SOURCE_NONE",
      "Указан источник «без горячей воды», но в объекте есть приборы с ГВС.",
    ));
  }

  let totalRecirculationPoints: number | null = 0;
  if (anyEligibleForRecirculation) {
    let unknownRoom: PlumbingRoomInput | undefined;
    for (const room of input.rooms) {
      if (recirculationEligible(room.fixtures) && room.hasRecirculation === null) {
        unknownRoom = room;
        break;
      }
    }
    if (unknownRoom !== undefined) {
      recirculationStatus = "requires_engineer_review";
      warnings.push(warning(
        "GHRS_REVIEW_NEEDED",
        `Рециркуляция в комнате "${unknownRoom.roomId}" не определена.`,
      ));
      totalRecirculationPoints = null;
    } else {
      totalRecirculationPoints = rooms.reduce(
        (sum, room) => sum + (room.recirculationPoints ?? 0),
        0,
      );
    }
  }

  for (const room of rooms) {
    coldWaterStatus = stricter(coldWaterStatus, room.status);
    hotWaterStatus = stricter(hotWaterStatus, room.status);
    recirculationStatus = stricter(recirculationStatus, room.status);
  }
  if (input.rooms.length === 0) {
    coldWaterStatus = stricter(coldWaterStatus, "impossible");
    hotWaterStatus = stricter(hotWaterStatus, "impossible");
    errors.push(warning("PLUMBING_NO_ROOMS", "Список комнат пуст; добавьте хотя бы одну."));
  }

  const overallStatus: CalculationStatus = [coldWaterStatus, hotWaterStatus, recirculationStatus]
    .reduce<CalculationStatus>(stricter, "calculated");

  const missingParameters: string[] = [];
  for (const [index, room] of input.rooms.entries()) {
    if (room.fixtures.length === 0) missingParameters.push(`rooms[${index}].fixtures`);
  }
  if (hotWaterPoints > 0 && (input.hotWaterSource === "unknown" || input.hotWaterSource === null)) {
    missingParameters.push("hotWaterSource");
  }
  if (input.rooms.length === 0) missingParameters.push("rooms");

  // Стоимость: подэтап B. Без снимка — costStatus impossible, строки пустые.
  let costStatus: CalculationStatus;
  let costSubtotalKopecks: number | null;
  let costLines: PlumbingCostLine[];
  let costWarnings: ReportMessage[];
  let costAppliedRules: AppliedRule[];
  if (workPrices === undefined) {
    costStatus = "impossible";
    costSubtotalKopecks = null;
    costLines = [];
    costWarnings = [warning("PLUMBING_NO_PRICES",
      "Снимок цен работ не передан; стоимость водоснабжения не рассчитана.")];
    costAppliedRules = [rule("PLUMBING_COST_DEFERRED",
      "Стоимость водоснабжения требует снимка цен работ из /works.")];
  } else {
    const recirculationActive = input.rooms.some(
      (room) => room.hasRecirculation === true && recirculationEligible(room.fixtures),
    );
    const result = calculateCost(
      hotWaterPoints,
      workPrices,
      recirculationActive,
      input.recirculationLengthM ?? null,
    );
    costStatus = result.costStatus;
    costSubtotalKopecks = result.costSubtotalKopecks;
    costLines = result.costLines;
    costWarnings = result.costWarnings;
    costAppliedRules = result.costAppliedRules;
  }

  return {
    status: overallStatus,
    input,
    rooms,
    coldWaterPoints,
    hotWaterPoints,
    recirculationPoints: totalRecirculationPoints,
    blockStatus: {
      coldWater: coldWaterStatus,
      hotWater: hotWaterStatus,
      recirculation: recirculationStatus,
    },
    ...(workPrices === undefined ? {} : { workPrices }),
    costStatus,
    costSubtotalKopecks,
    costLines,
    costWarnings,
    costAppliedRules,
    missingParameters,
    appliedRules,
    warnings,
    errors,
  };
}

/** Ссылка на тип для внешних вызовов и тестов. */
export type { PlumbingInput, PlumbingWorkPrices } from "./types.js";
