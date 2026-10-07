import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createWebServer } from "../src/server.js";
import { SqliteCatalogRepository } from "../src/catalog-storage.js";
import { searchCatalogFixture } from "./fixtures/catalog-search.js";

async function withMaterials(run: (url: string, path: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "ivok-materials-http-"));
  const path = join(directory, "test.sqlite");
  const server = createWebServer({ databasePath: path });
  try {
    const catalog = new SqliteCatalogRepository(path);
    try { catalog.saveImport(searchCatalogFixture(), "test.xlsx"); }
    finally { catalog.close(); }
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, path);
  } finally {
    server.close();
    await once(server, "close");
    await rm(directory, { recursive: true, force: true });
  }
}

const post = (url: string, value: unknown) => fetch(url, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value),
});
async function createObject(url: string) {
  const response = await post(`${url}/api/objects`, { client: { name: "Клиент" }, object: { address: "Адрес" } });
  assert.equal(response.status, 201);
  return response.json();
}

async function product(url: string, article: string) {
  const data = await (await fetch(`${url}/api/catalog?${new URLSearchParams({ query: article })}`)).json();
  return data.products[0];
}

test("HTTP сохраняет материалы отдельно от отопления, показывает версии и считает неизвестные/нулевые цены", async () => {
  await withMaterials(async (url, path) => {
    const object = await createObject(url);
    const endpoint = `${url}/api/objects/${object.id}/materials`;
    const initial = await (await fetch(endpoint)).json();
    assert.equal(initial.latest, null);
    assert.deepEqual(initial.versions, []);
    const db = new DatabaseSync(path, { readOnly: true });
    try { assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='object_material_versions'").get(), undefined); }
    finally { db.close(); }
    const unknown = await product(url, "Радиатор 01");
    const zero = await product(url, "Радиатор 02");
    const known = await product(url, "АРТ-АБВ");
    const response = await post(endpoint, { baseVersionId: null, items: [unknown, zero, known].map((p) => ({ productId: p.id, quantity: 2.5, expectedUnit: p.unit })) });
    assert.equal(response.status, 201);
    const first = await response.json();
    assert.equal(first.unpricedCount, 1);
    assert.equal(first.zeroPriceCount, 1);
    assert.equal(first.knownTotalKopecks, 625);
    assert.deepEqual(first.items.map((p: { lineTotalKopecks: number | null }) => p.lineTotalKopecks), [null, 0, 625]);
    assert.deepEqual(await (await fetch(`${endpoint}/${first.id}`)).json(), first);
    assert.deepEqual(await (await fetch(`${url}/api/objects/${object.id}`)).json(), object);
    const clear = await post(endpoint, { baseVersionId: first.id, items: [] });
    assert.equal(clear.status, 201);
    const second = await clear.json();
    assert.equal(second.versionNumber, 2);
    assert.equal(second.items.length, 0);
    const collection = await (await fetch(endpoint)).json();
    assert.equal(collection.versions.length, 2);
    assert.deepEqual(collection.latest, second);
    assert.deepEqual(await (await fetch(`${endpoint}/${first.id}`)).json(), first);
    assert.equal((await fetch(`${endpoint}/unknown-version`)).status, 404);
  });
});

test("неверный запрос и устаревшая вкладка не создают версии; изменение единицы требует повторного выбора", async () => {
  await withMaterials(async (url, path) => {
    const object = await createObject(url);
    const endpoint = `${url}/api/objects/${object.id}/materials`;
    const p = await product(url, "АРТ-АБВ");
    const item = { productId: p.id, quantity: 3, expectedUnit: p.unit };
    for (const draft of [
      { baseVersionId: null, items: [{ ...item, priceRub: 1 }] },
      { baseVersionId: null, items: [item, item] },
      { baseVersionId: null, items: [{ ...item, quantity: 0 }] },
      { baseVersionId: null, items: [{ ...item, productId: "missing" }] },
    ]) assert.equal((await post(endpoint, draft)).status, 400);
    assert.equal((await (await fetch(endpoint)).json()).versions.length, 0);
    const first = await (await post(endpoint, { baseVersionId: null, items: [item] })).json();
    assert.equal((await post(endpoint, { baseVersionId: null, items: [item] })).status, 409);
    const catalog = new SqliteCatalogRepository(path);
    const changed = searchCatalogFixture();
    changed.products[0]!.unit = "упаковка";
    try { catalog.saveImport(changed, "changed.xlsx"); } finally { catalog.close(); }
    assert.equal((await post(endpoint, { baseVersionId: first.id, items: [item] })).status, 409);
    assert.equal((await (await fetch(endpoint)).json()).versions.length, 1);
    assert.deepEqual(await (await fetch(`${endpoint}/${first.id}`)).json(), first);
  });
});

test("материалы изолированы по объекту и организации; неизвестный объект не получает версию", async () => {
  await withMaterials(async (url, path) => {
    const a = await createObject(url);
    const b = await createObject(url);
    const saved = await (await post(`${url}/api/objects/${a.id}/materials`, { baseVersionId: null, items: [] })).json();
    assert.equal((await fetch(`${url}/api/objects/${b.id}/materials/${saved.id}`)).status, 404);
    assert.equal((await post(`${url}/api/objects/missing/materials`, { baseVersionId: null, items: [] })).status, 404);
    const db = new DatabaseSync(path);
    try {
      db.prepare("INSERT INTO organizations VALUES (?, ?)").run("other", "Другие");
      db.prepare("UPDATE client_objects SET organization_id = 'other' WHERE id = ?").run(a.id);
      const p = db.prepare("SELECT id FROM catalog_products LIMIT 1").get() as { id: string };
      db.prepare("INSERT INTO catalog_imports (id, organization_id, imported_at, report_json) VALUES ('other-import', 'other', '2026-01-01', '{}')").run();
      db.prepare("UPDATE catalog_products SET organization_id = 'other', last_import_id = 'other-import' WHERE id = ?").run(p.id);
      assert.equal((await post(`${url}/api/objects/${b.id}/materials`, { baseVersionId: null, items: [{ productId: p.id, quantity: 1, expectedUnit: "шт" }] })).status, 400);
    } finally { db.close(); }
    assert.equal((await fetch(`${url}/api/objects/${a.id}/materials`)).status, 404);
    assert.equal((await fetch(`${url}/api/objects/${a.id}/materials/${saved.id}`)).status, 404);
  });
});

test("ресурс выбора материалов доступен, переполнение суммы не сохраняет версию", async () => {
  await withMaterials(async (url, path) => {
    const script = await fetch(`${url}/materials.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get("content-type") ?? "", /javascript/);
    const html = await (await fetch(`${url}/catalog`)).text();
    assert.match(html, /id="materials-panel"/);
    assert.match(html, /При каждом сохранении все цены берутся заново/);
    const object = await createObject(url);
    const changed = searchCatalogFixture();
    changed.products.slice(0, 3).forEach((p) => { p.priceRub = 1e13; });
    const catalog = new SqliteCatalogRepository(path);
    let items;
    try {
      catalog.saveImport(changed, "large-prices.xlsx");
      items = changed.products.slice(0, 3).map((p) => ({ productId: catalog.getProduct(p.url)!.id, quantity: 4, expectedUnit: p.unit }));
    } finally { catalog.close(); }
    const endpoint = `${url}/api/objects/${object.id}/materials`;
    const response = await post(endpoint, { baseVersionId: null, items });
    assert.equal(response.status, 400);
    assert.match(JSON.stringify(await response.json()), /диапазон/);
    assert.equal((await (await fetch(endpoint)).json()).versions.length, 0);
  });
});

test("ошибка SQLite при сохранении не меняет последнюю версию", async () => {
  await withMaterials(async (url, path) => {
    const object = await createObject(url);
    const endpoint = `${url}/api/objects/${object.id}/materials`;
    const first = await (await post(endpoint, { baseVersionId: null, items: [] })).json();
    const db = new DatabaseSync(path);
    try { db.exec("CREATE TRIGGER fail_materials BEFORE INSERT ON object_material_versions BEGIN SELECT RAISE(ABORT, 'test failure'); END"); }
    finally { db.close(); }
    assert.equal((await post(endpoint, { baseVersionId: first.id, items: [] })).status, 500);
    const collection = await (await fetch(endpoint)).json();
    assert.equal(collection.versions.length, 1);
    assert.deepEqual(collection.latest, first);
  });
});
