import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createWebServer } from "../src/server.js";
import { SqliteProjectRepository } from "../src/storage.js";
import { calculateHeating } from "../src/calculator.js";
import { parseHeatingInput } from "../src/validation.js";

async function withWorks(run: (url: string, path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "ivok-works-"));
  const path = join(dir, "test.sqlite");
  const server = createWebServer({ databasePath: path });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, path);
  } finally {
    server.close(); await once(server, "close");
    await rm(dir, { recursive: true, force: true });
  }
}

const send = (url: string, value: unknown, method = "POST") => fetch(url, {
  method, headers: { "content-type": "application/json" }, body: JSON.stringify(value),
});

test("сохранение цен атомарно, устаревшая вкладка не перезаписывает справочник", async () => {
  await withWorks(async (url) => {
    const initial = await (await fetch(`${url}/api/works`)).json();
    const prices = initial.items.map((x: { id: string; priceRub: number }) => ({ id: x.id, priceRub: x.priceRub + 0.25 }));
    const draft = { baseRevision: 0, prices };
    const saved = await send(`${url}/api/works`, draft, "PUT");
    assert.equal(saved.status, 200);
    const current = await saved.json();
    assert.equal(current.revision, 1);
    assert.equal(current.items[0].priceRub, 900.25);
    assert.equal((await send(`${url}/api/works`, draft, "PUT")).status, 409);
    for (const bad of [
      { baseRevision: 1, prices: [] },
      { baseRevision: 1, prices: prices.map((p: unknown) => ({ ...(p as object), priceRub: -1 })) },
      { baseRevision: 1, prices: prices.map((p: unknown) => ({ ...(p as object), priceRub: 1.001 })) },
      { baseRevision: 1, prices: prices.map((p: unknown) => ({ ...(p as object), priceRub: null })) },
      { baseRevision: 1, prices: [prices[0], prices[0], ...prices.slice(2)] },
      { baseRevision: 1, prices, name: "Не менять имена" },
      { baseRevision: 1, prices: prices.map((p: unknown) => ({ ...(p as object), id: "unknown" })) },
      { baseRevision: 1, prices: prices.map((p: unknown) => ({ ...(p as object), priceRub: "123" })) },
      { baseRevision: 1, prices: prices.map((p: unknown) => ({ ...(p as object), priceRub: 1e20 })) },
    ]) assert.equal((await send(`${url}/api/works`, bad, "PUT")).status, 400);
    assert.deepEqual(await (await fetch(`${url}/api/works`)).json(), current);
  });
});

const heatingInput = {
  houseAreaM2: 20, heatSource: "gas", includeIndirectWaterHeater: false,
  rooms: [{ id: "r1", name: "Комната", areaM2: 10, floorHeatingAreaM2: 2.5,
    ceilingHeightM: 2.8, hasStandardWindows: true, hasPanoramicWindows: false, hasRadiator: false }],
};

test("все новые веб-расчёты используют сохранённые цены, старый отчёт не меняется", async () => {
  await withWorks(async (url) => {
    const create = { client: { name: "Тест" }, object: { address: "Адрес" }, calculation: { input: heatingInput, parameterMetadata: [] } };
    const firstResponse = await send(`${url}/api/objects`, create);
    assert.equal(firstResponse.status, 201);
    const first = await firstResponse.json();
    const oldReport = first.calculations[0].report;
    assert.equal(oldReport.floorHeating.installationCostRub, 2250);
    const initial = await (await fetch(`${url}/api/works`)).json();
    const prices = initial.items.map((x: { id: string; priceRub: number }) => ({ id: x.id, priceRub: x.id === "floor_heating" ? 2.5 : x.id === "insulation" ? 1.25 : x.priceRub }));
    assert.equal((await send(`${url}/api/works`, { baseRevision: 0, prices }, "PUT")).status, 200);
    const preview = await (await send(`${url}/api/calculate`, heatingInput)).json();
    assert.equal(preview.floorHeating.installationCostRub, 6.25);
    assert.equal(preview.floorHeating.insulationInstallationCostRub, 3.13);
    assert.deepEqual(preview.workPrices, { revision: 1, floorHeatingRubPerM2: 2.5, insulationRubPerM2: 1.25 });
    assert.ok(preview.appliedRules.some((r: { code: string; description: string }) => r.code === "FH_INSTALLATION_PRICE" && r.description.includes("2.5")));
    const next = await (await send(`${url}/api/objects/${first.id}/calculations`, { input: heatingInput, parameterMetadata: [] })).json();
    assert.deepEqual(next.report, preview);
    const another = await (await send(`${url}/api/objects`, create)).json();
    assert.deepEqual(another.calculations[0].report, preview);
    const history = await (await fetch(`${url}/api/objects/${first.id}`)).json();
    assert.deepEqual(history.calculations.find((c: { id: string }) => c.id === first.calculations[0].id).report, oldReport);
    const partial = await (await send(`${url}/api/calculate`, { ...heatingInput, circuitLengthM: null })).json();
    assert.equal(partial.floorHeating.installationCostRub, 6.25);
    assert.equal(partial.floorHeating.status, "impossible");
    assert.deepEqual(await (await send(`${url}/api/calculate`, heatingInput)).json(), preview);
  });
});

