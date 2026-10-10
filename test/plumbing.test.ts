import assert from "node:assert/strict";
import test from "node:test";
import { calculatePlumbing } from "../src/plumbing.js";
import { getPlumbingFixture, plumbingFixtures } from "../src/plumbing-config.js";
import { parsePlumbingInput } from "../src/plumbing-validation.js";
import type { PlumbingInput, PlumbingWorkPrices } from "../src/types.js";
import { InputValidationError } from "../src/validation.js";

const priceSnapshot = (): PlumbingWorkPrices => ({
  revision: 1,
  waterHotPointRub: 2000,
  recirculationPerMeterRub: 1000,
  trapInstallRub: 2000,
  markupPercent: 45,
});

function baseRoom(): PlumbingInput {
  return {
    rooms: [
      {
        roomId: "bath",
        fixtures: [
          { type: "bath", count: 1 },
          { type: "sink", count: 1 },
          { type: "toilet", count: 1 },
        ],
        hasRecirculation: false,
      },
    ],
    hotWaterSource: "two_loop_boiler",
  };
}

function baseRoomWithRecirculation(lengthM: number | null): PlumbingInput {
  const input = baseRoom();
  input.rooms[0]!.hasRecirculation = true;
  input.recirculationLengthM = lengthM;
  return input;
}

test("ванна + раковина + унитаз дают 3 ХВС и 2 ГВС", () => {
  const report = calculatePlumbing(baseRoom());
  assert.equal(report.coldWaterPoints, 3);
  assert.equal(report.hotWaterPoints, 2);
  assert.equal(report.recirculationPoints, 0);
  assert.equal(report.status, "calculated");
  assert.equal(report.blockStatus.coldWater, "calculated");
  assert.equal(report.blockStatus.hotWater, "calculated");
  assert.equal(report.blockStatus.recirculation, "calculated");
});

test("count=0 не увеличивает количество точек", () => {
  const input = baseRoom();
  input.rooms[0]!.fixtures.push({ type: "bath", count: 0 });
  const report = calculatePlumbing(input);
  assert.equal(report.coldWaterPoints, 3);
  assert.equal(report.hotWaterPoints, 2);
});

test("null в hasRecirculation при наличии ГВС-приборов → review", () => {
  const input = baseRoom();
  input.rooms[0]!.hasRecirculation = null;
  const report = calculatePlumbing(input);
  assert.equal(report.blockStatus.recirculation, "requires_engineer_review");
  assert.equal(report.status, "requires_engineer_review");
  assert.equal(report.recirculationPoints, null);
  assert.ok(
    report.warnings.some((warning) => warning.code === "GHRS_REVIEW_NEEDED"),
  );
});

test("неизвестный тип прибора отклоняется валидацией", () => {
  const raw = baseRoom() as unknown as Record<string, unknown>;
  const rooms = raw.rooms as Array<Record<string, unknown>>;
  const fixtures = rooms[0]!.fixtures as Array<Record<string, unknown>>;
  fixtures.push({ type: "fancy_tap", count: 1 });

  assert.throws(
    () => parsePlumbingInput(raw),
    (error: unknown) =>
      error instanceof InputValidationError && error.issues.some((issue) => issue.includes("допустимы")),
  );
});

test("hotWaterSource=unknown при наличии ГВС-приборов → impossible", () => {
  const input = baseRoom();
  input.hotWaterSource = "unknown";
  const report = calculatePlumbing(input);
  assert.equal(report.blockStatus.hotWater, "impossible");
  assert.equal(report.status, "impossible");
  assert.ok(report.missingParameters.includes("hotWaterSource"));
  assert.ok(report.errors.some((error) => error.code === "GHRS_HOT_WATER_SOURCE_MISSING"));
});

test("hotWaterSource=none при наличии ГВС-приборов → impossible", () => {
  const input = baseRoom();
  input.hotWaterSource = "none";
  const report = calculatePlumbing(input);
  assert.equal(report.blockStatus.hotWater, "impossible");
  assert.ok(report.errors.some((error) => error.code === "GHRS_HOT_WATER_SOURCE_NONE"));
});

