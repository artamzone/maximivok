import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { importSanBazaCatalog, SqliteCatalogRepository } from "../src/catalog-storage.js";
import { SqliteProjectRepository } from "../src/storage.js";
import { calculateHeating } from "../src/calculator.js";
import { parseHeatingInput } from "../src/validation.js";

const fixture = (name: string): string => resolve("test/fixtures", name);
const productUrl = "https://san-baza.ru/catalog/test/1/";

test("импорт сохраняет товары и журнал после перезапуска; повтор не создаёт дубликаты", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ivok-catalog-storage-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, "ivok.sqlite");
  const first = await importSanBazaCatalog(fixture("catalog-valid.xlsx"), databasePath);
  assert.equal(first.insertedRows, 2);
  assert.equal(first.updatedRows, 0);
  assert.equal(first.importedRows, 2);
  assert.equal(first.skippedRows, 0);
  assert.deepEqual(first.issues, []);
  assert.equal(first.fileName, "catalog-valid.xlsx");
  assert.equal(first.organizationId, "org-local");
  const repository = new SqliteCatalogRepository(databasePath);
  const original = repository.getProduct(productUrl);
  assert.ok(original);
  assert.equal(original.article, "001");
  assert.equal(original.priceRub, 2.5);
  assert.equal(original.unit, "м.п.");
  assert.equal(original.organizationId, "org-local");
  assert.equal(original.lastImportId, first.id);
  assert.deepEqual(repository.getImport(first.id), first);
  repository.close();

  const second = await importSanBazaCatalog(fixture("catalog-valid.xlsx"), databasePath);
  assert.equal(second.insertedRows, 0);
  assert.equal(second.updatedRows, 2);
  assert.notEqual(second.id, first.id);
  const reopened = new SqliteCatalogRepository(databasePath);
  try {
    assert.equal(reopened.countProducts(), 2);
    assert.equal(reopened.getProduct(productUrl)?.id, original.id);
    assert.equal(reopened.getProduct(productUrl)?.lastImportId, second.id);
    assert.deepEqual(reopened.getImport(first.id), first);
    assert.equal(reopened.listImports().length, 2);
    assert.equal(reopened.getImport("missing"), null);
    assert.equal(reopened.getProduct("https://san-baza.ru/catalog/missing/"), null);
  } finally {
    reopened.close();
  }
});

test("корректные строки обновляются, ошибки сохраняются отдельно, ошибочные и отсутствующие товары не меняются", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ivok-catalog-partial-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, "ivok.sqlite");
  const first = await importSanBazaCatalog(fixture("catalog-valid.xlsx"), databasePath);
  const report = await importSanBazaCatalog(fixture("catalog-partial.xlsx"), databasePath);
  assert.equal(report.rowCount, 4);
  assert.equal(report.importedRows, 2);
  assert.equal(report.skippedRows, 2);
  assert.equal(report.insertedRows, 1);
  assert.equal(report.updatedRows, 1);
  assert.deepEqual(report.issues.map(({ row, column }) => [row, column]), [[6, "D"], [8, "B"], [8, "D"]]);
  let repository = new SqliteCatalogRepository(databasePath, { readOnly: true });
  try {
    assert.equal(repository.countProducts(), 3);
    assert.equal(repository.getProduct(productUrl)?.priceRub, 3.75);
    assert.equal(repository.getProduct(productUrl)?.name, "Товар A обновлён");
    assert.equal(repository.getProduct("https://san-baza.ru/catalog/test/2/")?.priceRub, 10);
    assert.equal(repository.getProduct("https://san-baza.ru/catalog/test/2/")?.lastImportId, first.id);
    assert.deepEqual(repository.getImport(report.id), report);
  } finally {
    repository.close();
  }
  const allInvalid = await importSanBazaCatalog(fixture("catalog-invalid.xlsx"), databasePath);
  assert.equal(allInvalid.importedRows, 0);
  assert.equal(allInvalid.skippedRows, 7);
  repository = new SqliteCatalogRepository(databasePath, { readOnly: true });
  try {
    assert.equal(repository.countProducts(), 3);
    assert.equal(repository.getProduct(productUrl)?.lastImportId, report.id);
    assert.equal(repository.getProduct(productUrl)?.priceRub, 3.75);
    assert.equal(repository.getProduct("https://san-baza.ru/catalog/test/3/")?.priceRub, 30);
    assert.equal(repository.listImports().length, 3);
    assert.deepEqual(repository.getImport(first.id), first);
    assert.deepEqual(repository.getImport(allInvalid.id), allInvalid);
  } finally {
    repository.close();
  }
});

