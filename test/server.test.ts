import assert from "node:assert/strict";
import { once } from "node:events";
import { get as httpGet } from "node:http";
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
    assert.match(html, /Карточки объектов и расчёты отопления/);
    assert.match(html, /id="heating-form"/);
    assert.match(html, /«Сохранить карточку» сохраняет только клиента и реквизиты объекта/);
    assert.match(html, /даже если данные заполнены частично/);
    const materials = html.match(/<details id="object-materials-details"[^>]*>[\s\S]*?<\/details>/)?.[0];
    assert.ok(materials);
    assert.doesNotMatch(materials.split(">")[0] ?? "", /\bopen\b/);
    assert.match(materials, /Добавленные материалы/);
    assert.doesNotMatch(materials, /object-materials-link|<input|<button/);
    assert.match(html, /id="object-materials-link"[^>]*target="_blank"[^>]*hidden/);
  });
});

test("форма допускает неизвестные параметры без предзаполненных значений", async () => {
  await withServer(async (baseUrl) => {
    const html = await (await fetch(baseUrl)).text();
    const boilerControl = html.match(/<select name="includeIndirectWaterHeater">([\s\S]*?)<\/select>/)?.[1];
    assert.ok(boilerControl);
    assert.match(boilerControl, /value=""/);
    assert.match(boilerControl, /value="true"/);
    assert.match(boilerControl, /value="false"/);
    assert.match(html, /<select name="parameterSource">\s*<option value="">Не указан<\/option>/);
    for (const field of ["houseAreaM2", "residents", "baths", "showers", "circuitLengthM"]) {
      const control = html.match(new RegExp(`<input name="${field}"[^>]*>`))?.[0];
      assert.ok(control);
      assert.doesNotMatch(control, /\b(?:value|required)=?/);
    }
    const js = await (await fetch(`${baseUrl}/app.js`)).text();
    assert.match(js, /Стоимость известных работ/);
    assert.match(js, /Сохранённые материалы показаны отдельно в блоке «Добавленные материалы»/);
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
      body: JSON.stringify({ residents: "" }),
    });
    const payload = (await response.json()) as { error: string; issues: string[] };

    assert.equal(response.status, 400);
    assert.equal(payload.error, "Некорректные входные данные.");
    assert.ok(payload.issues.length > 0);
  });
});

test("API считает частичный ввод, не превращая пропуски в нули", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/calculate`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ houseAreaM2: 120, heatSource: "gas", includeIndirectWaterHeater: false }),
    });
    const report = await response.json() as { floorHeating: { pipeLengthM: number | null; missingParameters: string[] }; boiler: { recommendedPowerKw: number } };
    assert.equal(response.status, 200);
    assert.equal(report.floorHeating.pipeLengthM, null);
    assert.deepEqual(report.floorHeating.missingParameters, ["rooms"]);
    assert.equal(report.boiler.recommendedPowerKw, 24);
  });
});

test("неизвестный адрес возвращает 404", async () => {
  await withServer(async (baseUrl) => {
    await new Promise<void>((resolve, reject) => {
      const request = httpGet(`${baseUrl}/missing`, (response) => {
        assert.equal(response.statusCode, 404);
        response.resume();
        response.once("end", resolve);
      });
      request.once("error", reject);
    });
  });
});


function validObjectPayload(): Record<string, unknown> {
  return {
    client: { name: "Иван Петров", phone: null, email: null, notes: null },
    object: { address: "Москва, ул. Примерная, 1", name: "Загородный дом", notes: null },
    calculation: {
      input: validInput(),
      parameterMetadata: [{
        path: "input.houseAreaM2",
        source: "client",
        verificationStatus: "confirmed",
      }],
    },
  };
}

test("API создаёт, читает и обновляет карточку объекта с версиями расчёта", async () => {
  await withServer(async (baseUrl) => {
    const createResponse = await fetch(`${baseUrl}/api/objects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validObjectPayload()),
    });
    const created = (await createResponse.json()) as {
      id: string;
      organizationId: string;
      client: { name: string };
      object: { address: string };
      calculations: Array<{ parameters: Array<{ path: string; source: string }> }>;
    };
    assert.equal(createResponse.status, 201);
    assert.equal(created.organizationId, "org-local");
    assert.equal(created.client.name, "Иван Петров");
    assert.ok(created.calculations[0]?.parameters.some((parameter) =>
      parameter.path === "input.houseAreaM2" && parameter.source === "client"));

    const listResponse = await fetch(`${baseUrl}/api/objects`);
    const list = (await listResponse.json()) as { objects: Array<{ id: string; clientName: string }> };
    assert.equal(listResponse.status, 200);
    assert.deepEqual(list.objects.map((object) => object.id), [created.id]);

    const updateResponse = await fetch(`${baseUrl}/api/objects/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client: { name: "Пётр Иванов" },
        object: { address: "Тверь, ул. Новая, 2" },
      }),
    });
    assert.equal(updateResponse.status, 200);

    const calculationResponse = await fetch(`${baseUrl}/api/objects/${created.id}/calculations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: { ...validInput(), houseAreaM2: 140 } }),
    });
    assert.equal(calculationResponse.status, 201);

    const detailsResponse = await fetch(`${baseUrl}/api/objects/${created.id}`);
    const details = (await detailsResponse.json()) as {
      client: { name: string };
      object: { address: string };
      calculations: unknown[];
    };
    assert.equal(details.client.name, "Пётр Иванов");
    assert.equal(details.object.address, "Тверь, ул. Новая, 2");
    assert.equal(details.calculations.length, 2);
  });
});

test("API требует имя клиента и адрес объекта", async () => {
  await withServer(async (baseUrl) => {
    const payload = validObjectPayload();
    payload.client = { name: "" };
    payload.object = { address: "" };
    const response = await fetch(`${baseUrl}/api/objects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await response.json()) as { issues: string[] };
    assert.equal(response.status, 400);
    assert.ok(body.issues.some((issue) => issue.includes("client.name")));
    assert.ok(body.issues.some((issue) => issue.includes("object.address")));
  });
});


test("GET /app.js и /styles.css загружает ресурсы интерфейса", async () => {
  await withServer(async (baseUrl) => {
    const [scriptResponse, styleResponse] = await Promise.all([
      fetch(`${baseUrl}/app.js`),
      fetch(`${baseUrl}/styles.css`),
    ]);
    assert.equal(scriptResponse.status, 200);
    assert.match(scriptResponse.headers.get("content-type") ?? "", /javascript/);
    assert.match(await scriptResponse.text(), /\/api\/objects/);
    assert.equal(styleResponse.status, 200);
    assert.match(styleResponse.headers.get("content-type") ?? "", /text\/css/);
  });
});


test("API сохраняет неполную карточку без расчёта", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/objects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client: { name: "Клиент без полного опроса" },
        object: { address: "Адрес уточняется, дом 1" },
      }),
    });
    const details = (await response.json()) as { calculations: unknown[]; client: { name: string } };
    assert.equal(response.status, 201);
    assert.equal(details.client.name, "Клиент без полного опроса");
    assert.deepEqual(details.calculations, []);
  });
});