test("дублирующийся roomId отклоняется", () => {
  const raw = {
    rooms: [
      { roomId: "bath", fixtures: [], hasRecirculation: true },
      { roomId: "bath", fixtures: [], hasRecirculation: true },
    ],
    hotWaterSource: "two_loop_boiler",
  };
  assert.throws(
    () => parsePlumbingInput(raw),
    (error: unknown) =>
      error instanceof InputValidationError && error.issues.some((issue) => issue.includes("повторяется")),
  );
});

test("пустые rooms + hasRecirculation=true → impossible", () => {
  const input: PlumbingInput = { rooms: [], hotWaterSource: "two_loop_boiler" };
  const report = calculatePlumbing(input);
  assert.equal(report.status, "impossible");
  assert.ok(report.missingParameters.includes("rooms"));
});

test("детерминизм: одинаковый вход даёт побайтно одинаковый JSON", () => {
  const input = baseRoom();
  const a = JSON.stringify(calculatePlumbing(input));
  const b = JSON.stringify(calculatePlumbing(input));
  assert.equal(a, b);
});

test("count=-1 отклоняется валидацией", () => {
  const raw = baseRoom() as unknown as Record<string, unknown>;
  const rooms = raw.rooms as Array<Record<string, unknown>>;
  const fixtures = rooms[0]!.fixtures as Array<Record<string, unknown>>;
  fixtures[0]!.count = -1;

  assert.throws(
    () => parsePlumbingInput(raw),
    (error: unknown) =>
      error instanceof InputValidationError && error.issues.some((issue) => issue.includes("не меньше 0")),
  );
});

test("только приборы без ГВС не требуют источника и не дают рециркуляцию", () => {
  const input: PlumbingInput = {
    rooms: [
      {
        roomId: "laundry",
        fixtures: [
          { type: "toilet", count: 1 },
          { type: "washing_machine", count: 1 },
        ],
        hasRecirculation: true,
      },
    ],
    hotWaterSource: "unknown",
  };
  const report = calculatePlumbing(input);
  assert.equal(report.coldWaterPoints, 2);
  assert.equal(report.hotWaterPoints, 0);
  assert.equal(report.recirculationPoints, 0);
  assert.equal(report.blockStatus.coldWater, "calculated");
  assert.equal(report.blockStatus.hotWater, "calculated");
  assert.equal(report.blockStatus.recirculation, "calculated");
  assert.equal(report.status, "calculated");
});

test("комната без приборов отмечается impossible", () => {
  const input: PlumbingInput = {
    rooms: [{ roomId: "empty", fixtures: [], hasRecirculation: null }],
    hotWaterSource: "two_loop_boiler",
  };
  const report = calculatePlumbing(input);
  assert.equal(report.status, "impossible");
  assert.ok(report.missingParameters.some((param) => param.includes("fixtures")));
});

test("все 8 приборов в каталоге и матрица непротиворечива", () => {
  assert.equal(plumbingFixtures.length, 8);
  for (const definition of plumbingFixtures) {
    const fetched = getPlumbingFixture(definition.type);
    assert.equal(fetched, definition);
  }
});

// --- Подэтап B: стоимость работ ---

test("без снимка цен costStatus impossible и строки пустые", () => {
  const report = calculatePlumbing(baseRoom());
  assert.equal(report.costStatus, "impossible");
  assert.equal(report.costSubtotalKopecks, null);
  assert.equal(report.costLines.length, 0);
  assert.equal(report.workPrices, undefined);
  assert.ok(report.costWarnings.some((warning) => warning.code === "PLUMBING_NO_PRICES"));
});

test("со снимком цен точки ХВС+ГВС считаются по базовой цене с наценкой 45%", () => {
  const report = calculatePlumbing(baseRoom(), priceSnapshot());
  // baseRoom(): bath + sink = 2 точки ХВС+ГВС
  // unitPriceRub = 2000 × 1.45 = 2900
  // totalKopecks = 2900 × 2 = 580000
  assert.equal(report.costStatus, "calculated");
  assert.equal(report.costSubtotalKopecks, 580000);
  assert.equal(report.costLines.length, 1);
  const line = report.costLines[0]!;
  assert.equal(line.code, "heating_water_point");
  assert.equal(line.name, "Монтаж точки водоснабжения ХВС и ГВС");
  assert.equal(line.quantity, 2);
  assert.equal(line.unit, "точка");
  assert.equal(line.unitPriceRub, 2900);
  assert.equal(line.totalKopecks, 580000);
  assert.deepEqual(report.workPrices, priceSnapshot());
});

