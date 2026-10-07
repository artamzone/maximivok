import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const fixture = (name: string): string => resolve("test/fixtures", name);

test("CLI сохраняет корректные строки и позволяет прочитать ошибки после перезапуска", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "ivok-catalog-cli-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const databasePath = join(directory, "catalog.sqlite");
  const run = (...args: string[]) => spawnSync(process.execPath, [resolve("dist/src/catalog-storage-cli.js"), ...args], {
    cwd: directory,
    env: { ...process.env, IVOK_DATABASE_PATH: databasePath },
    encoding: "utf8",
  });
  assert.equal(run().status, 2);
  assert.equal(run("unknown").status, 2);
  assert.equal(run("import").status, 2);
  assert.equal(run("import", fixture("catalog-valid.xlsx"), "extra").status, 2);
  assert.equal(run("log", "id", "extra").status, 2);
  assert.equal(run("import", fixture("catalog-header.xlsx")).status, 2);
  assert.deepEqual(readdirSync(directory), []);
  const noDatabase = run("log");
  assert.equal(noDatabase.status, 1);
  assert.deepEqual(readdirSync(directory), []);

  const imported = run("import", fixture("catalog-partial.xlsx"));
  assert.equal(imported.status, 3, imported.stderr);
  const report = JSON.parse(imported.stdout);
  assert.equal(report.importedRows, 2);
  assert.equal(report.skippedRows, 2);
  assert.equal(report.issues.length, 3);
  const history = run("log");
  assert.equal(history.status, 0, history.stderr);
  assert.deepEqual(JSON.parse(history.stdout), [report]);
  const details = run("log", report.id);
  assert.equal(details.status, 0, details.stderr);
  assert.deepEqual(JSON.parse(details.stdout), report);
  const missing = run("log", "missing");
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /не найден/);
  const complete = run("import", fixture("catalog-valid.xlsx"));
  assert.equal(complete.status, 0, complete.stderr);
  assert.equal(JSON.parse(complete.stdout).insertedRows, 1);
  assert.equal(JSON.parse(complete.stdout).updatedRows, 1);
  assert.deepEqual(readdirSync(directory), ["catalog.sqlite"]);
});
