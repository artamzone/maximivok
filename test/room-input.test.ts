import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteProjectRepository } from "../src/storage.js";
import test from "node:test";
import { parseHeatingInput } from "../src/validation.js";
import { calculateHeating } from "../src/calculator.js";

const full = JSON.parse(readFileSync("examples/heating-input.json", "utf8")) as Record<string, unknown>;
const oldRooms = full.rooms as Record<string, unknown>[];
function input(room: Record<string, unknown> = {}, houseCeilingHeightM: unknown = 2.9) {
  return { ...full, houseCeilingHeightM, rooms: [{ ...oldRooms[0], ...room }] };
}

test("помещение наследует высоту дома и использует её в расчёте", () => {
  const parsed = parseHeatingInput(input({ useHouseCeilingHeight: true, ceilingHeightM: null }));
  assert.equal(parsed.rooms[0]?.ceilingHeightM, 2.9);
  assert.equal(parsed.rooms[0]?.useHouseCeilingHeight, true);
  assert.equal(calculateHeating(parsed).radiators[0]?.requiredPowerW, 2100);
});

test("смена общей высоты меняет только наследующие комнаты", () => {
  const first = parseHeatingInput({ ...input(), rooms: [
    { ...oldRooms[0], useHouseCeilingHeight: true },
    { ...oldRooms[1], useHouseCeilingHeight: false, ceilingHeightM: 3.5 },
  ] });
  const next = parseHeatingInput({ ...first, houseCeilingHeightM: 3.3 });
  assert.equal(next.rooms[0]?.ceilingHeightM, 3.3);
  assert.equal(next.rooms[1]?.ceilingHeightM, 3.5);
  assert.ok(calculateHeating(next).radiators.every((r) => r.status === "requires_engineer_review"));
});

test("неизвестная высота дома не подменяется стандартной; индивидуальная может быть неизвестной", () => {
  const inherited = parseHeatingInput(input({ useHouseCeilingHeight: true }, null));
  assert.equal(inherited.rooms[0]?.ceilingHeightM, null);
  assert.equal(calculateHeating(inherited).radiators[0]?.status, "impossible");
  const overridden = parseHeatingInput(input({ useHouseCeilingHeight: false, ceilingHeightM: null }));
  assert.equal(overridden.rooms[0]?.ceilingHeightM, null);
});

test("количества определяют наличие без деления мощности комнаты", () => {
  for (const count of [1, 2, 3]) {
    const parsed = parseHeatingInput(input({ radiatorCount: count, standardWindowCount: 2, panoramicWindowCount: 0 }));
    const report = calculateHeating(parsed);
    assert.equal(parsed.rooms[0]?.radiatorCount, count);
    assert.equal(report.radiators[0]?.radiatorCount, count);
    assert.equal(report.radiators[0]?.requiredPowerW, 2100);
  }
});

test("количество достаточно для определения наличия без старых булевых признаков", () => {
  const raw = input({ radiatorCount: 3, standardWindowCount: 2, panoramicWindowCount: 0 });
  delete raw.rooms[0]!.hasRadiator;
  delete raw.rooms[0]!.hasStandardWindows;
  delete raw.rooms[0]!.hasPanoramicWindows;
  const room = parseHeatingInput(raw).rooms[0]!;
  assert.equal(room.hasRadiator, true);
  assert.equal(room.hasStandardWindows, true);
  assert.equal(room.hasPanoramicWindows, false);
});

test("наследование и количества сохраняются после перезапуска SQLite без пересчёта версии", () => {
  const directory = mkdtempSync(join(tmpdir(), "ivok-rooms-"));
  const databasePath = join(directory, "test.sqlite");
  let repository = new SqliteProjectRepository(databasePath);
  try {
    const parsed = parseHeatingInput(input({ useHouseCeilingHeight: true, radiatorCount: 3,
      standardWindowCount: 2, panoramicWindowCount: 0 }));
    const report = calculateHeating(parsed);
    const created = repository.createObject({
      client: { name: "Тест", phone: null, email: null, notes: null },
      object: { address: "Тест", name: null, notes: null },
      calculation: { input: parsed, parameterMetadata: [] },
    }, report);
    repository.close();
    repository = new SqliteProjectRepository(databasePath);
    const restored = repository.getObject(created.id)!.calculations[0]!;
    assert.deepEqual(restored.input, parsed);
    assert.deepEqual(restored.report, report);
    const revised = parseHeatingInput({ ...restored.input, houseCeilingHeightM: 3.4 });
    assert.equal(revised.rooms[0]?.ceilingHeightM, 3.4);
    assert.equal(restored.report.input.rooms[0]?.ceilingHeightM, 2.9);
  } finally {
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("нулевое количество означает отсутствие, панорамное окно требует инженера", () => {
  const none = parseHeatingInput(input({ radiatorCount: 0, hasRadiator: false }));
  assert.equal(calculateHeating(none).radiators.length, 0);
  const panoramic = parseHeatingInput(input({ panoramicWindowCount: 2, hasPanoramicWindows: true }));
  assert.equal(calculateHeating(panoramic).radiators[0]?.requiredPowerW, null);
});

test("количество неизвестно — это не один элемент; старый отчёт неизменен", () => {
  const legacy = parseHeatingInput(full);
  assert.equal(legacy.rooms[0]?.radiatorCount, undefined);
  const expected = JSON.parse(readFileSync("test/fixtures/legacy-report.json", "utf8")) as unknown;
  assert.equal(JSON.stringify(calculateHeating(legacy)), JSON.stringify(expected));
  const unknown = parseHeatingInput(input({ radiatorCount: null }));
  assert.equal(unknown.rooms[0]?.radiatorCount, null);
  assert.equal(unknown.rooms[0]?.hasRadiator, true);
});

test("неверные количества, высоты и противоречивые признаки отклоняются", () => {
  for (const count of [-1, 1.5, "2", Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseHeatingInput(input({ radiatorCount: count })));
  }
  assert.throws(() => parseHeatingInput(input({ standardWindowCount: 2, hasStandardWindows: false })));
  assert.throws(() => parseHeatingInput(input({}, 0)));
  assert.throws(() => parseHeatingInput(input({ useHouseCeilingHeight: "true" })));
});
