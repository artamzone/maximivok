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
import { SqliteProjectRepository } from "../src/storage.js";
import { searchCatalogFixture } from "./fixtures/catalog-search.js";

async function withCatalog(run: (baseUrl: string, databasePath: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "ivok-catalog-http-"));
  const databasePath = join(directory, "ivok.sqlite");
  const server = createWebServer({ databasePath });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, databasePath);
  } finally {
    server.close();
    await once(server, "close");
    await rm(directory, { recursive: true, force: true });
  }
}

test("страница каталога и её ресурсы доступны, ссылка не заменяет несохранённую карточку", async () => {
  await withCatalog(async (url) => {
    const home = await (await fetch(url)).text();
    assert.match(home, /href="\/catalog" target="_blank" rel="noopener noreferrer"/);
    for (const [path, type] of [["/catalog", "text/html"], ["/catalog.js", "text/javascript"], ["/styles.css", "text/css"], ["/app.js", "text/javascript"]]) {
      const response = await fetch(`${url}${path}`);
      assert.equal(response.status, 200, path);
      assert.ok(response.headers.get("content-type")?.includes(type ?? ""));
    }
    const html = await (await fetch(`${url}/catalog`)).text();
    assert.match(html, /id="catalog-query"/);
    assert.match(html, /id="catalog-category"/);
    assert.match(html, /role="status"/);
    assert.match(html, /role="alert"/);
    const calculate = await fetch(`${url}/api/calculate`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    assert.equal(calculate.status, 200);
    assert.equal((await calculate.json()).status, "impossible");
  });
});

test("поиск не возвращает товары другой организации", async () => {
  await withCatalog(async (url, databasePath) => {
    seed(databasePath);
    const database = new DatabaseSync(databasePath);
    try {
      database.exec(`
        INSERT INTO organizations VALUES ('other-org', 'Другая организация');
        INSERT INTO catalog_imports (id, organization_id, imported_at, report_json)
          VALUES ('other-import', 'other-org', '2026-01-01T00:00:00Z', '{}');
        INSERT INTO catalog_products
          (id, organization_id, source, source_url, category, name, article, price_rub, unit, updated_at, last_import_id)
          VALUES ('other-product', 'other-org', 'san-baza.ru', 'https://san-baza.ru/catalog/test/0/',
            'Другая категория', 'Чужой товар', 'private', 123, 'шт', '2026-01-01T00:00:00Z', 'other-import');
      `);
    } finally {
      database.close();
    }
    const all = await (await fetch(`${url}/api/catalog`)).json();
    assert.equal(all.catalogTotal, 55);
    assert.ok(!all.categories.includes("Другая категория"));
    const result = await (await fetch(`${url}/api/catalog?query=private`)).json();
    assert.equal(result.total, 0);
  });
});

test("внедрённое хранилище карточек не подключает каталог из посторонней БД", async () => {
  const repository = new SqliteProjectRepository(":memory:");
  const server = createWebServer({ repository });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    assert.equal((await fetch(`${url}/api/catalog`)).status, 503);
    assert.equal((await fetch(`${url}/api/objects`)).status, 200);
  } finally {
    server.close();
    await once(server, "close");
    assert.deepEqual(repository.listObjects(), []);
    repository.close();
  }
});

function seed(databasePath: string): void {
  const repository = new SqliteCatalogRepository(databasePath);
  try {
    repository.saveImport(searchCatalogFixture(), "synthetic.xlsx");
  } finally {
    repository.close();
  }
}

test("каталог до импорта пуст, просмотр не создаёт таблицы; импорт виден без перезапуска сервера", async () => {
  await withCatalog(async (url, databasePath) => {
    const response = await fetch(`${url}/api/catalog`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      products: [], total: 0, catalogTotal: 0, categories: [], page: 1, pageSize: 50, latestImportAt: null,
    });
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE name = 'catalog_products'").get(), undefined);
    } finally {
      database.close();
    }
    seed(databasePath);
    const populated = await (await fetch(`${url}/api/catalog`)).json();
    assert.equal(populated.catalogTotal, 55);
    assert.equal(populated.products.length, 50);
  });
});

