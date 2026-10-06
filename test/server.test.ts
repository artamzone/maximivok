import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createWebServer } from "../src/server.js";

async function withServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = createWebServer();
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

function validInput(): Record<string, unknown> {
  return {
    houseAreaM2: 120,
    rooms: [
      {
        id: "living-room",
        name: "Гостиная",
        areaM2: 30,
        ceilingHeightM: 2.8,
        hasStandardWindows: true,
        hasPanoramicWindows: false,
        floorHeatingAreaM2: 25,
        hasRadiator: true,
      },
    ],
    heatSource: "gas",
    availableElectricPowerKw: null,
    residents: 3,
    baths: 0,
    showers: 1,
    includeIndirectWaterHeater: true,
    circuitLengthM: 80,
  };
}

test("GET / открывает веб-форму", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(baseUrl);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.match(html, /Предварительный расчёт отопления/);
    assert.match(html, /id="heating-form"/);
  });
});

test("POST /api/calculate возвращает расчёт", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/calculate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validInput()),
    });
    const report = (await response.json()) as {
      status: string;
      floorHeating: { pipeLengthM: number; circuitCount: number };
      boiler: { recommendedPowerKw: number | null };
    };

    assert.equal(response.status, 200);
    assert.equal(report.status, "requires_engineer_review");
    assert.equal(report.floorHeating.pipeLengthM, 150);
    assert.equal(report.floorHeating.circuitCount, 2);
    assert.equal(report.boiler.recommendedPowerKw, 24);
  });
});

test("API возвращает понятные ошибки валидации", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/calculate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const payload = (await response.json()) as { error: string; issues: string[] };

    assert.equal(response.status, 400);
    assert.equal(payload.error, "Некорректные входные данные.");
    assert.ok(payload.issues.length > 0);
  });
});

test("неизвестный адрес возвращает 404", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/missing`);
    assert.equal(response.status, 404);
  });
});
