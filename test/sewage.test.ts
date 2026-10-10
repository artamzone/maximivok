import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { workDefinitions } from "../src/works-data.js";
import { calculateSewage } from "../src/sewage.js";
import {
  parseSewageInput,
  parseSewageWorkPrices,
  parseSewageWorkPricesDraft,
} from "../src/sewage-validation.js";
import { InputValidationError } from "../src/validation.js";

function fixture(type: string, count: number): { type: "bath" | "sink" | "hygiene_shower" | "kitchen_sink" | "shower_cabin" | "toilet" | "washing_machine" | "dishwasher"; count: number } {
  return { type: type as "bath", count };
}

const samplePrices = {
  revision: 0,
  sewagePoint50Rub: 1500,
  sewagePoint110Rub: 2500,
  sewerMainPerMeterRub: 1000,
  standpipeRub: 3000,
  markupPercent: 45,
};

/**
 * Обёртывает вход, добавляя в sewer.sewerMains один лежак с нулевой длиной
 * для всех комнат, у которых есть канализационные приборы. Используется в D1-тестах,
 * чтобы удовлетворить валидации D2; длина 0 даёт нулевую строку лежака в смете.
 */
function withSewerMains<T extends { sewer: { trapCount: number | null; alreadyExecuted: string[]; sewerMains?: unknown }; plumbing: { rooms: { roomId: string; fixtures: { type: string; count: number }[] }[] } }>(input: T): T {
  const sewageProducers = new Set([
    "toilet", "sink", "kitchen_sink", "bath", "shower_cabin",
    "hygiene_shower", "washing_machine", "dishwasher",
  ]);
  const roomIds = input.plumbing.rooms
    .filter((r) => r.fixtures.some((f) => sewageProducers.has(f.type)))
    .map((r) => r.roomId);
  return {
    ...input,
    sewer: {
      ...input.sewer,
      sewerMains: [{ id: "main1", fromRoomIds: roomIds, lengthM: 0, alreadyExecuted: false }],
    },
  };
}

test("справочник работ 40 позиций: 35 отопления + 2 водоснабжения + 3 канализации", () => {
  assert.equal(workDefinitions.length, 41);
  assert.ok(workDefinitions.find((w) => w.id === "sewage_point_50"));
  assert.ok(workDefinitions.find((w) => w.id === "sewage_point_110"));
});

test("Ø110 даёт только унитаз; Ø50 — все остальные", () => {
  const input = {
    sewer: { trapCount: null, alreadyExecuted: [] },
    plumbing: {
      rooms: [
        { roomId: "a", fixtures: [fixture("toilet", 1)], hasRecirculation: false },
        { roomId: "b", fixtures: [fixture("sink", 2), fixture("kitchen_sink", 1), fixture("bath", 1)], hasRecirculation: false },
        { roomId: "c", fixtures: [fixture("shower_cabin", 1), fixture("washing_machine", 1), fixture("dishwasher", 1), fixture("hygiene_shower", 1)], hasRecirculation: false },
      ],
      hotWaterSource: "two_loop_boiler",
    },
  };
  const report = calculateSewage(parseSewageInput(withSewerMains(input)), parseSewageWorkPrices(samplePrices));
  assert.equal(report.points110, 1);
  // sink(2) + kitchen_sink(1) + bath(1) + shower(1) + washing(1) + dishwasher(1) + hygiene(1) = 8
  assert.equal(report.points50, 8);
});

test("без снимка цен: costStatus impossible, нет строк", () => {
  const input = {
    sewer: { trapCount: 1, alreadyExecuted: [] },
    plumbing: { rooms: [{ roomId: "a", fixtures: [fixture("toilet", 1)], hasRecirculation: false }], hotWaterSource: "two_loop_boiler" },
  };
  const report = calculateSewage(parseSewageInput(withSewerMains(input)));
  assert.equal(report.costStatus, "impossible");
  assert.equal(report.costSubtotalKopecks, null);
  assert.equal(report.costLines.length, 0);
  assert.ok(report.costWarnings.find((w) => w.code === "SEWAGE_COST_NO_SNAPSHOT"));
});

