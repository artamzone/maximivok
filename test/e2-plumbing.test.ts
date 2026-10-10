import test from "node:test";
import assert from "node:assert/strict";
import { calculatePlumbing } from "../src/plumbing.js";
import { parsePlumbingInput } from "../src/plumbing-validation.js";
import type { PlumbingInput, PlumbingWorkPrices } from "../src/types.js";

function priceSnapshot(): PlumbingWorkPrices {
  return {
    revision: 0,
    waterHotPointRub: 2000,
    recirculationPerMeterRub: 1000,
    trapInstallRub: 2000,
    markupPercent: 45,
  };
}

test("E2: длина per-fixture сохраняется в отчёте", () => {
  const input: PlumbingInput = {
    rooms: [
      {
        roomId: "bath-1",
        fixtures: [{ type: "bath", count: 1, lengthM: 8, comment: "основная ванная" }],
        hasRecirculation: false,
      },
      {
        roomId: "kitchen-1",
        fixtures: [{ type: "kitchen_sink", count: 1, lengthM: 4 }],
        hasRecirculation: false,
      },
    ],
    hotWaterSource: "two_loop_boiler",
  };
  const report = calculatePlumbing(input, priceSnapshot());
  assert.equal(report.input.rooms[0]!.fixtures[0]!.lengthM, 8);
  assert.equal(report.input.rooms[0]!.fixtures[0]!.comment, "основная ванная");
  assert.equal(report.input.rooms[1]!.fixtures[0]!.lengthM, 4);
});

test("E2: петля рециркуляции считается по длине одной трубы", () => {
  const raw = {
    rooms: [
      { roomId: "bath-1", fixtures: [{ type: "bath", count: 1 }], hasRecirculation: true },
    ],
    hotWaterSource: "two_loop_boiler",
    recirculationLengthM: 12,
  };
  const report = calculatePlumbing(parsePlumbingInput(raw), priceSnapshot());
  const line = report.costLines.find((entry) => entry.code === "plumbing_recirculation");
  assert.ok(line);
  assert.equal(line!.quantity, 12);
  assert.equal(line!.unit, "м");
  // 1000 × 1.45 = 1450; 1450 × 12 = 1740000 коп
  assert.equal(line!.unitPriceRub, 1450);
  assert.equal(line!.totalKopecks, 1_740_000);
  assert.equal(report.costSubtotalKopecks, 2000 * 1.45 * 1 * 100 + 1_740_000);
  // 290000 + 1740000 = 2030000
  assert.equal(report.costSubtotalKopecks, 2_030_000);
  assert.equal(report.costStatus, "calculated");
});

test("E2: round-trip: вход + снимок → ожидаемая сумма со строкой рециркуляции", () => {
  const raw = {
    rooms: [
      { roomId: "bath", fixtures: [{ type: "bath", count: 1 }], hasRecirculation: true },
      { roomId: "sink", fixtures: [{ type: "sink", count: 1 }], hasRecirculation: true },
      { roomId: "kitchen", fixtures: [{ type: "kitchen_sink", count: 1 }], hasRecirculation: true },
    ],
    hotWaterSource: "two_loop_boiler",
    recirculationLengthM: 15,
  };
  const report = calculatePlumbing(parsePlumbingInput(raw), priceSnapshot());
  // 3 точки ХВС+ГВС × 2900 ₽ = 8700 ₽
  // 15 м × 1450 ₽/м = 21750 ₽
  // итого 30450 ₽ = 3_045_000 коп
  assert.equal(report.costSubtotalKopecks, 3_045_000);
  const recirc = report.costLines.find((entry) => entry.code === "plumbing_recirculation");
  const points = report.costLines.find((entry) => entry.code === "heating_water_point");
  assert.ok(recirc);
  assert.ok(points);
  assert.equal(recirc!.totalKopecks, 2_175_000);
  assert.equal(points!.totalKopecks, 870_000);
});

test("E2: recirculationLengthM=null эквивалентно отсутствию петли", () => {
  const raw = {
    rooms: [
      { roomId: "bath", fixtures: [{ type: "bath", count: 1 }], hasRecirculation: true },
    ],
    hotWaterSource: "two_loop_boiler",
    recirculationLengthM: null,
  };
  const report = calculatePlumbing(parsePlumbingInput(raw), priceSnapshot());
  assert.equal(report.costLines.find((entry) => entry.code === "plumbing_recirculation"), undefined);
});

test("E2: парсер принимает отсутствие lengthM у прибора (обратная совместимость)", () => {
  const raw = {
    rooms: [
      { roomId: "bath", fixtures: [{ type: "bath", count: 1 }], hasRecirculation: false },
    ],
    hotWaterSource: "two_loop_boiler",
  };
  const input = parsePlumbingInput(raw);
  assert.equal(input.rooms[0]!.fixtures[0]!.lengthM, null);
  assert.equal(input.recirculationLengthM, null);
  const report = calculatePlumbing(input, priceSnapshot());
  assert.equal(report.costStatus, "calculated");
});