test("поиск по названию/артикулу учитывает кириллицу, категория точная, символы SQL буквальные", async () => {
  await withCatalog(async (url, databasePath) => {
    seed(databasePath);
    const query = async (params: Record<string, string>) => {
      const response = await fetch(`${url}/api/catalog?${new URLSearchParams(params)}`);
      assert.equal(response.status, 200);
      return response.json();
    };
    for (const value of ["тРуБа", "арт-абв", "100%_", "  труба  "]) {
      const result = await query({ query: value });
      assert.equal(result.total, 1);
      assert.equal(result.products[0].article, "АРТ-АБВ");
    }
    assert.equal((await query({ query: "%' OR 1=1 --" })).total, 0);
    assert.equal((await query({ category: "Отопление" })).total, 28);
    assert.equal((await query({ category: "Отопление", query: "радиатор" })).total, 27);
    assert.equal((await query({ category: "Отоп" })).total, 0);
    const missing = await query({ query: "нет такого товара" });
    assert.equal(missing.total, 0);
    assert.equal(missing.catalogTotal, 55);
    assert.deepEqual(new Set(missing.categories), new Set(["Отопление", "Котлы"]));
    const prices = await query({});
    assert.equal(prices.products.find((p: { article: string | null }) => p.article === null).priceRub, null);
    assert.equal(prices.products.find((p: { article: string | null }) => p.article === "R-2").priceRub, 0);
  });
});

test("страницы стабильны и не пересекаются; некорректные параметры дают 400", async () => {
  await withCatalog(async (url, databasePath) => {
    seed(databasePath);
    const first = await (await fetch(`${url}/api/catalog`)).json();
    const second = await (await fetch(`${url}/api/catalog?page=2`)).json();
    assert.equal(first.products.length, 50);
    assert.equal(second.products.length, 5);
    assert.equal(second.total, 55);
    assert.equal(second.page, 2);
    const ids = [...first.products, ...second.products].map((p: { id: string }) => p.id);
    assert.equal(new Set(ids).size, 55);
    assert.deepEqual(await (await fetch(`${url}/api/catalog`)).json(), first);
    assert.equal((await (await fetch(`${url}/api/catalog?page=3`)).json()).products.length, 0);
    for (const params of ["page=0", "page=-1", "page=1.5", "page=abc", "page=1e2", "page=9007199254740991", "page=1&page=2", "query=a&query=b", "limit=5000", `query=${"x".repeat(201)}`, `category=${"x".repeat(1001)}`]) {
      const response = await fetch(`${url}/api/catalog?${params}`);
      assert.equal(response.status, 400, params);
      assert.ok((await response.json()).issues.length > 0);
    }
    assert.equal((await fetch(`${url}/api/catalog`, { method: "POST" })).status, 404);
  });
});

test("latestImportAt: null до импорта, ISO-строка после, обновляется при повторном импорте", async () => {
  await withCatalog(async (url, databasePath) => {
    const before = await (await fetch(`${url}/api/catalog`)).json();
    assert.equal(before.latestImportAt, null);
    const firstRepository = new SqliteCatalogRepository(databasePath);
    try { firstRepository.saveImport(searchCatalogFixture(), "first.xlsx"); }
    finally { firstRepository.close(); }
    const firstAt = (await (await fetch(`${url}/api/catalog`)).json()).latestImportAt;
    assert.ok(typeof firstAt === "string" && !Number.isNaN(new Date(firstAt).getTime()), firstAt);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const secondRepository = new SqliteCatalogRepository(databasePath);
    try { secondRepository.saveImport(searchCatalogFixture(), "second.xlsx"); }
    finally { secondRepository.close(); }
    const secondAt = (await (await fetch(`${url}/api/catalog`)).json()).latestImportAt;
    assert.ok(typeof secondAt === "string");
    assert.ok(new Date(secondAt).getTime() >= new Date(firstAt).getTime());
  });
});