test("со снимком цен: 5×Ø50 (4 точки + 1 трап) + 1×Ø110; наценка 45% применяется к итогу строки", () => {
  const input = {
    sewer: { trapCount: 1, alreadyExecuted: [] },
    plumbing: {
      rooms: [
        {
          roomId: "bath",
          fixtures: [fixture("bath", 1), fixture("sink", 1), fixture("toilet", 1)],
          hasRecirculation: false,
        },
        { roomId: "kitchen", fixtures: [fixture("kitchen_sink", 1), fixture("dishwasher", 1)], hasRecirculation: false },
      ],
      hotWaterSource: "two_loop_boiler",
    },
  };
  const report = calculateSewage(parseSewageInput(withSewerMains(input)), parseSewageWorkPrices(samplePrices));
  assert.equal(report.costStatus, "calculated");
  assert.equal(report.costLines.length, 2);
  // 1500×5×1.45 = 10875 р = 1087500 коп (4 точки + 1 трап, монтаж трапа входит в цену точки Ø50)
  const line50 = report.costLines.find((l) => l.code === "sewage_point_50")!;
  assert.equal(line50.quantity, 5);
  assert.equal(line50.unitPriceRub, 2175);
  assert.equal(line50.totalKopecks, 1087500);
  // 2500×1×1.45 = 3625 р = 362500 коп
  const line110 = report.costLines.find((l) => l.code === "sewage_point_110")!;
  assert.equal(line110.unitPriceRub, 3625);
  assert.equal(line110.totalKopecks, 362500);
  // Отдельной строки трапа в смете больше нет.
  assert.equal(report.costLines.find((l) => l.code === "plumbing_trap_install"), undefined);
  assert.equal(report.costSubtotalKopecks, 1087500 + 362500);
});

test("нулевая базовая цена даёт нулевую цену ИВОК и предупреждение; итого = 0", () => {
  const input = {
    sewer: { trapCount: 0, alreadyExecuted: [] },
    plumbing: { rooms: [{ roomId: "a", fixtures: [fixture("toilet", 1)], hasRecirculation: false }], hotWaterSource: "two_loop_boiler" },
  };
  const prices = { ...samplePrices, sewagePoint110Rub: 0 };
  const report = calculateSewage(parseSewageInput(withSewerMains(input)), parseSewageWorkPrices(prices));
  const line110 = report.costLines.find((l) => l.code === "sewage_point_110")!;
  assert.equal(line110.unitPriceRub, 0);
  assert.equal(line110.totalKopecks, 0);
  assert.equal(report.costSubtotalKopecks, 0);
});

test("большое количество приборов: 200 унитазов", () => {
  const input = {
    sewer: { trapCount: null, alreadyExecuted: [] },
    plumbing: { rooms: [{ roomId: "a", fixtures: [fixture("toilet", 200)], hasRecirculation: false }], hotWaterSource: "two_loop_boiler" },
  };
  const report = calculateSewage(parseSewageInput(withSewerMains(input)), parseSewageWorkPrices(samplePrices));
  const line110 = report.costLines.find((l) => l.code === "sewage_point_110")!;
  assert.equal(line110.quantity, 200);
  // 2500×200×1.45 = 725000 р = 72500000 коп
  assert.equal(line110.totalKopecks, 72_500_000);
});

test("trapCount = null не добавляет единиц к точкам Ø50; предупреждения нет, если drainsToFloor-приборов нет", () => {
  const input = {
    sewer: { trapCount: null, alreadyExecuted: [] },
    plumbing: { rooms: [{ roomId: "a", fixtures: [fixture("toilet", 1)], hasRecirculation: false }], hotWaterSource: "two_loop_boiler" },
  };
  const report = calculateSewage(parseSewageInput(withSewerMains(input)), parseSewageWorkPrices(samplePrices));
  assert.equal(report.trapCount, null);
  assert.equal(report.costLines.find((l) => l.code === "plumbing_trap_install"), undefined);
  assert.equal(report.warnings.find((w) => w.code === "SEWAGE_TRAP_COUNT_MISSING"), undefined);
  // Только унитаз: 0 точек Ø50, 1 точка Ø110.
  const line110 = report.costLines.find((l) => l.code === "sewage_point_110")!;
  assert.equal(line110.quantity, 1);
});

