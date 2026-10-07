import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { previewSanBazaCatalog } from "../src/catalog-import.js";

const fixture = (name: string): string => resolve("test/fixtures", name);

test("предпросмотр XLSX читает товары, сохраняет артикул и исходные единицы", async () => {
  const preview = await previewSanBazaCatalog(fixture("catalog-valid.xlsx"));
  assert.equal(preview.source, "san-baza.ru");
  assert.equal(preview.rowCount, 2);
  assert.equal(preview.products.length, 2);
  assert.deepEqual(preview.issues, []);
  assert.equal(preview.missingArticleCount, 1);
  assert.deepEqual(preview.products[0], {
    row: 5,
    category: "Тестовая категория",
    name: "Тестовый товар A",
    article: "001",
    priceRub: 2.5,
    unit: "м.п.",
    url: "https://san-baza.ru/catalog/test/1/",
  });
  assert.equal(preview.products[1]?.row, 7);
  assert.equal(preview.products[1]?.article, null);
});

test("ошибки содержат исходные номера строк; конфликтующие URL не выбираются автоматически", async () => {
  const preview = await previewSanBazaCatalog(fixture("catalog-invalid.xlsx"));
  assert.equal(preview.rowCount, 7);
  assert.equal(preview.products.length, 0);
  assert.deepEqual(preview.issues.map(({ row, column, code }) => ({ row, column, code })), [
    { row: 5, column: "F", code: "DUPLICATE_URL" },
    { row: 6, column: "B", code: "REQUIRED_TEXT" },
    { row: 6, column: "D", code: "INVALID_PRICE" },
    { row: 7, column: "D", code: "INVALID_PRICE" },
    { row: 8, column: "F", code: "INVALID_URL" },
    { row: 9, column: "F", code: "DUPLICATE_URL" },
    { row: 10, column: "C", code: "INVALID_ARTICLE" },
    { row: 11, column: "E", code: "REQUIRED_TEXT" },
  ]);
});

test("отсутствующая цена остаётся null, нулевая — нулём, одинаковые артикулы допустимы", async () => {
  const preview = await previewSanBazaCatalog(fixture("catalog-unknown.xlsx"));
  assert.deepEqual(preview.issues, []);
  assert.deepEqual(preview.products.map((product) => product.priceRub), [null, 0]);
  assert.deepEqual(preview.products.map((product) => product.article), ["same", "same"]);
  assert.equal(preview.missingPriceCount, 1);
  assert.equal(preview.zeroPriceCount, 1);
  assert.equal(preview.repeatedArticleCount, 1);
});

test("предпросмотр не принимает другой заголовок или пустой каталог", async () => {
  await assert.rejects(previewSanBazaCatalog(fixture("catalog-header.xlsx")), /строке 4/);
  await assert.rejects(previewSanBazaCatalog(fixture("catalog-empty.xlsx")), /нет товаров/);
});

test("нужен лист Каталог и читаемый XLSX", async () => {
  await assert.rejects(previewSanBazaCatalog(fixture("catalog-sheet.xlsx")), /Каталог/);
  await assert.rejects(previewSanBazaCatalog(resolve("package.json")), /XLSX/);
  await assert.rejects(previewSanBazaCatalog(fixture("does-not-exist.xlsx")), /ENOENT/);
});

test("CLI выдаёт сводку без записи файлов и отличает ошибки строк от ошибок чтения", (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "ivok-catalog-preview-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const cli = resolve("dist/src/catalog-cli.js");
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
  const success = run(fixture("catalog-valid.xlsx"));
  assert.equal(success.status, 0, success.stderr);
  const report = JSON.parse(success.stdout);
  assert.equal(report.rowCount, 2);
  assert.equal(report.validRowCount, 2);
  assert.equal(report.missingArticleCount, 1);
  assert.equal(report.formatValid, true);
  assert.equal(report.products, undefined);
  const invalid = run(fixture("catalog-invalid.xlsx"));
  assert.equal(invalid.status, 2, invalid.stderr);
  assert.equal(JSON.parse(invalid.stdout).formatValid, false);
  assert.equal(JSON.parse(invalid.stdout).issues.length, 8);
  const missing = run(fixture("does-not-exist.xlsx"));
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /ENOENT/);
  const wrongFormat = run(fixture("catalog-header.xlsx"));
  assert.equal(wrongFormat.status, 2);
  assert.match(wrongFormat.stderr, /строке 4/);
  const noArgs = run();
  assert.equal(noArgs.status, 2);
  assert.match(noArgs.stderr, /catalog:check/);
  assert.equal(run(fixture("catalog-valid.xlsx"), "extra").status, 2);
  assert.deepEqual(readdirSync(cwd), []);
});
