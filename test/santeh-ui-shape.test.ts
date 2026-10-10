import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createWebServer } from "../src/server.js";

/**
 * TaskCheck P1: правильная модель комнат «roomId → fixtures[]».
 * Проверяем, что UI-формат (id, name, hasRecirculation, fixtures[{ type, count, lengthM, comment }])
 * принимается серверным API без потерь и валидируется как раньше.
 */

async function withServer(run: (url: string) => Promise<void>): Promise<void> {
  const server = createWebServer({ databasePath: ":memory:" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { server.close(); await once(server, "close"); }
}

test("P1: новая модель комнат принимается API /api/plumbing", async () => {
  await withServer(async (url) => {
    // 1) Создаём объект с расчётом отопления, чтобы UI мог подтянуть roomId.
    const objectPayload = {
      client: { name: "Тест UI", phone: null, email: null, notes: null },
      object: { address: "Тестовый адрес", name: null, notes: null },
      calculation: {
        input: {
          houseAreaM2: 80,
          rooms: [
            { id: "bath-1", name: "Ванная 1 этаж", areaM2: 6, ceilingHeightM: 2.7,
              hasStandardWindows: false, hasPanoramicWindows: false, floorHeatingAreaM2: 0, hasRadiator: false },
            { id: "kitchen-1", name: "Кухня", areaM2: 10, ceilingHeightM: 2.7,
              hasStandardWindows: true, hasPanoramicWindows: false, floorHeatingAreaM2: 0, hasRadiator: false },
          ],
          heatSource: "gas",
          availableElectricPowerKw: null,
          residents: 2, baths: 1, showers: 1,
          includeIndirectWaterHeater: false,
          circuitLengthM: 80,
        },
        parameterMetadata: [],
      },
    };
    const objectResp = await fetch(`${url}/api/objects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(objectPayload) });
    assert.equal(objectResp.status, 201);
    const object = await objectResp.json();

    // 2) UI отправляет расчёт водоснабжения с roomId, унаследованными из отопления.
    const plumbingInput = {
      rooms: [
        { roomId: "bath-1", hasRecirculation: true,
          fixtures: [
            { type: "bath", count: 1, lengthM: 3.5, comment: "основная" },
            { type: "sink", count: 1, lengthM: 1.2, comment: "" },
            { type: "toilet", count: 1, lengthM: null, comment: "" },
          ] },
        { roomId: "kitchen-1", hasRecirculation: false,
          fixtures: [
            { type: "kitchen_sink", count: 1, lengthM: 2.0, comment: "" },
            { type: "dishwasher", count: 1, lengthM: 1.0, comment: "" },
          ] },
      ],
      hotWaterSource: "two_loop_boiler",
      recirculationLengthM: 12.0,
    };
    const calcResp = await fetch(`${url}/api/plumbing`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(plumbingInput) });
    const report = await calcResp.json();
    assert.equal(calcResp.status, 200, `ожидался 200, фактически ${calcResp.status}: ${JSON.stringify(report)}`);
    // Если не 200, печатаем тело.
    if (calcResp.status !== 200) {
      console.error("Unexpected response:", JSON.stringify(report, null, 2));
    }
    // Точнее: bath, sink (ГВС+ХВС) + toilet (только ХВС) = 3 ХВС + 2 ГВС в ванной;
    // kitchen_sink (ГВС+ХВС) + dishwasher (только ХВС) = 2 ХВС + 1 ГВС на кухне.
    // Итого: 5 ХВС, 3 ГВС.
    assert.equal(report.coldWaterPoints, 5);
    assert.equal(report.hotWaterPoints, 3);
    // Рециркуляция: 1 комната с hasRecirculation=true и 2 ГВС-приборами (bath+sink).
    assert.equal(report.recirculationPoints, 2);
    // Снимок цен пришёл — стоимость посчитана.
    assert.equal(report.costStatus, "calculated");
    assert.ok(report.costSubtotalKopecks !== null);
    // Снимок редакции 0.
    assert.equal(report.workPrices.revision, 0);
    // Сохраняем версию с этим снимком.
    const saveResp = await fetch(`${url}/api/objects/${object.id}/plumbing`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: plumbingInput, parameterMetadata: [], workPrices: { ...report.workPrices, baseRevision: report.workPrices.revision } }),
    });
    assert.equal(saveResp.status, 201);

    // 3) Чтение объекта — версия водоснабжения сохранена с roomId из UI.
    const readResp = await fetch(`${url}/api/objects/${object.id}`);
    assert.equal(readResp.status, 200);
    const details = await readResp.json();
    assert.equal(details.plumbingCalculations.length, 1);
    const saved = details.plumbingCalculations[0];
    const roomIds = saved.input.rooms.map((r: { roomId: string }) => r.roomId);
    assert.deepEqual(roomIds, ["bath-1", "kitchen-1"]);
    const bathRoom = saved.input.rooms.find((r: { roomId: string }) => r.roomId === "bath-1");
    assert.equal(bathRoom.hasRecirculation, true);
    assert.equal(bathRoom.fixtures.length, 3);
    const bath = bathRoom.fixtures.find((f: { type: string }) => f.type === "bath");
    assert.equal(bath.lengthM, 3.5);
    assert.equal(bath.count, 1);
    assert.equal(saved.input.recirculationLengthM, 12.0);
    assert.equal(saved.input.hotWaterSource, "two_loop_boiler");
  });
});

test("P1: повторное сохранение с дублем roomId отвергается сервером", async () => {
  await withServer(async (url) => {
    const objectPayload = {
      client: { name: "Тест Дублей", phone: null, email: null, notes: null },
      object: { address: "Тестовый адрес 2", name: null, notes: null },
      calculation: null,
    };
    const objectResp = await fetch(`${url}/api/objects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(objectPayload) });
    await objectResp.json();
    const plumbingInput = {
      rooms: [
        { roomId: "dup", hasRecirculation: false, fixtures: [{ type: "sink", count: 1, lengthM: null, comment: null }] },
        { roomId: "dup", hasRecirculation: false, fixtures: [{ type: "toilet", count: 1, lengthM: null, comment: null }] },
      ],
      hotWaterSource: "gas_boiler",
    };
    const calcResp = await fetch(`${url}/api/plumbing`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(plumbingInput) });
    assert.equal(calcResp.status, 400);
  });
});

test("P1: ручной ввод комнат работает, если отопления нет (roomId = room-1, room-2, ...)", async () => {
  await withServer(async (url) => {
    // Без отопления, без сохранённой версии — UI должен позволить ручной ввод.
    const plumbingInput = {
      rooms: [
        { roomId: "room-1", hasRecirculation: false, fixtures: [{ type: "bath", count: 1, lengthM: null, comment: null }] },
        { roomId: "room-2", hasRecirculation: false, fixtures: [{ type: "sink", count: 1, lengthM: null, comment: null }] },
      ],
      hotWaterSource: "none",
    };
    const calcResp = await fetch(`${url}/api/plumbing`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(plumbingInput) });
    assert.equal(calcResp.status, 200);
    const report = await calcResp.json();
    // bath + sink: coldWater=true и hotWater=true, поэтому 2 ХВС и 2 ГВС.
    // none + есть ГВС-приборы = impossible для блока ГВС.
    assert.equal(report.coldWaterPoints, 2);
    assert.equal(report.hotWaterPoints, 2);
  });
});