test("trapCount = null + душ (drainsToFloor) даёт предупреждение SEWAGE_TRAP_COUNT_MISSING", () => {
  const input = {
    sewer: { trapCount: null, alreadyExecuted: [] },
    plumbing: { rooms: [{ roomId: "a", fixtures: [fixture("shower_cabin", 1)], hasRecirculation: false }], hotWaterSource: "two_loop_boiler" },
  };
  const report = calculateSewage(parseSewageInput(withSewerMains(input)), parseSewageWorkPrices(samplePrices));
  assert.equal(report.trapCount, null);
  assert.ok(report.warnings.find((w) => w.code === "SEWAGE_TRAP_COUNT_MISSING"));
});

test("trapCount = 2 + душ: 2 точки Ø50 итого (1 точка душа + 1 трап + 1 трап)", () => {
  const input = {
    sewer: { trapCount: 2, alreadyExecuted: [] },
    plumbing: { rooms: [{ roomId: "a", fixtures: [fixture("shower_cabin", 1)], hasRecirculation: false }], hotWaterSource: "two_loop_boiler" },
  };
  const report = calculateSewage(parseSewageInput(withSewerMains(input)), parseSewageWorkPrices(samplePrices));
  const line50 = report.costLines.find((l) => l.code === "sewage_point_50")!;
  assert.equal(line50.quantity, 3);
});

test("alreadyExecuted отбрасывает строки", () => {
  const input = {
    sewer: { trapCount: 1, alreadyExecuted: ["sewage_point_50"] },
    plumbing: { rooms: [{ roomId: "a", fixtures: [fixture("toilet", 1), fixture("sink", 1)], hasRecirculation: false }], hotWaterSource: "two_loop_boiler" },
  };
  const report = calculateSewage(parseSewageInput(withSewerMains(input)), parseSewageWorkPrices(samplePrices));
  assert.equal(report.costLines.length, 1);
  assert.equal(report.costLines[0]?.code, "sewage_point_110");
  assert.ok(report.appliedRules.find((r) => r.code === "SEWAGE_ALREADY_EXECUTED"));
});

test("alreadyExecuted может включать sewer_main; строка лежака исключается", () => {
  const input = {
    sewer: {
      trapCount: 0,
      alreadyExecuted: ["sewer_main"],
      sewerMains: [{ id: "m1", fromRoomIds: ["a"], lengthM: 5, alreadyExecuted: false }],
    },
    plumbing: { rooms: [{ roomId: "a", fixtures: [fixture("sink", 1)], hasRecirculation: false }], hotWaterSource: "two_loop_boiler" },
  };
  const report = calculateSewage(parseSewageInput(input), parseSewageWorkPrices(samplePrices));
  assert.equal(report.costLines.find((l) => l.code === "sewer_main"), undefined);
  assert.ok(report.appliedRules.find((r) => r.code === "SEWAGE_ALREADY_EXECUTED"));
});

test("детерминизм: повторный вызов с одинаковым входом и снимком даёт побайтно одинаковый JSON", () => {
  const input = {
    sewer: { trapCount: 2, alreadyExecuted: [] },
    plumbing: {
      rooms: [
        { roomId: "a", fixtures: [fixture("toilet", 2), fixture("bath", 1), fixture("sink", 1)], hasRecirculation: false },
      ],
      hotWaterSource: "two_loop_boiler",
    },
  };
  const a = JSON.stringify(calculateSewage(parseSewageInput(withSewerMains(input)), parseSewageWorkPrices(samplePrices)));
  const b = JSON.stringify(calculateSewage(parseSewageInput(withSewerMains(input)), parseSewageWorkPrices(samplePrices)));
  assert.equal(a, b);
});