test("нулевая базовая цена даёт нулевую цену ИВОК и предупреждение", () => {
  const prices = { ...priceSnapshot(), waterHotPointRub: 0 };
  const report = calculatePlumbing(baseRoom(), prices);
  assert.equal(report.costStatus, "calculated");
  assert.equal(report.costLines[0]!.unitPriceRub, 0);
  assert.equal(report.costLines[0]!.totalKopecks, 0);
  assert.ok(report.costWarnings.some((warning) => warning.code === "PLUMBING_ZERO_PRICE"));
});

test("без ГВС-приборов стоимость пуста, статус calculated", () => {
  const input: PlumbingInput = {
    rooms: [
      { roomId: "laundry", fixtures: [{ type: "washing_machine", count: 1 }], hasRecirculation: false },
    ],
    hotWaterSource: "two_loop_boiler",
  };
  const report = calculatePlumbing(input, priceSnapshot());
  assert.equal(report.costStatus, "calculated");
  assert.equal(report.costSubtotalKopecks, 0);
  assert.equal(report.costLines.length, 0);
});

test("в B длина рециркуляции не считается, в appliedRules есть отметка", () => {
  const report = calculatePlumbing({ ...baseRoom(), recirculationLengthM: 0 }, priceSnapshot());
  assert.ok(
    !report.costAppliedRules.some((rule) => rule.code === "PLUMBING_COST_RECIRCULATION_DEFERRED"),
  );
  assert.ok(
    report.costAppliedRules.some((rule) => rule.code === "PLUMBING_COST_TRAPS_DEFERRED"),
  );
});

test("включённая рециркуляция без длины петли даёт requires_engineer_review", () => {
  const report = calculatePlumbing(baseRoomWithRecirculation(null), priceSnapshot());
  assert.equal(report.costStatus, "requires_engineer_review");
  assert.ok(
    report.costWarnings.some((warning) => warning.code === "PLUMBING_RECIRCULATION_LENGTH_MISSING"),
  );
});

test("петля рециркуляции считается: costLines содержит plumbing_recirculation", () => {
  const report = calculatePlumbing(baseRoomWithRecirculation(12), priceSnapshot());
  assert.equal(report.costStatus, "calculated");
  const line = report.costLines.find((entry) => entry.code === "plumbing_recirculation");
  assert.ok(line);
  assert.equal(line!.quantity, 12);
  assert.equal(line!.unit, "м");
  assert.ok(
    report.costAppliedRules.some((rule) => rule.code === "PLUMBING_COST_RECIRCULATION"),
  );
});

test("детерминизм стоимости: одинаковый вход + снимок дают побайтно одинаковый JSON", () => {
  const a = JSON.stringify(calculatePlumbing(baseRoom(), priceSnapshot()));
  const b = JSON.stringify(calculatePlumbing(baseRoom(), priceSnapshot()));
  assert.equal(a, b);
});

test("стоимость большого количества точек не вызывает переполнения", () => {
  const input: PlumbingInput = {
    rooms: [
      {
        roomId: "big",
        fixtures: [
          { type: "bath", count: 50 },
          { type: "sink", count: 50 },
          { type: "hygiene_shower", count: 50 },
        ],
        hasRecirculation: false,
      },
    ],
    hotWaterSource: "two_loop_boiler",
  };
  const report = calculatePlumbing(input, priceSnapshot());
  assert.equal(report.costStatus, "calculated");
  assert.ok(report.costSubtotalKopecks !== null);
  assert.equal(report.costLines[0]!.totalKopecks, report.costSubtotalKopecks);
});

test("в справочнике работ 41 позиция: 35 отопления + 2 водоснабжения + 4 канализации", async () => {
  const { workDefinitions } = await import("../src/works-data.js");
  assert.equal(workDefinitions.length, 41);
  assert.ok(workDefinitions.find((work) => work.id === "plumbing_recirculation"));
  assert.ok(workDefinitions.find((work) => work.id === "plumbing_trap_install"));
  assert.ok(workDefinitions.find((work) => work.id === "sewage_point_50"));
  assert.ok(workDefinitions.find((work) => work.id === "sewage_point_110"));
});
