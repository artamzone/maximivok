import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createWebServer } from "../src/server.js";

async function withServer(run: (url: string) => Promise<void>): Promise<void> {
  const server = createWebServer({ databasePath: ":memory:" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { server.close(); await once(server, "close"); }
}

test("все ресурсы TASK-03 открываются, каталог работ показывает 35 строк", async () => {
  await withServer(async (url) => {
    const resources = ["/", "/app.js", "/styles.css", "/catalog", "/catalog.js", "/materials.js", "/works", "/works.js", "/rules", "/rules.js"];
    for (const p of resources) {
      const res = await fetch(url + p);
      assert.equal(res.status, 200, p);
    }
    const works = await (await fetch(`${url}/api/works`)).json();
    assert.equal(works.items.length, 35);
    const fh = works.items.find((x: { id: string }) => x.id === "floor_heating")!;
    const ins = works.items.find((x: { id: string }) => x.id === "insulation")!;
    assert.equal(fh?.priceRub, 600);
    assert.equal(fh?.ivokPriceRub, 870);
    assert.equal(ins?.priceRub, 100);
    assert.equal(works.markupPercent, 45);
    const heating = {
      houseAreaM2: 60, heatSource: "gas",
      rooms: [{ id: "r1", name: "r", areaM2: 30, ceilingHeightM: 2.6, hasStandardWindows: true, hasPanoramicWindows: false, floorHeatingAreaM2: 20, hasRadiator: false }],
      availableElectricPowerKw: null, residents: 2, baths: 1, showers: 1, includeIndirectWaterHeater: false, circuitLengthM: 80,
    };
    const calc = await (await fetch(`${url}/api/calculate`, { method: "POST", body: JSON.stringify(heating), headers: { "content-type": "application/json" } })).json();
    assert.equal(calc.floorHeating.installationCostRub, 18000);
    assert.equal(calc.floorHeating.insulationInstallationCostRub, 2000);
    assert.deepEqual(calc.workPrices, { revision: 0, floorHeatingRubPerM2: 900, insulationRubPerM2: 100 });
  });
});