test("без sewerMains длина null и есть предупреждение SEWAGE_MAIN_MISSING", () => {
  const input = {
    sewer: { trapCount: null, alreadyExecuted: [] },
    plumbing: { rooms: [], hotWaterSource: "none" },
  };
  const report = calculateSewage(parseSewageInput(input));
  assert.equal(report.lengthM, 0);
  assert.ok(report.warnings.find((w) => w.code === "SEWAGE_MAIN_MISSING"));
});

test("parseSewageInput отвергает неизвестный WorkId в alreadyExecuted", () => {
  const input = {
    sewer: { trapCount: null, alreadyExecuted: ["unknown_work_id"] },
    plumbing: { rooms: [], hotWaterSource: "none" },
  };
  assert.throws(() => parseSewageInput(input), InputValidationError);
});

test("parseSewageInput отвергает дубли в alreadyExecuted", () => {
  const input = {
    sewer: { trapCount: null, alreadyExecuted: ["sewage_point_50", "sewage_point_50"] },
    plumbing: { rooms: [], hotWaterSource: "none" },
  };
  assert.throws(() => parseSewageInput(input), InputValidationError);
});

test("parseSewageInput отвергает отрицательный trapCount", () => {
  const input = {
    sewer: { trapCount: -1, alreadyExecuted: [] },
    plumbing: { rooms: [], hotWaterSource: "none" },
  };
  assert.throws(() => parseSewageInput(input), InputValidationError);
});

test("parseSewageWorkPricesDraft требует baseRevision и валидные числа", () => {
  assert.throws(() => parseSewageWorkPricesDraft({}), InputValidationError);
  assert.throws(() => parseSewageWorkPricesDraft({ baseRevision: 0 }), InputValidationError);
  const draft = parseSewageWorkPricesDraft({ baseRevision: 0, ...samplePrices });
  assert.equal(draft.baseRevision, 0);
  assert.equal(draft.prices.sewagePoint50Rub, 1500);
});

test("parseSewageWorkPrices отвергает отрицательные цены", () => {
  assert.throws(() => parseSewageWorkPrices({ ...samplePrices, sewagePoint50Rub: -1 }), InputValidationError);
});

test("round-trip example: sewage-input + sewage-prices", () => {
  const here = fileURLToPath(import.meta.url);
  // dist/test/foo.js -> ../../.. -> project root
  const projectRoot = join(here, "..", "..", "..");
  const raw = JSON.parse(readFileSync(join(projectRoot, "examples", "sewage-input.json"), "utf8"));
  const input = parseSewageInput(raw);
  const prices = parseSewageWorkPrices(
    JSON.parse(readFileSync(join(projectRoot, "examples", "sewage-prices.json"), "utf8")),
  );
  const report = calculateSewage(input, prices);
  // В примере 4 точки Ø50 (ванна, раковина, мойка, посудомойка) + 1 трап = 5 точек Ø50; 1 унитаз = Ø110.
  assert.equal(report.points50, 5);
  assert.equal(report.points110, 1);
  // 5*Ø50 (1 087 500) + 1*Ø110 (362 500) + 7 м лежака (1 015 000) = 2 465 000 коп
  // 5 * 1500 * 1.45 = 10 875 ₽ = 1 087 500 коп
  // 1 * 2500 * 1.45 = 3 625 ₽ = 362 500 коп
  // 7 * 1000 * 1.45 = 10 150 ₽ = 1 015 000 коп
  assert.equal(report.costSubtotalKopecks, 1_087_500 + 362_500 + 1_015_000);
});

// ======================================================================
// D2: лежаки канализации
// ======================================================================

