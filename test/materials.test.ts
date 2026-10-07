import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { SqliteProjectRepository } from "../src/storage.js";
import { importSanBazaCatalog, SqliteCatalogRepository } from "../src/catalog-storage.js";
import { calculateHeating } from "../src/calculator.js";
import { parseHeatingInput } from "../src/validation.js";
import { lineTotalKopecks, parseMaterialsDraft } from "../src/materials.js";

const fixture = (name: string): string => resolve("test/fixtures", name);

test("материалы — отдельные версии: новые цены при сохранении, прежние снимки и расчёт неизменны", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ivok-materials-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "test.sqlite");
  let repository = new SqliteProjectRepository(path);
  const input = parseHeatingInput({});
  const object = repository.createObject({
    client: { name: "Тест", phone: null, email: null, notes: null },
    object: { address: "Тестовый адрес", name: null, notes: null },
    calculation: { input, parameterMetadata: [] },
  }, calculateHeating(input));
  await importSanBazaCatalog(fixture("catalog-valid.xlsx"), path);
  const catalog = new SqliteCatalogRepository(path, { readOnly: true });
  const product = catalog.getProduct("https://san-baza.ru/catalog/test/1/");
  catalog.close();
  assert.ok(product);
  const draft = parseMaterialsDraft({ baseVersionId: null, items: [{ productId: product.id, quantity: 2.5, expectedUnit: "м.п." }] });
  try {
    assert.equal(repository.materials.getCollection(object.id)?.latest, null);
    const first = repository.materials.save(object.id, draft);
    assert.ok(first);
    assert.equal(first.versionNumber, 1);
    assert.equal(first.items[0]?.priceRub, 2.5);
    assert.equal(first.items[0]?.lineTotalKopecks, 625);
    assert.equal(first.knownTotalKopecks, 625);
    await importSanBazaCatalog(fixture("catalog-partial.xlsx"), path);
    const second = repository.materials.save(object.id, { ...draft, baseVersionId: first.id });
    assert.ok(second);
    assert.equal(second.versionNumber, 2);
    assert.equal(second.items[0]?.priceRub, 3.75);
    assert.equal(second.items[0]?.name, "Товар A обновлён");
    assert.equal(second.knownTotalKopecks, 938);
    assert.deepEqual(repository.materials.getVersion(object.id, first.id), first);
    assert.deepEqual(repository.getObject(object.id), object);
    repository.close();
    repository = new SqliteProjectRepository(path);
    assert.deepEqual(repository.materials.getVersion(object.id, first.id), first);
    assert.deepEqual(repository.materials.getCollection(object.id)?.latest, second);
    assert.equal(repository.materials.getCollection(object.id)?.versions.length, 2);
  } finally {
    repository.close();
  }
});

test("денежные суммы округляются по строкам в десятичной арифметике, переполнение не скрывается", () => {
  assert.equal(lineTotalKopecks(1.005, 1), 101);
  assert.equal(lineTotalKopecks(0.1, 0.2), 2);
  assert.equal(lineTotalKopecks(3.75, 2.5), 938);
  assert.equal(lineTotalKopecks(0, 2), 0);
  assert.equal(lineTotalKopecks(1e-7, 1e7), 100);
  assert.throws(() => lineTotalKopecks(Number.MAX_VALUE, 2), /диапазон/);
});

test("валидация отвергает подмену цен, дубли товаров, неверные количества и отсутствие версии", () => {
  const item = { productId: "product", quantity: 1, expectedUnit: "шт" };
  for (const quantity of [0, -1, null, "2", NaN, Infinity]) {
    assert.throws(() => parseMaterialsDraft({ baseVersionId: null, items: [{ ...item, quantity }] }), /quantity/);
  }
  assert.throws(() => parseMaterialsDraft({ items: [item] }), /baseVersionId/);
  assert.throws(() => parseMaterialsDraft({ baseVersionId: null, items: [item, item] }), /повторяется/);
  assert.throws(() => parseMaterialsDraft({ baseVersionId: null, items: [{ ...item, priceRub: 1 }] }), /сервер/);
  assert.throws(() => parseMaterialsDraft({ baseVersionId: null, items: [item], knownTotalKopecks: 1 }), /сервер/);
  assert.throws(() => parseMaterialsDraft({ baseVersionId: null, items: Array(501).fill(item) }), /500/);
  assert.deepEqual(parseMaterialsDraft({ baseVersionId: null, items: [] }), { baseVersionId: null, items: [] });
});
