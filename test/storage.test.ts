import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { calculateHeating } from "../src/calculator.js";
import type { CreateObjectDraft } from "../src/projects.js";
import { SqliteProjectRepository } from "../src/storage.js";

function calculationOf(value: CreateObjectDraft): NonNullable<CreateObjectDraft["calculation"]> {
  if (value.calculation === null) throw new Error("Тестовый расчёт отсутствует");
  return value.calculation;
}

function draft(): CreateObjectDraft {
  return {
    client: { name: "Иван Петров", phone: null, email: null, notes: null },
    object: { address: "Москва, ул. Примерная, 1", name: null, notes: null },
    calculation: {
      input: {
        houseAreaM2: 120,
        rooms: [{
          id: "living-room",
          name: "Гостиная",
          areaM2: 30,
          ceilingHeightM: 2.8,
          hasStandardWindows: true,
          hasPanoramicWindows: false,
          floorHeatingAreaM2: 25,
          hasRadiator: true,
        }],
        heatSource: "gas",
        availableElectricPowerKw: null,
        residents: 3,
        baths: 0,
        showers: 1,
        includeIndirectWaterHeater: true,
        circuitLengthM: 80,
      },
      parameterMetadata: [{
        path: "input.houseAreaM2",
        source: "client",
        verificationStatus: "confirmed",
      }],
    },
  };
}

test("сохраняет карточку, расчёт и метаданные после повторного открытия SQLite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ivok-storage-"));
  const databasePath = join(directory, "ivok.sqlite");
  try {
    const initialDraft = draft();
    const repository = new SqliteProjectRepository(databasePath);
    const created = repository.createObject(
      initialDraft,
      calculateHeating(calculationOf(initialDraft).input),
    );
    assert.equal(created.organizationId, "org-local");
    assert.equal(created.client.name, "Иван Петров");
    repository.close();

    const reopened = new SqliteProjectRepository(databasePath);
    const restored = reopened.getObject(created.id);
    assert.ok(restored);
    assert.equal(restored.object.address, "Москва, ул. Примерная, 1");
    assert.equal(restored.calculations.length, 1);
    assert.deepEqual(restored.calculations[0]?.input, calculationOf(initialDraft).input);
    assert.ok(restored.calculations[0]?.parameters.some((parameter) =>
      parameter.path === "input.houseAreaM2"
      && parameter.source === "client"
      && parameter.verificationStatus === "confirmed"));
    assert.ok(restored.calculations[0]?.parameters.some((parameter) =>
      parameter.path === "report.floorHeating.pipeLengthM"
      && parameter.source === "calculation"));
    reopened.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("редактирует карточку и добавляет новую версию расчёта", () => {
  const repository = new SqliteProjectRepository(":memory:");
  try {
    const initialDraft = draft();
    const created = repository.createObject(
      initialDraft,
      calculateHeating(calculationOf(initialDraft).input),
    );
    const updated = repository.updateObject(
      created.id,
      { ...initialDraft.client, name: "Пётр Иванов" },
      { ...initialDraft.object, address: "Тверь, ул. Новая, 2" },
    );
    assert.equal(updated?.client.name, "Пётр Иванов");
    assert.equal(updated?.object.address, "Тверь, ул. Новая, 2");

    const secondInput = { ...(calculationOf(initialDraft).input), houseAreaM2: 140 };
    const calculation = repository.addCalculation(
      created.id,
      { input: secondInput, parameterMetadata: [] },
      calculateHeating(secondInput),
    );
    assert.ok(calculation);
    assert.equal(repository.getObject(created.id)?.calculations.length, 2);
    assert.equal(repository.listObjects()[0]?.clientName, "Пётр Иванов");
    assert.equal(repository.listObjects()[0]?.latestCalculationStatus, calculation.report.status);
  } finally {
    repository.close();
  }
});


test("список показывает статус последнего расчёта и отсутствие расчёта", () => {
  const repository = new SqliteProjectRepository(":memory:");
  try {
    const initial = draft();
    const created = repository.createObject({ ...initial, calculation: null }, null);
    assert.equal(repository.listObjects()[0]?.latestCalculationStatus, null);
    for (const input of [
      { ...calculationOf(initial).input, includeIndirectWaterHeater: false },
      { ...calculationOf(initial).input, circuitLengthM: 85 },
      { ...calculationOf(initial).input, circuitLengthM: 91 },
    ]) {
      const report = calculateHeating(input);
      repository.addCalculation(created.id, { input, parameterMetadata: [] }, report);
      assert.equal(repository.listObjects()[0]?.latestCalculationStatus, report.status);
    }
    assert.equal(repository.listObjects()[0]?.latestCalculationStatus, "impossible");
  } finally {
    repository.close();
  }
});