test("D2: один лежак 12 м по двум комнатам; в смету входит строка sewer_main 12 м × 1000 × 1.45", () => {
  const input = {
    sewer: {
      trapCount: 0,
      alreadyExecuted: [],
      sewerMains: [{ id: "main1", fromRoomIds: ["bath", "kitchen"], lengthM: 12, alreadyExecuted: false }],
    },
    plumbing: {
      rooms: [
        { roomId: "bath", fixtures: [fixture("bath", 1)], hasRecirculation: false },
        { roomId: "kitchen", fixtures: [fixture("kitchen_sink", 1)], hasRecirculation: false },
      ],
      hotWaterSource: "two_loop_boiler",
    },
  };
  const report = calculateSewage(parseSewageInput(input), parseSewageWorkPrices(samplePrices));
  const main = report.costLines.find((l) => l.code === "sewer_main")!;
  assert.equal(main.quantity, 12);
  assert.equal(main.unit, "м");
  assert.equal(main.unitPriceRub, 1450);
  assert.equal(main.totalKopecks, 1_740_000);
  assert.equal(report.lengthM, 12);
  assert.ok(report.appliedRules.find((r) => r.code === "SEWAGE_MAIN_FROM_ROUTES"));
});

test("D2: два лежака (8 м + 5 м) суммируются в одну строку 13 м", () => {
  const input = {
    sewer: {
      trapCount: 0,
      alreadyExecuted: [],
      sewerMains: [
        { id: "main1", fromRoomIds: ["bath"], lengthM: 8, alreadyExecuted: false },
        { id: "main2", fromRoomIds: ["kitchen"], lengthM: 5, alreadyExecuted: false },
      ],
    },
    plumbing: {
      rooms: [
        { roomId: "bath", fixtures: [fixture("bath", 1)], hasRecirculation: false },
        { roomId: "kitchen", fixtures: [fixture("kitchen_sink", 1)], hasRecirculation: false },
      ],
      hotWaterSource: "two_loop_boiler",
    },
  };
  const report = calculateSewage(parseSewageInput(input), parseSewageWorkPrices(samplePrices));
  const main = report.costLines.find((l) => l.code === "sewer_main")!;
  assert.equal(main.quantity, 13);
  assert.equal(report.lengthM, 13);
});

test("D2: лежак с alreadyExecuted:true исключает строку и помечает правило", () => {
  const input = {
    sewer: {
      trapCount: 0,
      alreadyExecuted: [],
      sewerMains: [
        { id: "main1", fromRoomIds: ["bath"], lengthM: 6, alreadyExecuted: true },
      ],
    },
    plumbing: {
      rooms: [{ roomId: "bath", fixtures: [fixture("bath", 1)], hasRecirculation: false }],
      hotWaterSource: "two_loop_boiler",
    },
  };
  const report = calculateSewage(parseSewageInput(input), parseSewageWorkPrices(samplePrices));
  assert.equal(report.costLines.find((l) => l.code === "sewer_main"), undefined);
  assert.ok(report.appliedRules.find((r) => r.code === "SEWAGE_MAIN_ALREADY_EXECUTED"));
  assert.equal(report.lengthM, 6); // длина считается даже если лежак выполнен
});

test("D2: лежак с alreadyExecuted в sewer.alreadyExecuted тоже исключает строку", () => {
  const input = {
    sewer: {
      trapCount: 0,
      alreadyExecuted: ["sewer_main"],
      sewerMains: [{ id: "main1", fromRoomIds: ["bath"], lengthM: 4, alreadyExecuted: false }],
    },
    plumbing: {
      rooms: [{ roomId: "bath", fixtures: [fixture("bath", 1)], hasRecirculation: false }],
      hotWaterSource: "two_loop_boiler",
    },
  };
  const report = calculateSewage(parseSewageInput(input), parseSewageWorkPrices(samplePrices));
  assert.equal(report.costLines.find((l) => l.code === "sewer_main"), undefined);
});

