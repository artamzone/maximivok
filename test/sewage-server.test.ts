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

function sewageInput(): Record<string, unknown> {
  return {
    sewer: {
      trapCount: 1,
      alreadyExecuted: [],
      sewerMains: [
        { id: "main-1", fromRoomIds: ["bath-1"], lengthM: 7, alreadyExecuted: false },
      ],
    },
    plumbing: {
      rooms: [
        {
          roomId: "bath-1",
          fixtures: [
            { type: "bath", count: 1 },
            { type: "sink", count: 1 },
            { type: "toilet", count: 1 },
            { type: "shower_cabin", count: 1 },
          ],
          hasRecirculation: false,
        },
      ],
      hotWaterSource: "two_loop_boiler",
    },
  };
}

function sewageDraft(): Record<string, unknown> {
  return {
    input: sewageInput(),
    parameterMetadata: [],
    workPrices: {
      baseRevision: 0,
      revision: 0,
      sewagePoint50Rub: 1500,
      sewagePoint110Rub: 2500,
      sewerMainPerMeterRub: 1000,
      standpipeRub: 3000,
      markupPercent: 45,
    },
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

test("POST /api/sewage возвращает отчёт без сохранения (с ценами из SQLite)", async () => {
  await withServer(async (baseUrl) => {
    const response = await requestJson(baseUrl, "/api/sewage", "POST", sewageInput());
    assert.equal(response.status, 200);
    const data = response.data as { status: string; points50: number; points110: number; costStatus: string; lengthM: number };
    assert.equal(data.status, "calculated");
    assert.equal(data.points50, 4);
    assert.equal(data.points110, 1);
    // На сервере цены берутся из getSewagePrices(), поэтому сметы есть, costStatus = calculated.
    // Путь без цен (costStatus: impossible) покрыт test/sewage.test.ts для чистого ядра.
    assert.equal(data.costStatus, "calculated");
    assert.equal(data.lengthM, 7);
  });
});

test("POST /api/objects/:id/sewage сохраняет версию с привязкой снимка цен", async () => {
  await withServer(async (baseUrl) => {
    const objectId = await createObject(baseUrl);
    const response = await requestJson(baseUrl, `/api/objects/${objectId}/sewage`, "POST", sewageDraft());
    assert.equal(response.status, 201);
    const data = response.data as { block: string; workPrices: { revision: number }; report: { lengthM: number } };
    assert.equal(data.block, "sewage");
    assert.equal(data.workPrices.revision, 0);
    assert.equal(data.report.lengthM, 7);
  });
});

test("GET /api/objects/:id возвращает sewageCalculations отдельно от plumbing и heating", async () => {
  await withServer(async (baseUrl) => {
    const objectId = await createObject(baseUrl);
    const heatingDraft = {
      input: {
        houseAreaM2: 60,
        heatSource: "gas",
        rooms: [
          { id: "bath-1", name: "bath", areaM2: 6, ceilingHeightM: 2.6, hasStandardWindows: true, hasPanoramicWindows: false, floorHeatingAreaM2: 0, hasRadiator: false },
        ],
        availableElectricPowerKw: null,
        residents: 2,
        baths: 1,
        showers: 1,
        includeIndirectWaterHeater: false,
        circuitLengthM: 80,
      },
      parameterMetadata: [],
    };
    const heating = await requestJson(baseUrl, `/api/objects/${objectId}/calculations`, "POST", heatingDraft);
    assert.equal(heating.status, 201);
    const plumbing = await requestJson(baseUrl, `/api/objects/${objectId}/plumbing`, "POST", {
      input: { rooms: [], hotWaterSource: "two_loop_boiler" },
      parameterMetadata: [],
      workPrices: { baseRevision: 0, revision: 0, waterHotPointRub: 2000, recirculationPerMeterRub: 1000, trapInstallRub: 2000, markupPercent: 45 },
    });
    assert.equal(plumbing.status, 201);
    const sewage = await requestJson(baseUrl, `/api/objects/${objectId}/sewage`, "POST", sewageDraft());
    assert.equal(sewage.status, 201);
    const read = await getJson(baseUrl, `/api/objects/${objectId}`);
    const data = read.data as { calculations: unknown[]; plumbingCalculations: Array<{ block: string }>; sewageCalculations: Array<{ block: string }> };
    assert.equal(data.calculations.length, 1);
    assert.equal(data.plumbingCalculations.length, 1);
    assert.equal(data.plumbingCalculations[0]!.block, "plumbing");
    assert.equal(data.sewageCalculations.length, 1);
    assert.equal(data.sewageCalculations[0]!.block, "sewage");
  });
});

test("POST /api/objects/:id/sewage возвращает 404 для несуществующего объекта", async () => {
  await withServer(async (baseUrl) => {
    const response = await requestJson(baseUrl, "/api/objects/does-not-exist/sewage", "POST", sewageDraft());
    assert.equal(response.status, 404);
  });
});

test("POST /api/objects/:id/sewage возвращает 409 при устаревшем baseRevision", async () => {
  await withServer(async (baseUrl) => {
    const objectId = await createObject(baseUrl);
    const stale = { ...sewageDraft() };
    (stale.workPrices as { baseRevision: number }).baseRevision = 5;
    const response = await requestJson(baseUrl, `/api/objects/${objectId}/sewage`, "POST", stale);
    assert.equal(response.status, 409);
  });
});