test("неизвестная и нулевая цена не смешиваются; отсутствующие в файле товары не удаляются", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ivok-catalog-prices-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, "ivok.sqlite");
  await importSanBazaCatalog(fixture("catalog-valid.xlsx"), databasePath);
  const unknown = await importSanBazaCatalog(fixture("catalog-unknown.xlsx"), databasePath);
  const missing = await importSanBazaCatalog(fixture("catalog-missing-price.xlsx"), databasePath);
  const repository = new SqliteCatalogRepository(databasePath, { readOnly: true });
  try {
    assert.equal(repository.countProducts(), 4);
    assert.equal(repository.getProduct(productUrl)?.priceRub, null);
    assert.equal(repository.getProduct(productUrl)?.lastImportId, missing.id);
    assert.equal(repository.getProduct("https://san-baza.ru/catalog/test/8/")?.priceRub, null);
    assert.equal(repository.getProduct("https://san-baza.ru/catalog/test/9/")?.priceRub, 0);
    assert.equal(repository.getImport(unknown.id)?.missingPriceCount, 1);
    assert.equal(repository.getImport(unknown.id)?.zeroPriceCount, 1);
    assert.equal(repository.getImport(unknown.id)?.repeatedArticleCount, 1);
  } finally {
    repository.close();
  }
});

test("нечитаемый формат не создаёт базу и не добавляет запись импорта", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ivok-catalog-invalid-file-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, "ivok.sqlite");
  await assert.rejects(importSanBazaCatalog(fixture("catalog-header.xlsx"), databasePath), /строке 4/);
  assert.deepEqual(await readdir(directory), []);
  const first = await importSanBazaCatalog(fixture("catalog-valid.xlsx"), databasePath);
  await assert.rejects(importSanBazaCatalog(fixture("catalog-sheet.xlsx"), databasePath), /Каталог/);
  const repository = new SqliteCatalogRepository(databasePath, { readOnly: true });
  try {
    assert.equal(repository.countProducts(), 2);
    assert.deepEqual(repository.listImports(), [first]);
  } finally {
    repository.close();
  }
});

test("новые таблицы каталога не меняют карточки и сохранённые расчёты TASK-02", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ivok-catalog-projects-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, "ivok.sqlite");
  const projects = new SqliteProjectRepository(databasePath);
  const input = parseHeatingInput({});
  let created;
  try {
    created = projects.createObject({
      client: { name: "Тестовый клиент", phone: null, email: null, notes: null },
      object: { address: "Тестовый адрес", name: null, notes: null },
      calculation: { input, parameterMetadata: [] },
    }, calculateHeating(input));
  } finally {
    projects.close();
  }
  await importSanBazaCatalog(fixture("catalog-partial.xlsx"), databasePath);
  const reopened = new SqliteProjectRepository(databasePath);
  try {
    assert.deepEqual(reopened.getObject(created.id), created);
    assert.equal(reopened.listObjects().length, 1);
  } finally {
    reopened.close();
  }
});

test("сбой SQLite откатывает и товары, и журнал, даже после успешного обновления первой строки", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ivok-catalog-rollback-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, "ivok.sqlite");
  const first = await importSanBazaCatalog(fixture("catalog-valid.xlsx"), databasePath);
  // Inject a storage failure at the database boundary, after product A has been updated.
  const fault = new DatabaseSync(databasePath);
  try {
    fault.exec(`CREATE TRIGGER fail_catalog_insert BEFORE INSERT ON catalog_products
      WHEN NEW.source_url = 'https://san-baza.ru/catalog/test/3/'
      BEGIN SELECT RAISE(ABORT, 'injected storage failure'); END;`);
  } finally {
    fault.close();
  }
  await assert.rejects(importSanBazaCatalog(fixture("catalog-partial.xlsx"), databasePath), /injected storage failure/);
  const repository = new SqliteCatalogRepository(databasePath, { readOnly: true });
  try {
    assert.equal(repository.countProducts(), 2);
    assert.equal(repository.getProduct(productUrl)?.priceRub, 2.5);
    assert.equal(repository.getProduct(productUrl)?.lastImportId, first.id);
    assert.deepEqual(repository.listImports(), [first]);
  } finally {
    repository.close();
  }
});