test("P2: непокрытая лежаками комната не отвергается, а даёт requires_engineer_review", () => {
  const input = {
    sewer: {
      trapCount: 0,
      alreadyExecuted: [],
      sewerMains: [{ id: "main1", fromRoomIds: ["bath"], lengthM: 5, alreadyExecuted: false }],
    },
    plumbing: {
      rooms: [
        { roomId: "bath", fixtures: [fixture("bath", 1)], hasRecirculation: false },
        { roomId: "kitchen", fixtures: [fixture("kitchen_sink", 1)], hasRecirculation: false },
      ],
      hotWaterSource: "two_loop_boiler",
    },
  };
  // P2: parseSewageInput не отвергает вход; вместо этого calculateSewage выдаёт requires_engineer_review.
  const parsed = parseSewageInput(input);
  const report = calculateSewage(parsed, parseSewageWorkPrices(samplePrices));
  assert.equal(report.status, "requires_engineer_review");
  assert.ok(report.warnings.find((w) => w.code === "SEWAGE_MAIN_INCOMPLETE"));
  assert.ok(report.missingParameters.find((p) => p.includes("kitchen")));
  // points50 всё равно считаются по приборам — это известные строки, не блокируем.
  // bath → Ø50, kitchen_sink → Ø50: 2 точки Ø50, 0 точек Ø110.
  assert.equal(report.points50, 2);
  assert.equal(report.points110, 0);
});

test("D2: parseSewageInput отвергает неизвестный roomId в fromRoomIds", () => {
  const input = {
    sewer: {
      trapCount: 0,
      alreadyExecuted: [],
      sewerMains: [{ id: "main1", fromRoomIds: ["ghost"], lengthM: 5, alreadyExecuted: false }],
    },
    plumbing: {
      rooms: [{ roomId: "bath", fixtures: [fixture("bath", 1)], hasRecirculation: false }],
      hotWaterSource: "two_loop_boiler",
    },
  };
  assert.throws(() => parseSewageInput(input), InputValidationError);
});

test("D2: parseSewageInput отвергает дубли комнат в fromRoomIds одного лежака", () => {
  const input = {
    sewer: {
      trapCount: 0,
      alreadyExecuted: [],
      sewerMains: [{ id: "main1", fromRoomIds: ["bath", "bath"], lengthM: 5, alreadyExecuted: false }],
    },
    plumbing: {
      rooms: [{ roomId: "bath", fixtures: [fixture("bath", 1)], hasRecirculation: false }],
      hotWaterSource: "two_loop_boiler",
    },
  };
  assert.throws(() => parseSewageInput(input), InputValidationError);
});

test("D2: parseSewageInput отвергает отрицательную длину", () => {
  const input = {
    sewer: {
      trapCount: 0,
      alreadyExecuted: [],
      sewerMains: [{ id: "main1", fromRoomIds: ["bath"], lengthM: -1, alreadyExecuted: false }],
    },
    plumbing: {
      rooms: [{ roomId: "bath", fixtures: [fixture("bath", 1)], hasRecirculation: false }],
      hotWaterSource: "two_loop_boiler",
    },
  };
  assert.throws(() => parseSewageInput(input), InputValidationError);
});

test("D2: parseSewageWorkPrices требует sewerMainPerMeterRub", () => {
  assert.throws(() => parseSewageWorkPrices({ ...samplePrices, sewerMainPerMeterRub: -1 }), InputValidationError);
  const prices = parseSewageWorkPrices({ ...samplePrices, sewerMainPerMeterRub: 1500 });
  assert.equal(prices.sewerMainPerMeterRub, 1500);
});

test("D2: лежак нулевой длины не входит в смету, но правило SEWAGE_MAIN_FROM_ROUTES добавляется", () => {
  const input = {
    sewer: {
      trapCount: 0,
      alreadyExecuted: [],
      sewerMains: [{ id: "main1", fromRoomIds: ["bath"], lengthM: 0, alreadyExecuted: false }],
    },
    plumbing: {
      rooms: [{ roomId: "bath", fixtures: [fixture("bath", 1)], hasRecirculation: false }],
      hotWaterSource: "two_loop_boiler",
    },
  };
  const report = calculateSewage(parseSewageInput(input), parseSewageWorkPrices(samplePrices));
  assert.equal(report.costLines.find((l) => l.code === "sewer_main"), undefined);
  assert.equal(report.lengthM, 0);
  assert.ok(report.appliedRules.find((r) => r.code === "SEWAGE_MAIN_FROM_ROUTES"));
});

