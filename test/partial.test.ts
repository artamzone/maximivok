import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { calculateHeating } from "../src/calculator.js";
import { parseHeatingInput } from "../src/validation.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteProjectRepository } from "../src/storage.js";
import type { HeatingReport } from "../src/types.js";
import { parseCalculationDraft } from "../src/project-validation.js";

const full = JSON.parse(readFileSync("examples/heating-input.json", "utf8")) as Record<string, unknown>;

test("полный старый вход сохраняет точный отчёт", () => {
  const expected: unknown = JSON.parse(readFileSync("test/fixtures/legacy-report.json", "utf8"));
  const report = calculateHeating(parseHeatingInput(full));
  assert.deepEqual(report, expected);
  assert.equal(JSON.stringify(report), JSON.stringify(expected));
});

test("явно пустой контур остаётся null, труба и работы рассчитываются", () => {
  const report = calculateHeating(parseHeatingInput({ ...full, circuitLengthM: null }));
  assert.equal(report.input.circuitLengthM, null);
  assert.equal(report.floorHeating.circuitLengthM, null);
  assert.equal(report.floorHeating.circuitCount, null);
  assert.deepEqual(report.floorHeating.missingParameters, ["circuitLengthM"]);
  assert.equal(report.floorHeating.pipeLengthM, 240);
  assert.equal(report.floorHeating.installationCostRub, 36000);
});

test("пустой источник сохраняется без подмены на инженера", () => {
  const draft = parseCalculationDraft({ input: { ...full, circuitLengthM: null },
    parameterMetadata: [{ path: "input.circuitLengthM", source: "", verificationStatus: "unverified" }] });
  const repository = new SqliteProjectRepository(":memory:");
  try {
    const object = repository.createObject({
      client: { name: "Тест", phone: null, email: null, notes: null },
      object: { address: "Тестовый адрес", name: null, notes: null }, calculation: draft,
    }, calculateHeating(draft.input));
    assert.equal(object.calculations[0]?.input.circuitLengthM, null);
    assert.equal(object.calculations[0]?.parameters.find((p) => p.path === "input.circuitLengthM")?.source, "");
  } finally { repository.close(); }
});

test("неописанное отопление не подменяет неизвестные значения нулями", () => {
  const report = calculateHeating(parseHeatingInput({}));
  assert.equal(report.input.houseAreaM2, null);
  assert.equal(report.input.includeIndirectWaterHeater, null);
  assert.equal(report.floorHeating.status, "impossible");
  assert.equal(report.floorHeating.pipeLengthM, null);
  assert.equal(report.boiler.status, "impossible");
  assert.equal(report.waterHeater.status, "impossible");
  assert.equal(report.boilerRoom.templateCode, null);
});

test("при неизвестных радиаторах рассчитывает трубу и работы, но не смеситель", () => {
  const raw = structuredClone(full);
  const rooms = raw.rooms as Record<string, unknown>[];
  rooms[0]!.hasRadiator = null;
  rooms[1]!.hasRadiator = false;
  const report = calculateHeating(parseHeatingInput(raw));
  assert.equal(report.floorHeating.pipeLengthM, 240);
  assert.equal(report.floorHeating.installationCostRub, 36000);
  assert.equal(report.floorHeating.mixingUnitCount, null);
  assert.equal(report.radiators[0]?.status, "impossible");
  assert.equal(report.boilerRoom.status, "impossible");
});

test("неизвестная площадь ТП не мешает выбору газового котла", () => {
  const raw = structuredClone(full);
  (raw.rooms as Record<string, unknown>[])[0]!.floorHeatingAreaM2 = null;
  const report = calculateHeating(parseHeatingInput(raw));
  assert.equal(report.floorHeating.pipeLengthM, null);
  assert.equal(report.boiler.recommendedPowerKw, 24);
  assert.equal(report.waterHeater.recommendedVolumeL, 150);
});

test("неизвестный бойлер отличается от ненужного", () => {
  const unknown = calculateHeating(parseHeatingInput({ ...full, includeIndirectWaterHeater: null }));
  const absent = calculateHeating(parseHeatingInput({ ...full, includeIndirectWaterHeater: false }));
  assert.equal(unknown.waterHeater.status, "impossible");
  assert.equal(unknown.boilerRoom.includesIndirectWaterHeater, null);
  assert.equal(absent.waterHeater.status, "calculated");
});

test("бойлер для четырёх жильцов рассчитывается без данных о ваннах и душах", () => {
  const report = calculateHeating(parseHeatingInput({ ...full, residents: 4, baths: null, showers: null }));
  assert.equal(report.waterHeater.recommendedVolumeL, 200);
});

test("неизвестная ванна не разрешает применить правило душа", () => {
  const report = calculateHeating(parseHeatingInput({ ...full, residents: 3, baths: null, showers: 1 }));
  assert.equal(report.waterHeater.status, "impossible");
  assert.equal(report.waterHeater.recommendedVolumeL, null);
});

test("электрокотёл без доступной мощности показывает недостающий параметр", () => {
  const report = calculateHeating(parseHeatingInput({ ...full, heatSource: "electric" }));
  assert.equal(report.boiler.status, "impossible");
  assert.deepEqual(report.boiler.missingParameters, ["availableElectricPowerKw"]);
});

test("частичный расчёт детерминирован и не изменяет вход", () => {
  const input = parseHeatingInput({ ...full, residents: null });
  const before = structuredClone(input);
  assert.equal(JSON.stringify(calculateHeating(input)), JSON.stringify(calculateHeating(input)));
  assert.deepEqual(input, before);
});

test("частичный расчёт и старый отчёт читаются после перезапуска SQLite", () => {
  const directory = mkdtempSync(join(tmpdir(), "ivok-partial-"));
  const path = join(directory, "test.sqlite");
  let repository = new SqliteProjectRepository(path);
  try {
    const input = parseHeatingInput(full);
    const legacy = JSON.parse(readFileSync("test/fixtures/legacy-report.json", "utf8")) as HeatingReport;
    const object = repository.createObject({
      client: { name: "Тест", phone: null, email: null, notes: null },
      object: { address: "Тестовый адрес", name: null, notes: null },
      calculation: { input, parameterMetadata: [] },
    }, legacy);
    const partialInput = parseHeatingInput({ ...full, includeIndirectWaterHeater: null });
    const partialReport = calculateHeating(partialInput);
    repository.addCalculation(object.id, { input: partialInput, parameterMetadata: [] }, partialReport);
    repository.close();
    repository = new SqliteProjectRepository(path);
    const restored = repository.getObject(object.id)!;
    assert.equal(restored.calculations.length, 2);
    assert.ok(restored.calculations.some((calculation) => JSON.stringify(calculation.report) === JSON.stringify(legacy)));
    assert.ok(restored.calculations.some((calculation) => JSON.stringify(calculation.report) === JSON.stringify(partialReport)));
  } finally {
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("пустые строки и неверные типы не принимаются вместо неизвестных значений", () => {
  assert.throws(() => parseHeatingInput({ ...full, residents: "" }));
  assert.throws(() => parseHeatingInput({ ...full, includeIndirectWaterHeater: "unknown" }));
});
