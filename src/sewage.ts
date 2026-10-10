import { lineTotalKopecks } from "./money.js";
import { getSewageFixtureSpec } from "./sewage-config.js";
import { ivokPriceRub } from "./works-data.js";
import { uncoveredSewageRooms } from "./sewage-validation.js";
import type {
  AppliedRule,
  CalculationStatus,
  ReportMessage,
  SewageCostLine,
  SewageInput,
  SewageReport,
  SewageWorkPrices,
  WorkId,
} from "./types.js";

const rule = (code: string, description: string): AppliedRule => ({ code, description });
const warning = (code: string, message: string): ReportMessage => ({ code, message });

const SEWAGE_POINT_50_ID = "sewage_point_50";
const SEWAGE_POINT_110_ID = "sewage_point_110";
const SEWER_MAIN_ID = "sewer_main";
const SEWAGE_STANDPIPE_ID = "sewage_standpipe";

interface SewageCounts {
  points50: number;
  points110: number;
  /** Есть ли в каких-то комнатах приборы со стоком в пол (душ). */
  hasFloorDrainFixture: boolean;
}

function countSewagePoints(input: SewageInput): SewageCounts {
  let points50 = 0;
  let points110 = 0;
  let hasFloorDrainFixture = false;
  for (const room of input.plumbing.rooms) {
    for (const fixture of room.fixtures) {
      const spec = getSewageFixtureSpec(fixture.type);
      const count = fixture.count;
      if (spec.diameter === 50) points50 += count;
      else points110 += count;
      if (spec.drainsToFloor) hasFloorDrainFixture = true;
    }
  }
  return { points50, points110, hasFloorDrainFixture };
}

function buildSewageCostLines(
  counts: SewageCounts,
  sewerMains: readonly { lengthM: number; alreadyExecuted: boolean }[],
  workPrices: SewageWorkPrices,
  alreadyExecuted: readonly WorkId[],
): SewageCostLine[] {
  const lines: SewageCostLine[] = [];
  const executed = new Set(alreadyExecuted);

  if (counts.points50 > 0 && !executed.has(SEWAGE_POINT_50_ID)) {
    const unitPriceRub = ivokPriceRub(workPrices.sewagePoint50Rub, workPrices.markupPercent);
    lines.push({
      code: SEWAGE_POINT_50_ID,
      name: "Монтаж точки канализации Ø50 (вкл. трап)",
      quantity: counts.points50,
      unit: "точка",
      unitPriceRub,
      totalKopecks: lineTotalKopecks(unitPriceRub, counts.points50),
    });
  }

  if (counts.points110 > 0 && !executed.has(SEWAGE_POINT_110_ID)) {
    const unitPriceRub = ivokPriceRub(workPrices.sewagePoint110Rub, workPrices.markupPercent);
    lines.push({
      code: SEWAGE_POINT_110_ID,
      name: "Монтаж точки канализации Ø110",
      quantity: counts.points110,
      unit: "точка",
      unitPriceRub,
      totalKopecks: lineTotalKopecks(unitPriceRub, counts.points110),
    });
  }

  const billableMainLengthM = sewerMains
    .filter((main) => !main.alreadyExecuted)
    .reduce((sum, main) => sum + main.lengthM, 0);
  if (billableMainLengthM > 0 && !executed.has(SEWER_MAIN_ID)) {
    const unitPriceRub = ivokPriceRub(workPrices.sewerMainPerMeterRub, workPrices.markupPercent);
    lines.push({
      code: SEWER_MAIN_ID,
      name: "Прокладка канализационного лежака",
      quantity: billableMainLengthM,
      unit: "м",
      unitPriceRub,
      totalKopecks: lineTotalKopecks(unitPriceRub, billableMainLengthM),
    });
  }

  return lines;
}

function buildSewageStandpipeLines(
  standpipes: number,
  workPrices: SewageWorkPrices,
  alreadyExecuted: readonly WorkId[],
  costAppliedRules: AppliedRule[],
): SewageCostLine[] {
  if (standpipes <= 0) return [];
  if (alreadyExecuted.includes(SEWAGE_STANDPIPE_ID)) return [];
  const unitPriceRub = ivokPriceRub(workPrices.standpipeRub, workPrices.markupPercent);
  const totalKopecks = lineTotalKopecks(unitPriceRub, standpipes);
  costAppliedRules.push(rule(
    "SEWAGE_STANDPIPE_FROM_INPUT",
    `Стоимость фановых стояков: ${standpipes} × ${unitPriceRub} ₽/шт (наценка ${workPrices.markupPercent}%).`,
  ));
  return [{
    code: SEWAGE_STANDPIPE_ID,
    name: "Монтаж фанового стояка",
    quantity: standpipes,
    unit: "шт",
    unitPriceRub,
    totalKopecks,
  }];
}

/**
 * Чистое ядро расчёта канализации. Подэтапы D1 (точки 50/110), D2 (лежаки), D3 (трапы в цене точки, без Ø100 и коллекторов).
 *
 * Считает:
 * - количество точек Ø50 и Ø110 по тем же приборам, что и водоснабжение;
 * - точки Ø50 увеличиваются на `sewer.trapCount` — монтаж трапа входит в цену точки Ø50;
 * - стоимость по отдельному снимку SewageWorkPrices (без БД и AI);
 * - длину и стоимость лежаков из `sewerMains` (метраж задаётся явно, lengthM ≥ 0);
 * - уже выполненные закладные (`alreadyExecuted`) исключаются из сметы.
 *
 * Не считает:
 * - Ø100 — в канализации не используется (если прибор требует иной диаметр, это ошибка проекта);
 * - коллекторы канализации — не предусмотрены;
 * - рециркуляцию — у канализации её нет (только ГВС).
 */
