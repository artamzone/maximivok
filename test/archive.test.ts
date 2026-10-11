import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createWebServer } from "../src/server.js";

async function withServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = createWebServer({ databasePath: ":memory:" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

function requestJson(
  baseUrl: string,
  pathname: string,
  method: string,
  body?: unknown,
): Promise<{ status: number; data: { id?: string; archivedAt?: string | null; error?: string; objects?: Array<{ id: string; archivedAt: string | null }> } }> {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const payload = body === undefined ? "" : JSON.stringify(body);
    const req = httpRequest({
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {},
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let data: { id?: string; archivedAt?: string | null; error?: string; objects?: Array<{ id: string; archivedAt: string | null }> } = {};
        if (text) { try { data = JSON.parse(text); } catch { /* leave empty */ } }
        resolve({ status: res.statusCode ?? 0, data });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function createObject(baseUrl: string, name: string): Promise<string> {
  const result = await requestJson(baseUrl, "/api/objects", "POST", {
    client: { name, phone: null, email: null, notes: null },
    object: { address: "Архивный 1", name: "test", notes: null },
  });
  assert.equal(result.status, 201);
  assert.ok(result.data.id);
  return result.data.id!;
}

test("архив: POST /api/objects/:id/archive ставит archivedAt", async () => {
  await withServer(async (base) => {
    const id = await createObject(base, "Архив-1");
    const archive = await requestJson(base, `/api/objects/${id}/archive`, "POST");
    assert.equal(archive.status, 200);
    assert.ok(archive.data.archivedAt, "archivedAt должен быть установлен");
  });
});

test("архив: GET /api/objects по умолчанию скрывает архивные карточки", async () => {
  await withServer(async (base) => {
    const id = await createObject(base, "Архив-2");
    await requestJson(base, `/api/objects/${id}/archive`, "POST");
    const list = await requestJson(base, "/api/objects", "GET");
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.data.objects));
    const visible = (list.data.objects ?? []).some((o) => o.id === id);
    assert.equal(visible, false, "архивная карточка не должна быть в дефолтном списке");
  });
});

test("архив: GET /api/objects?includeArchived=true показывает архивные", async () => {
  await withServer(async (base) => {
    const id = await createObject(base, "Архив-3");
    await requestJson(base, `/api/objects/${id}/archive`, "POST");
    const list = await requestJson(base, "/api/objects?includeArchived=true", "GET");
    assert.equal(list.status, 200);
    const found = (list.data.objects ?? []).find((o) => o.id === id);
    assert.ok(found, "архивная карточка должна быть в списке с includeArchived=true");
    assert.ok(found!.archivedAt, "archivedAt заполнен");
  });
});

test("архив: POST /api/objects/:id/restore снимает archivedAt", async () => {
  await withServer(async (base) => {
    const id = await createObject(base, "Архив-4");
    await requestJson(base, `/api/objects/${id}/archive`, "POST");
    const restore = await requestJson(base, `/api/objects/${id}/restore`, "POST");
    assert.equal(restore.status, 200);
    assert.equal(restore.data.archivedAt, null, "после восстановления archivedAt = null");
    // И снова появляется в дефолтном списке.
    const list = await requestJson(base, "/api/objects", "GET");
    const visible = (list.data.objects ?? []).some((o) => o.id === id);
    assert.equal(visible, true, "восстановленная карточка видна в дефолтном списке");
  });
});

test("архив: запись нового расчёта в архивную карточку возвращает 409", async () => {
  await withServer(async (base) => {
    const id = await createObject(base, "Архив-5");
    await requestJson(base, `/api/objects/${id}/archive`, "POST");
    // heating-расчёт через /api/objects/:id/calculations
    const save = await requestJson(base, `/api/objects/${id}/calculations`, "POST", {
      input: {
        totalAreaM2: 100,
        ceilingHeightM: 2.8,
        useHouseCeilingHeight: false,
        standardWindowCount: 2,
        panoramicWindowCount: 0,
        hasStandardWindows: true,
        hasPanoramicWindows: false,
        rooms: [{ id: "r1", name: "Комната 1", areaM2: 30, ceilingHeightM: 2.8, useHouseCeilingHeight: false, standardWindowCount: 1, panoramicWindowCount: 0, hasStandardWindows: true, hasPanoramicWindows: false, floorHeatingAreaM2: 25, hasRadiator: true }],
        floors: 1,
        hotWaterSource: "two_loop_boiler",
        boilerRoomAreaM2: 0,
        hasAttic: false,
        hasBasement: false,
        heatSource: "gas",
        hasRecirculation: false,
      },
      parameterMetadata: [],
    });
    assert.equal(save.status, 409, "сохранение расчёта в архивную карточку = 409");
  });
});

test("архив: PATCH карточки в архиве возвращает 409", async () => {
  await withServer(async (base) => {
    const id = await createObject(base, "Архив-6");
    await requestJson(base, `/api/objects/${id}/archive`, "POST");
    const patch = await requestJson(base, `/api/objects/${id}`, "PATCH", {
      client: { name: "Новый", phone: null, email: null, notes: null },
      object: { address: "Другая", name: null, notes: null },
    });
    assert.equal(patch.status, 409, "редактирование архивной карточки = 409");
  });
});

test("архив: восстановленная карточка снова принимает расчёты", async () => {
  await withServer(async (base) => {
    const id = await createObject(base, "Архив-7");
    await requestJson(base, `/api/objects/${id}/archive`, "POST");
    await requestJson(base, `/api/objects/${id}/restore`, "POST");
    const save = await requestJson(base, `/api/objects/${id}/calculations`, "POST", {
      input: {
        totalAreaM2: 100,
        ceilingHeightM: 2.8,
        useHouseCeilingHeight: false,
        standardWindowCount: 2,
        panoramicWindowCount: 0,
        hasStandardWindows: true,
        hasPanoramicWindows: false,
        rooms: [{ id: "r1", name: "Комната 1", areaM2: 30, ceilingHeightM: 2.8, useHouseCeilingHeight: false, standardWindowCount: 1, panoramicWindowCount: 0, hasStandardWindows: true, hasPanoramicWindows: false, floorHeatingAreaM2: 25, hasRadiator: true }],
        floors: 1,
        hotWaterSource: "two_loop_boiler",
        boilerRoomAreaM2: 0,
        hasAttic: false,
        hasBasement: false,
        heatSource: "gas",
        hasRecirculation: false,
      },
      parameterMetadata: [],
    });
    assert.equal(save.status, 201, "после восстановления расчёт сохраняется");
  });
});

test("архив: 404 для несуществующего объекта", async () => {
  await withServer(async (base) => {
    const result = await requestJson(base, "/api/objects/00000000-0000-0000-0000-000000000000/archive", "POST");
    assert.equal(result.status, 404);
  });
});
