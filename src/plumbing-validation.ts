import { InputValidationError } from "./validation.js";
import type { HotWaterSource, PlumbingFixtureType, PlumbingInput, PlumbingRoomInput, PlumbingWorkPrices } from "./types.js";

export interface PlumbingWorkPricesDraft {
  baseRevision: number;
  prices: PlumbingWorkPrices;
}

const fixtureTypes = new Set<PlumbingFixtureType>([
  "bath",
  "shower_cabin",
  "sink",
  "hygiene_shower",
  "toilet",
  "washing_machine",
  "dishwasher",
  "kitchen_sink",
]);

const hotWaterSources = new Set<HotWaterSource>([
  "two_loop_boiler",
  "gas_boiler",
  "indirect_boiler",
  "electric_boiler",
  "gas_column",
  "none",
  "unknown",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, path: string, issues: string[]): string {
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(`${path}: требуется непустая строка`);
    return "";
  }
  return value;
}

function requireInteger(value: unknown, path: string, issues: string[]): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    issues.push(`${path}: требуется целое число`);
    return 0;
  }
  if (value < 0) issues.push(`${path}: значение должно быть не меньше 0`);
  if (!Number.isSafeInteger(value)) issues.push(`${path}: требуется безопасное целое число`);
  return value;
}

function requireBoolean(value: unknown, path: string, issues: string[]): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "boolean") {
    issues.push(`${path}: требуется true, false или null`);
    return null;
  }
  return value;
}

function parseFixture(value: unknown, index: number, issues: string[]): { type: PlumbingFixtureType; count: number; lengthM: number | null; comment: string | null } | null {
  const path = `fixtures[${index}]`;
  if (!isRecord(value)) {
    issues.push(`${path}: требуется объект`);
    return null;
  }
  const rawType = value.type;
  if (typeof rawType !== "string" || !fixtureTypes.has(rawType as PlumbingFixtureType)) {
    issues.push(`${path}.type: допустимы bath, shower_cabin, sink, hygiene_shower, toilet, washing_machine, dishwasher, kitchen_sink`);
    return null;
  }
  const type = rawType as PlumbingFixtureType;
  if (value.count === undefined) {
    issues.push(`${path}.count: требуется целое число`);
    return { type, count: 0, lengthM: null, comment: null };
  }
  const count = requireInteger(value.count, `${path}.count`, issues);
  let lengthM: number | null = null;
  if (value.lengthM !== undefined && value.lengthM !== null) {
    if (typeof value.lengthM !== "number" || !Number.isFinite(value.lengthM) || value.lengthM < 0) {
      issues.push(`${path}.lengthM: требуется неотрицательное конечное число или null`);
    } else {
      lengthM = value.lengthM;
    }
  }
  let comment: string | null = null;
  if (value.comment !== undefined && value.comment !== null && value.comment !== "") {
    if (typeof value.comment !== "string") {
      issues.push(`${path}.comment: ожидается строка`);
    } else {
      const trimmed = value.comment.trim();
      comment = trimmed === "" ? null : trimmed.slice(0, 500);
    }
  }
  return { type, count, lengthM, comment };
}

function parseRoom(value: unknown, index: number, issues: string[]): PlumbingRoomInput {
  const path = `rooms[${index}]`;
  if (!isRecord(value)) {
    issues.push(`${path}: требуется объект`);
    return { roomId: "", fixtures: [], hasRecirculation: null };
  }
  const fixtures: PlumbingRoomInput["fixtures"] = [];
  if (value.fixtures === undefined || value.fixtures === null) {
    issues.push(`${path}.fixtures: требуется массив приборов`);
  } else if (!Array.isArray(value.fixtures)) {
    issues.push(`${path}.fixtures: требуется массив`);
  } else {
    for (const [fixtureIndex, fixture] of value.fixtures.entries()) {
      const parsed = parseFixture(fixture, fixtureIndex, issues);
      if (parsed !== null) fixtures.push(parsed);
    }
  }
  return {
    roomId: requireString(value.roomId, `${path}.roomId`, issues),
    fixtures,
    hasRecirculation: requireBoolean(value.hasRecirculation, `${path}.hasRecirculation`, issues),
  };
}

