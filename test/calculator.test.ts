import assert from "node:assert/strict";
import test from "node:test";
import { calculateHeating, splitCollectors } from "../src/calculator.js";
import type { HeatingInput, RoomInput } from "../src/types.js";

function room(overrides: Partial<RoomInput> = {}): RoomInput {
  return {
    id: "living-room",
    name: "Гостиная",
    areaM2: 20,
    ceilingHeightM: 2.8,
    hasStandardWindows: true,
    hasPanoramicWindows: false,
    floorHeatingAreaM2: 20,
    hasRadiator: true,
    ...overrides,
  };
}

function input(overrides: Partial<HeatingInput> = {}): HeatingInput {
  return {
    houseAreaM2: 120,
    rooms: [room()],
    heatSource: "gas",
    availableElectricPowerKw: null,
    residents: 3,
    baths: 0,
    showers: 1,
    includeIndirectWaterHeater: true,
    ...overrides,
  };
}

test("делит контуры по коллекторам равномерно на границах и примерах ТЗ", () => {
  assert.deepEqual(splitCollectors(12, 12), [12]);
  assert.deepEqual(splitCollectors(13, 12), [7, 6]);
  assert.deepEqual(splitCollectors(14, 12), [7, 7]);
  assert.deepEqual(splitCollectors(30, 12), [10, 10, 10]);
});

test("использует стандартный контур 80 м", () => {
  const report = calculateHeating(input({ rooms: [room({ areaM2: 40, floorHeatingAreaM2: 40 })] }));

  assert.equal(report.floorHeating.pipeLengthM, 240);
  assert.equal(report.floorHeating.circuitLengthM, 80);
  assert.equal(report.floorHeating.circuitCount, 3);
  assert.equal(report.floorHeating.averageCircuitLengthM, 80);
  assert.equal(report.floorHeating.status, "calculated");
});

test("контур длиннее 80 м до 90 м требует проверки инженера", () => {
  const report = calculateHeating(input({ circuitLengthM: 90 }));

  assert.equal(report.floorHeating.status, "requires_engineer_review");
  assert.equal(report.status, "requires_engineer_review");
  assert.ok(report.warnings.some(({ code }) => code === "FH_EXCEPTIONAL_CIRCUIT_LENGTH"));
});

test("контур длиннее 90 м помечает расчёт невозможным", () => {
  const report = calculateHeating(input({ circuitLengthM: 91 }));

  assert.equal(report.floorHeating.status, "impossible");
  assert.equal(report.status, "impossible");
  assert.ok(report.errors.some(({ code }) => code === "FH_CIRCUIT_LENGTH_EXCEEDS_LIMIT"));
});

test("считает стоимость работ и смесительные узлы", () => {
  const report = calculateHeating(input({ rooms: [room({ floorHeatingAreaM2: 20, hasRadiator: true })] }));

  assert.equal(report.floorHeating.installationCostRub, 18_000);
  assert.equal(report.floorHeating.insulationInstallationCostRub, 2_000);
  assert.equal(report.floorHeating.mixingUnitCount, 1);
  assert.equal(report.boilerRoom.templateCode, "HEAT_SOURCE_FLOOR_AND_RADIATORS");
});

test("не ставит смесительный узел при отоплении только тёплым полом", () => {
  const report = calculateHeating(input({ rooms: [room({ hasRadiator: false })] }));

  assert.equal(report.floorHeating.mixingUnitCount, 0);
  assert.equal(report.boilerRoom.templateCode, "HEAT_SOURCE_FLOOR_ONLY");
});

test("уменьшает мощность радиатора на 30 процентов при наличии тёплого пола", () => {
  const report = calculateHeating(input());

  assert.equal(report.radiators[0]?.requiredPowerW, 1_400);
  assert.equal(report.radiators[0]?.reductionPercent, 30);
});

test("не рассчитывает радиатор у панорамного окна", () => {
  const report = calculateHeating(input({ rooms: [room({ hasPanoramicWindows: true })] }));

  assert.equal(report.radiators[0]?.status, "requires_engineer_review");
  assert.equal(report.radiators[0]?.requiredPowerW, null);
  assert.ok(report.warnings.some(({ code }) => code === "RAD_PANORAMIC_WINDOW_REVIEW"));
});

test("передаёт инженеру размещение радиатора в помещении без окна", () => {
  const report = calculateHeating(
    input({ rooms: [room({ hasStandardWindows: false, hasPanoramicWindows: false })] }),
  );

  assert.equal(report.radiators[0]?.status, "requires_engineer_review");
  assert.equal(report.radiators[0]?.requiredPowerW, null);
  assert.ok(report.warnings.some(({ code }) => code === "RAD_NONSTANDARD_PLACEMENT_REVIEW"));
});

test("выбирает мощность газового котла на границах таблицы", () => {
  const cases = [
    [200, 24],
    [200.01, 30],
    [250, 30],
    [250.01, 35],
    [300, 35],
    [300.01, 40],
    [400, 40],
  ] as const;

  for (const [houseAreaM2, expectedPower] of cases) {
    const report = calculateHeating(input({ houseAreaM2, includeIndirectWaterHeater: false }));
    assert.equal(report.boiler.recommendedPowerKw, expectedPower, `площадь ${houseAreaM2}`);
    assert.equal(report.boiler.status, "calculated");
  }
});

test("дом больше 400 м² передаёт выбор газового котла инженеру", () => {
  const report = calculateHeating(input({ houseAreaM2: 400.01, includeIndirectWaterHeater: false }));

  assert.equal(report.boiler.status, "requires_engineer_review");
  assert.equal(report.boiler.recommendedPowerKw, null);
});

test("выбирает электрокотёл 12 кВт только при достаточной доступной мощности", () => {
  const enoughPower = calculateHeating(
    input({ heatSource: "electric", houseAreaM2: 130, availableElectricPowerKw: 15, includeIndirectWaterHeater: false }),
  );
  const insufficientPower = calculateHeating(
    input({ heatSource: "electric", houseAreaM2: 130, availableElectricPowerKw: 10, includeIndirectWaterHeater: false }),
  );

  assert.equal(enoughPower.boiler.recommendedPowerKw, 12);
  assert.equal(enoughPower.boiler.status, "calculated");
  assert.equal(insufficientPower.boiler.recommendedPowerKw, null);
  assert.equal(insufficientPower.boiler.status, "requires_engineer_review");
});

test("выбирает бойлер по известным сочетаниям", () => {
  const fourResidents = calculateHeating(input({ residents: 4, baths: 0, showers: 0 }));
  const threeWithBath = calculateHeating(input({ residents: 3, baths: 1, showers: 0 }));
  const threeWithShower = calculateHeating(input({ residents: 3, baths: 0, showers: 1 }));

  assert.equal(fourResidents.waterHeater.recommendedVolumeL, 200);
  assert.equal(threeWithBath.waterHeater.recommendedVolumeL, 200);
  assert.equal(threeWithShower.waterHeater.recommendedVolumeL, 150);
});

test("неизвестное сочетание бойлера не рассчитывается молча", () => {
  const report = calculateHeating(input({ residents: 2, baths: 0, showers: 1 }));

  assert.equal(report.waterHeater.status, "requires_engineer_review");
  assert.equal(report.waterHeater.recommendedVolumeL, null);
  assert.equal(report.status, "requires_engineer_review");
});

test("одинаковые входные данные дают побайтно одинаковый отчёт", () => {
  const source = input();

  assert.equal(JSON.stringify(calculateHeating(source)), JSON.stringify(calculateHeating(source)));
});