export function calculateSewage(
  input: SewageInput,
  workPrices?: SewageWorkPrices,
): SewageReport {
  const appliedRules: AppliedRule[] = [];
  const warnings: ReportMessage[] = [];
  const errors: ReportMessage[] = [];
  const missingParameters: string[] = [];

  appliedRules.push(rule(
    "SEWAGE_FIXTURE_MATRIX",
    "Точки Ø110 только у унитаза; Ø50 у раковины, мойки, душа, ванны, гигиенического душа, стиральной и посудомойки. Ø100 не используется.",
  ));
  appliedRules.push(rule(
    "SEWAGE_TRAP_INCLUDED",
    "Монтаж трапа входит в цену точки Ø50; отдельной работы в смете нет.",
  ));
  appliedRules.push(rule(
    "SEWAGE_MAIN_INPUT",
    "Лежаки задаются в sewerMains; комната с канализационными точками должна быть указана хотя бы в одном лежаке.",
  ));

  const counts = countSewagePoints(input);
  const sewerMains = input.sewer.sewerMains;
  const totalMainLengthM = sewerMains.reduce((sum, main) => sum + main.lengthM, 0);

  // Трапы увеличивают количество точек Ø50.
  const trapCount = input.sewer.trapCount;
  if (trapCount !== null && trapCount > 0) {
    counts.points50 += trapCount;
  }

  let status: CalculationStatus = "calculated";

  if (input.sewer.alreadyExecuted.length > 0) {
    appliedRules.push(rule(
      "SEWAGE_ALREADY_EXECUTED",
      `Из сметы исключены уже выполненные закладные: ${input.sewer.alreadyExecuted.join(", ")}.`,
    ));
  }

  if (sewerMains.length > 0) {
    appliedRules.push(rule(
      "SEWAGE_MAIN_FROM_ROUTES",
      `Передано лежаков: ${sewerMains.length}, общая длина ${totalMainLengthM} м.`,
    ));
    const allExecuted = sewerMains.every((main) => main.alreadyExecuted);
    if (allExecuted) {
      appliedRules.push(rule(
        "SEWAGE_MAIN_ALREADY_EXECUTED",
        "Все переданные лежаки уже выполнены заказчиком; строка лежака в смету не входит.",
      ));
    }
  } else {
    warnings.push(warning(
      "SEWAGE_MAIN_MISSING",
      "Лежаки канализации не переданы: строка лежака в смету не входит.",
    ));
  }

  // P2: частичный расчёт канализации. Если есть канализационные приборы, но не все комнаты покрыты лежаками,
  // статус блока становится requires_engineer_review, в missingParameters добавляются непокрытые комнаты.
  const uncovered = uncoveredSewageRooms(input);
  if (uncovered.length > 0) {
    status = "requires_engineer_review";
    warnings.push(warning(
      "SEWAGE_MAIN_INCOMPLETE",
      `Лежаки не покрывают все комнаты с канализационными приборами: ${uncovered.join(", ")}. ` +
        "Метраж лежаков и стоимость по ним — частичные; требуется проверка инженера.",
    ));
    for (const rid of uncovered) {
      missingParameters.push(`sewer.sewerMains[room=${rid}]`);
    }
  }

  if (trapCount === null && counts.hasFloorDrainFixture) {
    warnings.push(warning(
      "SEWAGE_TRAP_COUNT_MISSING",
      "В канализации есть приборы со стоком в пол (душ), но количество трапов не задано: соответствующее количество в смете не учтено.",
    ));
  }

  const costWarnings: ReportMessage[] = [];
  const costAppliedRules: AppliedRule[] = [];
  let costStatus: CalculationStatus = "impossible";
  let costSubtotalKopecks: number | null = null;
  let costLines: SewageCostLine[] = [];

  if (workPrices === undefined) {
    costWarnings.push(warning(
      "SEWAGE_COST_NO_SNAPSHOT",
      "Снимок цен канализации не передан; стоимость не рассчитана.",
    ));
  } else {
    // P2: если блок requires_engineer_review из-за непокрытых комнат — стоимость не считаем полной.
    if (status === "requires_engineer_review") {
      costStatus = "requires_engineer_review";
    }
    costLines = buildSewageCostLines(
      counts,
      sewerMains,
      workPrices,
      input.sewer.alreadyExecuted,
    );
    const standpipeLines = buildSewageStandpipeLines(
      input.sewer.standpipes ?? 0,
      workPrices,
      input.sewer.alreadyExecuted,
      costAppliedRules,
    );
    costLines = [...costLines, ...standpipeLines];
    const safeTotal = costLines.reduce((sum, line) => sum + line.totalKopecks, 0);
    costSubtotalKopecks = costLines.length > 0 ? safeTotal : 0;
    costStatus = "calculated";
    costAppliedRules.push(rule(
      "SEWAGE_COST_FROM_SNAPSHOT",
      `Стоимость канализации посчитана по снимку цен редакции ${workPrices.revision}.`,
    ));
    if (costLines.length === 0) {
      costWarnings.push(warning(
        "SEWAGE_COST_EMPTY",
        "Все строки сметы исключены или имеют нулевое количество.",
      ));
    }
  }

  return {
    status,
    input,
    points50: counts.points50,
    points110: counts.points110,
    trapCount: input.sewer.trapCount,
    lengthM: totalMainLengthM,
    sewerMains: input.sewer.sewerMains,
    alreadyExecuted: input.sewer.alreadyExecuted,
    ...(workPrices === undefined ? {} : { workPrices }),
    costStatus,
    costSubtotalKopecks,
    costLines,
    costWarnings,
    costAppliedRules,
    appliedRules,
    warnings,
    errors,
    missingParameters,
  };
}
