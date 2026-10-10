import assert from "node:assert/strict";
import { once } from "node:events";
import { get as httpGet, request as httpRequest } from "node:http";
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
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const payload = body === undefined ? "" : JSON.stringify(body);
    const req = httpRequest(
      {
        method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        headers: payload === ""
          ? undefined
          : { "content-type": "application/json", "content-length": Buffer.byteLength(payload) },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let data: unknown = text;
          if (text.length > 0) {
            try { data = JSON.parse(text); } catch { /* keep raw */ }
          }
          resolve({ status: response.statusCode ?? 0, data });
        });
      },
    );
    req.on("error", reject);
    if (payload !== "") req.write(payload);
    req.end();
  });
}

function getJson(baseUrl: string, pathname: string): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    httpGet(new URL(pathname, baseUrl), (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let data: unknown = text;
        if (text.length > 0) {
          try { data = JSON.parse(text); } catch { /* keep raw */ }
        }
        resolve({ status: response.statusCode ?? 0, data });
      });
    }).on("error", reject);
  });
}

function plumbingInput(): Record<string, unknown> {
  return {
    rooms: [
      {
        roomId: "bath-1",
        fixtures: [
          { type: "bath", count: 1 },
          { type: "sink", count: 1 },
          { type: "toilet", count: 1 },
        ],
        hasRecirculation: false,
      },
    ],
    hotWaterSource: "two_loop_boiler",
  };
}

async function createObject(baseUrl: string): Promise<string> {
  const response = await requestJson(baseUrl, "/api/objects", "POST", {
    client: { name: "Иванов", phone: null, email: null, notes: null },
    object: { address: "Лесная 1", name: null, notes: null },
  });
  assert.equal(response.status, 201);
  const data = response.data as { id: string };
  return data.id;
}

test("POST /api/plumbing возвращает отчёт без сохранения", async () => {
  await withServer(async (baseUrl) => {
    const response = await requestJson(baseUrl, "/api/plumbing", "POST", plumbingInput());
    assert.equal(response.status, 200);
    const data = response.data as { status: string; coldWaterPoints: number; hotWaterPoints: number; costStatus: string };
    assert.equal(data.status, "calculated");
    assert.equal(data.coldWaterPoints, 3);
    assert.equal(data.hotWaterPoints, 2);
    assert.equal(data.costStatus, "calculated");
  });
});

test("POST /api/plumbing отклоняет невалидный вход", async () => {
  await withServer(async (baseUrl) => {
    const response = await requestJson(baseUrl, "/api/plumbing", "POST", { rooms: "not an array", hotWaterSource: "two_loop_boiler" });
    assert.equal(response.status, 400);
  });
});

test("POST /api/objects/:id/plumbing сохраняет версию с привязкой снимка цен", async () => {
  await withServer(async (baseUrl) => {
    const objectId = await createObject(baseUrl);
    const response = await requestJson(baseUrl, `/api/objects/${objectId}/plumbing`, "POST", {
      input: plumbingInput(),
      parameterMetadata: [],
      workPrices: { baseRevision: 0, revision: 0, waterHotPointRub: 2000, recirculationPerMeterRub: 1000, trapInstallRub: 2000, markupPercent: 45 },
    });
    assert.equal(response.status, 201);
    const data = response.data as { block: string; workPrices: { revision: number; waterHotPointRub: number } };
    assert.equal(data.block, "plumbing");
    assert.equal(data.workPrices.revision, 0);
    assert.equal(data.workPrices.waterHotPointRub, 2000);
  });
});

test("GET /api/objects/:id возвращает plumbingCalculations", async () => {
  await withServer(async (baseUrl) => {
    const objectId = await createObject(baseUrl);
    const draft = {
      input: plumbingInput(),
      parameterMetadata: [],
      workPrices: { baseRevision: 0, revision: 0, waterHotPointRub: 2000, recirculationPerMeterRub: 1000, trapInstallRub: 2000, markupPercent: 45 },
    };
    const save = await requestJson(baseUrl, `/api/objects/${objectId}/plumbing`, "POST", draft);
    assert.equal(save.status, 201);
    const read = await getJson(baseUrl, `/api/objects/${objectId}`);
    assert.equal(read.status, 200);
    const data = read.data as { calculations: unknown[]; plumbingCalculations: Array<{ block: string }> };
    assert.equal(data.calculations.length, 0);
    assert.equal(data.plumbingCalculations.length, 1);
    assert.equal(data.plumbingCalculations[0]!.block, "plumbing");
  });
});

test("POST /api/objects/:id/plumbing возвращает 404 для несуществующего объекта", async () => {
  await withServer(async (baseUrl) => {
    const response = await requestJson(baseUrl, "/api/objects/does-not-exist/plumbing", "POST", {
      input: plumbingInput(),
      parameterMetadata: [],
      workPrices: { baseRevision: 0, revision: 0, waterHotPointRub: 2000, recirculationPerMeterRub: 1000, trapInstallRub: 2000, markupPercent: 45 },
    });
    assert.equal(response.status, 404);
  });
});

test("POST /api/objects/:id/plumbing возвращает 409 при устаревшем baseRevision", async () => {
  await withServer(async (baseUrl) => {
    const objectId = await createObject(baseUrl);
    // revision=0 совпадает с пустой БД, первый POST пройдёт, но baseRevision=5 — нет
    const response = await requestJson(baseUrl, `/api/objects/${objectId}/plumbing`, "POST", {
      input: plumbingInput(),
      parameterMetadata: [],
      workPrices: { baseRevision: 5, revision: 0, waterHotPointRub: 2000, recirculationPerMeterRub: 1000, trapInstallRub: 2000, markupPercent: 45 },
    });
    assert.equal(response.status, 409);
  });
});

test("сохранение plumbing не затирает старые heating-расчёты", async () => {
  await withServer(async (baseUrl) => {
    const objectId = await createObject(baseUrl);
    const heating = await requestJson(baseUrl, `/api/objects/${objectId}/calculations`, "POST", {
      input: {
        houseAreaM2: 60,
        heatSource: "gas",
        rooms: [
          { id: "r1", name: "r", areaM2: 30, ceilingHeightM: 2.6, hasStandardWindows: true, hasPanoramicWindows: false, floorHeatingAreaM2: 20, hasRadiator: false },
        ],
        availableElectricPowerKw: null,
        residents: 2,
        baths: 1,
        showers: 1,
        includeIndirectWaterHeater: false,
        circuitLengthM: 80,
      },
      parameterMetadata: [],
    });
    assert.equal(heating.status, 201);
    const plumbing = await requestJson(baseUrl, `/api/objects/${objectId}/plumbing`, "POST", {
      input: plumbingInput(),
      parameterMetadata: [],
      workPrices: { baseRevision: 0, revision: 0, waterHotPointRub: 2000, recirculationPerMeterRub: 1000, trapInstallRub: 2000, markupPercent: 45 },
    });
    assert.equal(plumbing.status, 201);
    const read = await getJson(baseUrl, `/api/objects/${objectId}`);
    const data = read.data as { calculations: unknown[]; plumbingCalculations: unknown[] };
    assert.equal(data.calculations.length, 1);
    assert.equal(data.plumbingCalculations.length, 1);
  });
});