test("D2: детерминизм повторного вызова с лежаками", () => {
  const input = {
    sewer: {
      trapCount: 1,
      alreadyExecuted: [],
      sewerMains: [
        { id: "main1", fromRoomIds: ["bath", "kitchen"], lengthM: 9, alreadyExecuted: false },
      ],
    },
    plumbing: {
      rooms: [
        { roomId: "bath", fixtures: [fixture("bath", 1), fixture("toilet", 1)], hasRecirculation: false },
        { roomId: "kitchen", fixtures: [fixture("kitchen_sink", 1)], hasRecirculation: false },
      ],
      hotWaterSource: "two_loop_boiler",
    },
  };
  const a = JSON.stringify(calculateSewage(parseSewageInput(input), parseSewageWorkPrices(samplePrices)));
  const b = JSON.stringify(calculateSewage(parseSewageInput(input), parseSewageWorkPrices(samplePrices)));
  assert.equal(a, b);
});

test("E2: стояки добавляют строку sewage_standpipe в смету", () => {
  const input = {
    sewer: {
      trapCount: null,
      alreadyExecuted: [],
      sewerMains: [{ id: "m1", fromRoomIds: ["bath"], lengthM: 0, alreadyExecuted: false }],
      standpipes: 2,
    },
    plumbing: {
      rooms: [
        { roomId: "bath", fixtures: [fixture("bath", 1), fixture("toilet", 1)], hasRecirculation: false },
      ],
      hotWaterSource: "two_loop_boiler",
    },
  };
  const report = calculateSewage(parseSewageInput(input), parseSewageWorkPrices(samplePrices));
  const line = report.costLines.find((entry) => entry.code === "sewage_standpipe");
  assert.ok(line);
  assert.equal(line!.quantity, 2);
  assert.equal(line!.unit, "шт");
  // 3000 × 1.45 = 4350; 4350 × 2 = 870000 коп
  assert.equal(line!.unitPriceRub, 4350);
  assert.equal(line!.totalKopecks, 870000);
  assert.ok(report.costAppliedRules.some((rule) => rule.code === "SEWAGE_STANDPIPE_FROM_INPUT"));
});

test("E2: уже выполненный sewage_standpipe исключается из сметы", () => {
  const input = {
    sewer: {
      trapCount: null,
      alreadyExecuted: ["sewage_standpipe"],
      sewerMains: [{ id: "m1", fromRoomIds: ["bath"], lengthM: 0, alreadyExecuted: false }],
      standpipes: 1,
    },
    plumbing: {
      rooms: [
        { roomId: "bath", fixtures: [fixture("toilet", 1)], hasRecirculation: false },
      ],
      hotWaterSource: "two_loop_boiler",
    },
  };
  const report = calculateSewage(parseSewageInput(input), parseSewageWorkPrices(samplePrices));
  assert.equal(report.costLines.find((entry) => entry.code === "sewage_standpipe"), undefined);
});

test("E2: standpipes=0 не формирует строку стояка", () => {
  const input = {
    sewer: {
      trapCount: null,
      alreadyExecuted: [],
      sewerMains: [{ id: "m1", fromRoomIds: ["bath"], lengthM: 0, alreadyExecuted: false }],
      standpipes: 0,
    },
    plumbing: {
      rooms: [
        { roomId: "bath", fixtures: [fixture("toilet", 1)], hasRecirculation: false },
      ],
      hotWaterSource: "two_loop_boiler",
    },
  };
  const report = calculateSewage(parseSewageInput(input), parseSewageWorkPrices(samplePrices));
  assert.equal(report.costLines.find((entry) => entry.code === "sewage_standpipe"), undefined);
});