export function parsePlumbingInput(value: unknown): PlumbingInput {
  const issues: string[] = [];
  if (!isRecord(value)) throw new InputValidationError(["корневое значение должно быть объектом"]);

  const roomsValue = value.rooms;
  const rooms: PlumbingRoomInput[] = [];
  if (roomsValue === undefined || roomsValue === null) {
    issues.push("rooms: требуется массив комнат");
  } else if (!Array.isArray(roomsValue)) {
    issues.push("rooms: требуется массив");
  } else {
    roomsValue.forEach((room, index) => rooms.push(parseRoom(room, index, issues)));
  }

  const roomIds = new Set<string>();
  for (const room of rooms) {
    if (room.roomId === "") continue;
    if (roomIds.has(room.roomId)) {
      issues.push(`rooms: идентификатор комнаты "${room.roomId}" повторяется`);
    } else {
      roomIds.add(room.roomId);
    }
  }

  const hotWaterSource: HotWaterSource = typeof value.hotWaterSource === "string"
    && hotWaterSources.has(value.hotWaterSource as HotWaterSource)
    ? (value.hotWaterSource as HotWaterSource)
    : value.hotWaterSource === null || value.hotWaterSource === undefined
      ? "unknown"
      : (issues.push("hotWaterSource: допустимы two_loop_boiler, gas_boiler, indirect_boiler, electric_boiler, gas_column, none, unknown"), "unknown");

  let recirculationLengthM: number | null = null;
  if (value.recirculationLengthM !== undefined && value.recirculationLengthM !== null) {
    if (typeof value.recirculationLengthM !== "number" || !Number.isFinite(value.recirculationLengthM) || value.recirculationLengthM < 0) {
      issues.push("recirculationLengthM: требуется неотрицательное конечное число или null");
    } else {
      recirculationLengthM = value.recirculationLengthM;
    }
  }

  if (issues.length > 0) throw new InputValidationError(issues);
  return { rooms, hotWaterSource, recirculationLengthM };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parsePlumbingWorkPrices(value: unknown, path = "workPrices"): PlumbingWorkPrices {
  if (!record(value)) {
    throw new InputValidationError([`${path}: требуется объект снимка цен`]);
  }
  const issues: string[] = [];
  const revision = value.revision;
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0) {
    issues.push(`${path}.revision: требуется неотрицательное целое`);
  }
  const waterHotPointRub = value.waterHotPointRub;
  if (typeof waterHotPointRub !== "number" || !Number.isFinite(waterHotPointRub) || waterHotPointRub < 0) {
    issues.push(`${path}.waterHotPointRub: требуется неотрицательное конечное число`);
  }
  const recirculationPerMeterRub = value.recirculationPerMeterRub;
  if (typeof recirculationPerMeterRub !== "number" || !Number.isFinite(recirculationPerMeterRub) || recirculationPerMeterRub < 0) {
    issues.push(`${path}.recirculationPerMeterRub: требуется неотрицательное конечное число`);
  }
  const trapInstallRub = value.trapInstallRub;
  if (typeof trapInstallRub !== "number" || !Number.isFinite(trapInstallRub) || trapInstallRub < 0) {
    issues.push(`${path}.trapInstallRub: требуется неотрицательное конечное число`);
  }
  const markupPercentRaw = value.markupPercent;
  let markupPercent = 45;
  if (markupPercentRaw !== undefined) {
    if (typeof markupPercentRaw !== "number" || !Number.isFinite(markupPercentRaw) || markupPercentRaw < 0 || markupPercentRaw > 10000) {
      issues.push(`${path}.markupPercent: должен быть числом от 0 до 10000`);
    } else {
      markupPercent = markupPercentRaw;
    }
  }
  if (issues.length > 0) throw new InputValidationError(issues);
  return {
    revision: revision as number,
    waterHotPointRub: waterHotPointRub as number,
    recirculationPerMeterRub: recirculationPerMeterRub as number,
    trapInstallRub: trapInstallRub as number,
    markupPercent,
  };
}

export function parsePlumbingWorkPricesDraft(value: unknown, path = "workPrices"): PlumbingWorkPricesDraft {
  if (!record(value)) {
    throw new InputValidationError([`${path}: требуется объект { baseRevision, ...prices }`]);
  }
  const issues: string[] = [];
  const baseRevision = value.baseRevision;
  if (typeof baseRevision !== "number" || !Number.isSafeInteger(baseRevision) || baseRevision < 0) {
    issues.push(`${path}.baseRevision: требуется неотрицательное целое`);
  }
  const prices = parsePlumbingWorkPrices(value, path);
  if (issues.length > 0) throw new InputValidationError(issues);
  return { baseRevision: baseRevision as number, prices };
}