test("цены сохраняются между подключениями, одинаковое сохранение не создаёт версию, параллельная запись защищена", async () => {
  await withWorks(async (url, path) => {
    const initial = await (await fetch(`${url}/api/works`)).json();
    const prices = initial.items.map((x: { id: string; priceRub: number }) => ({ id: x.id, priceRub: x.priceRub + 1 }));
    const results = await Promise.all([1, 2].map(() => send(`${url}/api/works`, { baseRevision: 0, prices }, "PUT")));
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    const saved = await (await fetch(`${url}/api/works`)).json();
    assert.deepEqual(await (await send(`${url}/api/works`, { baseRevision: 1, prices }, "PUT")).json(), saved);
    const reopened = new SqliteProjectRepository(path);
    try { assert.deepEqual(reopened.works.getCatalog(), saved); }
    finally { reopened.close(); }
    const db = new DatabaseSync(path);
    try {
      db.prepare("INSERT INTO organizations (id, name) VALUES (?, ?)").run("foreign", "Другая организация");
      db.prepare("INSERT INTO work_price_versions (organization_id, revision, prices_json, created_at) VALUES (?, ?, ?, ?)")
        .run("foreign", 999, JSON.stringify(prices.map((p: { id: string }) => ({ id: p.id, priceRub: 1 }))), new Date().toISOString());
      assert.deepEqual(await (await fetch(`${url}/api/works`)).json(), saved);
      db.exec("CREATE TRIGGER reject_work_prices BEFORE INSERT ON work_price_versions BEGIN SELECT RAISE(ABORT, 'test failure'); END");
      const failure = await send(`${url}/api/works`, { baseRevision: 1, prices: prices.map((p: { id: string; priceRub: number }) => ({ ...p, priceRub: p.priceRub + 1 })) }, "PUT");
      assert.equal(failure.status, 500);
      assert.deepEqual(await (await fetch(`${url}/api/works`)).json(), saved);
    } finally { db.close(); }
  });
});

test("нулевая цена требует проверки, снимок воспроизводим и не связан с изменяемым объектом настроек", () => {
  const input = parseHeatingInput(heatingInput);
  const prices = { revision: 2, floorHeatingRubPerM2: 0, insulationRubPerM2: 1.25 };
  const report = calculateHeating(input, prices);
  assert.equal(report.floorHeating.installationCostRub, 0);
  assert.equal(report.floorHeating.status, "requires_engineer_review");
  assert.ok(report.warnings.some((warning) => warning.code === "WORK_ZERO_PRICE_REVIEW"));
  assert.equal(JSON.stringify(report), JSON.stringify(calculateHeating(input, prices)));
  prices.floorHeatingRubPerM2 = 999;
  assert.equal(report.workPrices?.floorHeatingRubPerM2, 0);
  const empty = calculateHeating(parseHeatingInput({ ...heatingInput, rooms: [{ ...heatingInput.rooms[0], floorHeatingAreaM2: 0 }] }), prices);
  assert.equal(empty.floorHeating.installationCostRub, 0);
  assert.equal(calculateHeating(parseHeatingInput({}), prices).floorHeating.installationCostRub, null);
  assert.throws(() => calculateHeating(input, { ...prices, floorHeatingRubPerM2: Number.MAX_VALUE }), /диапазон/);
});

test("страница работ открывается отдельно; сервер не принимает цены из входа расчёта", async () => {
  await withWorks(async (url) => {
    for (const path of ["/", "/app.js", "/styles.css", "/works", "/works.js"]) {
      const response = await fetch(`${url}${path}`);
      assert.equal(response.status, 200);
      const text = await response.text();
      if (path === "/") assert.match(text, /href="\/works" target="_blank" rel="noopener noreferrer"/);
    }
    const input = { ...heatingInput, workPrices: { revision: 999, floorHeatingRubPerM2: 1, insulationRubPerM2: 1 } };
    const response = await send(`${url}/api/calculate`, input);
    // Extra input fields cannot override the server snapshot (the boundary may reject or ignore them).
    if (response.status === 200) {
      const report = await response.json();
      assert.equal(report.floorHeating.installationCostRub, 2250);
      assert.equal(report.workPrices.revision, 0);
    } else assert.equal(response.status, 400);
  });
});

test("справочник содержит пять работ ТЗ; чтение не создаёт таблицу цен", async () => {
  await withWorks(async (url, path) => {
    const response = await fetch(`${url}/api/works`);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.revision, 0);
    assert.deepEqual(data.items.map((x: { priceRub: number }) => x.priceRub), [900, 100, 2900, 2500, 12000]);
    assert.equal(data.items.length, 5);
    const db = new DatabaseSync(path, { readOnly: true });
    try { assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='work_price_versions'").get(), undefined); }
    finally { db.close(); }
  });
});
