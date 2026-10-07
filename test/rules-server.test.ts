import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createWebServer } from "../src/server.js";

async function withRules(run: (url: string, path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "ivok-rules-"));
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
function snapshot(path: string): string {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string; sql: string }[];
    return JSON.stringify(tables.map((table) => ({ ...table,
      rows: db.prepare(`SELECT * FROM "${table.name.replaceAll('"', '""')}" ORDER BY rowid`).all(),
    })));
  } finally { db.close(); }
}

test("страница правил открывается отдельно и не содержит редактора", async () => {
  await withRules(async (url) => {
    const home = await (await fetch(url)).text();
    assert.match(home, /href="\/rules" target="_blank" rel="noopener noreferrer"/);
    for (const path of ["/rules", "/rules.js"]) {
      const response = await fetch(`${url}${path}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const text = await response.text();
      if (path === "/rules") {
        assert.match(text, /Только просмотр/);
        assert.doesNotMatch(text, /<input|<select|<textarea|<form|contenteditable/i);
        assert.match(text, /id="rules-list"/);
      }
    }
  });
});

test("правила доступны только для чтения: семь значений ТЗ, без изменений БД", async () => {
  await withRules(async (url, path) => {
    const before = snapshot(path);
    const response = await fetch(`${url}/api/rules`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const data = await response.json();
    assert.equal(data.readOnly, true);
    assert.deepEqual(data.items.map((item: { value: number }) => item.value), [6, 80, 90, 12, 100, 30, 3.2]);
    assert.equal(new Set(data.items.map((item: { id: string }) => item.id)).size, 7);
    assert.ok(data.items.every((item: { name: string; unit: string; description: string }) => item.name && item.unit && item.description));
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const mutation = await fetch(`${url}/api/rules`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify({ pipeMetersPerM2: 999 }) });
      assert.equal(mutation.status, 405);
      assert.equal(mutation.headers.get("allow"), "GET");
    }
    assert.deepEqual(await (await fetch(`${url}/api/rules`)).json(), data);
    assert.equal(snapshot(path), before);
  });
});
