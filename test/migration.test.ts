import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { calculateHeating } from "../src/calculator.js";
import { calculatePlumbing } from "../src/plumbing.js";
import { calculateSewage } from "../src/sewage.js";
import {
  LOCAL_ORGANIZATION_ID,
  type CreateObjectDraft,
  type PlumbingCalculationDraft,
  type SewageCalculationDraft,
} from "../src/projects.js";
import { SqliteProjectRepository } from "../src/storage.js";

/**
 * P2 из TaskCheck: регрессионный тест миграции старой таблицы calculations.
 *
 * Шаги:
 * 1. Создаём БД со старой схемой (без колонок block и work_prices_json) и вставляем heating-расчёт.
 * 2. Открываем её через SqliteProjectRepository. Должна пройти миграция:
 *    - ALTER TABLE добавит block (DEFAULT 'heating') и work_prices_json;
 *    - CHECK должен быть расширен до ('heating', 'plumbing', 'sewage').
 * 3. Старая heating-запись читается как block='heating'.
 * 4. Можно добавить новые версии по всем трём блокам.
 * 5. Старая запись не изменяется и не дублируется.
 */

const oldSchema = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE clients (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE client_objects (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    client_id TEXT NOT NULL REFERENCES clients(id),
    address TEXT NOT NULL,
    name TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE calculations (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    object_id TEXT NOT NULL REFERENCES client_objects(id),
    input_json TEXT NOT NULL,
    report_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE calculation_parameters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    calculation_id TEXT NOT NULL REFERENCES calculations(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('input', 'output')),
    path TEXT NOT NULL,
    source TEXT NOT NULL,
    verification_status TEXT NOT NULL,
    UNIQUE(calculation_id, kind, path)
  );
`;

function makeObjectDraft(): CreateObjectDraft {
  return {
    client: { name: "Иван Миграционный", phone: null, email: null, notes: null },
    object: { address: "Адрес миграции 1", name: null, notes: null },
    calculation: {
      input: {
        houseAreaM2: 80,
        rooms: [{
          id: "r1",
          name: "Гостиная",
          areaM2: 20,
          ceilingHeightM: 2.7,
          hasStandardWindows: true,
          hasPanoramicWindows: false,
          floorHeatingAreaM2: 15,
          hasRadiator: true,
        }],
        heatSource: "gas",
        availableElectricPowerKw: null,
        residents: 2,
        baths: 0,
        showers: 0,
        includeIndirectWaterHeater: false,
        circuitLengthM: 80,
      },
      parameterMetadata: [],
    },
  };
}

test("P2: миграция старой БД (без block/work_prices_json) в новую схему сохраняет heating-расчёт и разрешает plumbing/sewage", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ivok-migration-"));
  const databasePath = join(directory, "legacy.sqlite");
  try {
    // 1. Создаём БД со старой схемой и одной heating-записью.
    {
      const db = new DatabaseSync(databasePath);
      db.exec(oldSchema);
      db.prepare("INSERT INTO organizations (id, name) VALUES (?, ?)")
        .run(LOCAL_ORGANIZATION_ID, "Локальная организация ИВОК");
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO clients (id, organization_id, name, phone, email, notes, created_at, updated_at)
                  VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?)`)
        .run("client-1", LOCAL_ORGANIZATION_ID, "Иван Миграционный", now, now);
      db.prepare(`INSERT INTO client_objects (id, organization_id, client_id, address, name, notes, created_at, updated_at)
                  VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)`)
        .run("object-1", LOCAL_ORGANIZATION_ID, "client-1", "Адрес миграции 1", now, now);
      const draft = makeObjectDraft();
      const report = calculateHeating(draft.calculation!.input);
      db.prepare(`INSERT INTO calculations (id, organization_id, object_id, input_json, report_json, created_at)
                  VALUES (?, ?, ?, ?, ?, ?)`)
        .run(
          "calculation-1",
          LOCAL_ORGANIZATION_ID,
          "object-1",
          JSON.stringify(draft.calculation!.input),
          JSON.stringify(report),
          now,
        );
      db.close();
    }

    // 2. Открываем через SqliteProjectRepository — миграция должна пройти.
    const repository = new SqliteProjectRepository(databasePath);

    // 3. Проверяем, что старая запись читается.
    const restored = repository.getObject("object-1");
    assert.ok(restored, "объект должен быть найден после миграции");
    assert.equal(restored.calculations.length, 1, "должна быть одна heating-запись");
    const oldReport = restored.calculations[0];
    assert.ok(oldReport);
    assert.deepEqual(oldReport.input.houseAreaM2, 80);

    // 4. Проверяем, что CHECK расширен до sewage — открываем файл тем же путём.
    // Используем отдельное соединение только для чтения, чтобы убедиться, что миграция
    // записала новую схему на диск.
    {
      const inspectDb = new DatabaseSync(databasePath, { readOnly: true });
      const tableRow = inspectDb.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'calculations'",
      ).get() as { sql: string } | undefined;
      assert.ok(tableRow);
      assert.ok(tableRow.sql.includes("'sewage'"), "CHECK должен содержать 'sewage'");
      assert.ok(tableRow.sql.includes("'plumbing'"), "CHECK должен содержать 'plumbing'");
      assert.ok(tableRow.sql.includes("'heating'"), "CHECK должен содержать 'heating'");
      inspectDb.close();
    }

    // 5. Можно добавить новые версии по всем трём блокам.
    const prices = repository.works.getPlumbingPrices();
    const plumbingInput = {
      rooms: [{ roomId: "r1", fixtures: [{ type: "sink" as const, count: 1, lengthM: null, comment: null }], hasRecirculation: false as const }],
      hotWaterSource: "gas_boiler" as const,
      recirculationLengthM: null,
    };
    const plumbingReport = calculatePlumbing(plumbingInput, prices);
    const plumbingDraft: PlumbingCalculationDraft = {
      input: plumbingInput,
      parameterMetadata: [],
      workPrices: prices,
      baseRevision: prices.revision,
    };
    const savedPlumbing = repository.addPlumbingCalculation("object-1", plumbingDraft, plumbingReport);
    assert.ok(savedPlumbing);
    assert.equal(savedPlumbing.block, "plumbing");

    const sewagePrices = repository.works.getSewagePrices();
    const sewageInput = {
      sewer: { trapCount: 0, alreadyExecuted: [], sewerMains: [], standpipes: 0 },
      plumbing: plumbingInput,
    };
    const sewageReport = calculateSewage(sewageInput, sewagePrices);
    const sewageDraft: SewageCalculationDraft = {
      input: sewageInput,
      parameterMetadata: [],
      workPrices: sewagePrices,
      baseRevision: sewagePrices.revision,
    };
    const savedSewage = repository.addSewageCalculation("object-1", sewageDraft, sewageReport);
    assert.ok(savedSewage);
    assert.equal(savedSewage.block, "sewage");

    // 6. Heating-запись по-прежнему на месте и не задета.
    const final = repository.getObject("object-1");
    assert.ok(final);
    if (final) {
      assert.equal(final.calculations.length, 1, "heating-запись не должна быть затронута");
      const heating = final.calculations[0];
      assert.ok(heating);
      if (heating) assert.deepEqual(heating.input.houseAreaM2, 80);
      assert.equal(final.plumbingCalculations.length, 1);
      assert.equal(final.sewageCalculations.length, 1);
    }

    repository.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("P2: повторное открытие БД после миграции не дублирует записи и не падает", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ivok-migration-reopen-"));
  const databasePath = join(directory, "legacy.sqlite");
  try {
    // Создаём старую БД и сразу открываем через репозиторий (миграция).
    {
      const db = new DatabaseSync(databasePath);
      db.exec(oldSchema);
      db.prepare("INSERT INTO organizations (id, name) VALUES (?, ?)")
        .run(LOCAL_ORGANIZATION_ID, "Локальная организация ИВОК");
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO clients (id, organization_id, name, phone, email, notes, created_at, updated_at)
                  VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?)`)
        .run("client-1", LOCAL_ORGANIZATION_ID, "Иван", now, now);
      db.prepare(`INSERT INTO client_objects (id, organization_id, client_id, address, name, notes, created_at, updated_at)
                  VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)`)
        .run("object-1", LOCAL_ORGANIZATION_ID, "client-1", "Адрес", now, now);
      db.prepare(`INSERT INTO calculations (id, organization_id, object_id, input_json, report_json, created_at)
                  VALUES (?, ?, ?, '{}', '{}', ?)`)
        .run("calculation-1", LOCAL_ORGANIZATION_ID, "object-1", now);
      db.close();
    }
    // Первое открытие — миграция.
    const r1 = new SqliteProjectRepository(databasePath);
    r1.close();
    // Повторное открытие — без ошибок, без дубликатов.
    const r2 = new SqliteProjectRepository(databasePath);
    const obj = r2.getObject("object-1");
    assert.ok(obj);
    if (obj) assert.equal(obj.calculations.length, 1);
    r2.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
