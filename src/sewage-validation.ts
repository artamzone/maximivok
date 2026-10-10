import { InputValidationError } from "./validation.js";
import { parsePlumbingInput } from "./plumbing-validation.js";
import { workDefinitions } from "./works-data.js";
import type { SewageInput, SewageWorkPrices, SewerMain, WorkId } from "./types.js";

export interface SewageWorkPricesDraft {
  baseRevision: number;
  prices: SewageWorkPrices;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const allowedWorkIds = new Set<string>(workDefinitions.map((work) => work.id));

/** Все приборы, имеющие канализационный сток. Внутренний контракт: совпадает с sewage-config.matrix. */
const SEWAGE_PRODUCING_FIXTURES = new Set<string>([
  "sink",
  "kitchen_sink",
  "shower_cabin",
  "bath",
  "hygiene_shower",
  "washing_machine",
  "dishwasher",
  "toilet",
]);

function parseSewerMains(value: unknown, path: string, roomIds: Set<string>): SewerMain[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new InputValidationError([`${path}: требуется массив SewerMain`]);
  }
  const mains: SewerMain[] = [];
  const seenMainIds = new Set<string>();
  for (let i = 0; i < value.length; i += 1) {
    const raw = value[i];
    if (!record(raw)) {
      throw new InputValidationError([`${path}[${i}]: требуется объект SewerMain`]);
    }
    const item = raw as Record<string, unknown>;
    const id = item.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new InputValidationError([`${path}[${i}].id: требуется непустая строка`]);
    }
    if (seenMainIds.has(id)) {
      throw new InputValidationError([`${path}[${i}].id: дубликат "${id}"`]);
    }
    seenMainIds.add(id);
    const fromRoomIdsRaw = item.fromRoomIds;
    if (!Array.isArray(fromRoomIdsRaw) || fromRoomIdsRaw.length === 0) {
      throw new InputValidationError([`${path}[${i}].fromRoomIds: требуется непустой массив идентификаторов комнат`]);
    }
    const fromRoomIds: string[] = [];
    const seenRoom = new Set<string>();
    for (let j = 0; j < fromRoomIdsRaw.length; j += 1) {
      const rid = fromRoomIdsRaw[j];
      if (typeof rid !== "string" || !roomIds.has(rid)) {
        throw new InputValidationError([
          `${path}[${i}].fromRoomIds[${j}]: комната "${String(rid)}" не найдена в plumbing.rooms`,
        ]);
      }
      if (seenRoom.has(rid)) {
        throw new InputValidationError([`${path}[${i}].fromRoomIds[${j}]: дубликат "${rid}"`]);
      }
      seenRoom.add(rid);
      fromRoomIds.push(rid);
    }
    const lengthM = item.lengthM;
    if (typeof lengthM !== "number" || !Number.isFinite(lengthM) || lengthM < 0) {
      throw new InputValidationError([`${path}[${i}].lengthM: требуется неотрицательное конечное число`]);
    }
    const alreadyExecuted = item.alreadyExecuted;
    if (typeof alreadyExecuted !== "boolean") {
      throw new InputValidationError([`${path}[${i}].alreadyExecuted: требуется boolean`]);
    }
    mains.push({ id, fromRoomIds, lengthM, alreadyExecuted });
  }
  return mains;
}

function roomsWithSewageProduction(input: SewageInput): Set<string> {
  const ids = new Set<string>();
  for (const room of input.plumbing.rooms) {
    for (const fixture of room.fixtures) {
      if (SEWAGE_PRODUCING_FIXTURES.has(fixture.type)) {
        ids.add(room.roomId);
        break;
      }
    }
  }
  return ids;
}

export function parseSewageInput(value: unknown, path = "input"): SewageInput {
  if (!record(value)) {
    throw new InputValidationError([`${path}: требуется объект SewageInput`]);
  }
  const issues: string[] = [];
  const plumbingValue = value.plumbing;
  let plumbing;
  try {
    plumbing = parsePlumbingInput(plumbingValue);
  } catch (error: unknown) {
    if (error instanceof InputValidationError) {
      throw new InputValidationError(error.issues.map((issue) => `${path}.plumbing.${issue}`));
    }
    throw error;
  }
  const roomIds = new Set(plumbing.rooms.map((r) => r.roomId));
  const sewer = value.sewer;
  if (!record(sewer)) {
    issues.push(`${path}.sewer: требуется объект`);
    if (issues.length > 0) throw new InputValidationError(issues);
    return {
      plumbing,
      sewer: { trapCount: null, alreadyExecuted: [], sewerMains: [] },
    };
  }
  const trapCount = sewer.trapCount;
  let resolvedTrapCount: number | null;
  if (trapCount === null || trapCount === undefined) {
    resolvedTrapCount = null;
  } else if (typeof trapCount === "number" && Number.isInteger(trapCount) && trapCount >= 0) {
    resolvedTrapCount = trapCount;
  } else {
    issues.push(`${path}.sewer.trapCount: требуется неотрицательное целое или null`);
    resolvedTrapCount = null;
  }
  const alreadyExecutedRaw = sewer.alreadyExecuted;
  const alreadyExecuted: WorkId[] = [];
  if (alreadyExecutedRaw !== undefined && alreadyExecutedRaw !== null) {
    if (!Array.isArray(alreadyExecutedRaw)) {
      issues.push(`${path}.sewer.alreadyExecuted: требуется массив WorkId`);
    } else {
      const seen = new Set<string>();
      alreadyExecutedRaw.forEach((item, index) => {
        if (typeof item !== "string" || item.length === 0) {
          issues.push(`${path}.sewer.alreadyExecuted[${index}]: требуется непустая строка`);
          return;
        }
        if (!allowedWorkIds.has(item)) {
          issues.push(`${path}.sewer.alreadyExecuted[${index}]: неизвестный WorkId ${item}`);
          return;
        }
        if (seen.has(item)) {
          issues.push(`${path}.sewer.alreadyExecuted[${index}]: дублирующийся WorkId ${item}`);
          return;
        }
        seen.add(item);
        alreadyExecuted.push(item);
      });
    }
  }
  let sewerMains: SewerMain[] = [];
  if (issues.length === 0) {
    try {
      sewerMains = parseSewerMains(sewer.sewerMains, `${path}.sewer.sewerMains`, roomIds);
    } catch (error: unknown) {
      if (error instanceof InputValidationError) {
        issues.push(...error.issues);
      } else {
        throw error;
      }
    }
  }
  if (issues.length > 0) throw new InputValidationError(issues);
  let standpipes = 0;
  if (sewer.standpipes !== undefined && sewer.standpipes !== null) {
    if (typeof sewer.standpipes !== "number" || !Number.isInteger(sewer.standpipes) || sewer.standpipes < 0) {
      issues.push(`${path}.sewer.standpipes: требуется неотрицательное целое или отсутствие`);
    } else {
      standpipes = sewer.standpipes;
    }
  }
  if (issues.length > 0) throw new InputValidationError(issues);
  const input: SewageInput = {
    plumbing,
    sewer: { trapCount: resolvedTrapCount, alreadyExecuted, sewerMains, standpipes },
  };
  // Покрытие лежаками — это рекомендация, а не блокирующая валидация.
  // Согласно P2 из TaskCheck: частичный расчёт допустим. Если канализационные комнаты не покрыты лежаками,
  // расчётный блок получит status=requires_engineer_review, missingParameters и предупреждение.
  // Число непокрытых комнат вернём через attachedCoverage в самом входе (вычислим ниже).
  return input;
}

/** Возвращает массив roomId, имеющих канализационные приборы, но не покрытых ни одним лежаком. */
export function uncoveredSewageRooms(input: SewageInput): string[] {
  const roomsWithSewage = roomsWithSewageProduction(input);
  const covered = new Set<string>();
  for (const main of input.sewer.sewerMains) {
    for (const rid of main.fromRoomIds) covered.add(rid);
  }
  const uncovered: string[] = [];
  for (const rid of roomsWithSewage) {
    if (!covered.has(rid)) uncovered.push(rid);
  }
  return uncovered;
}

export function parseSewageWorkPrices(value: unknown, path = "workPrices"): SewageWorkPrices {
  if (!record(value)) {
    throw new InputValidationError([`${path}: требуется объект снимка цен`]);
  }
  const issues: string[] = [];
  const revision = value.revision;
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0) {
    issues.push(`${path}.revision: требуется неотрицательное целое`);
  }
  const sewagePoint50Rub = value.sewagePoint50Rub;
  if (typeof sewagePoint50Rub !== "number" || !Number.isFinite(sewagePoint50Rub) || sewagePoint50Rub < 0) {
    issues.push(`${path}.sewagePoint50Rub: требуется неотрицательное конечное число`);
  }
  const sewagePoint110Rub = value.sewagePoint110Rub;
  if (typeof sewagePoint110Rub !== "number" || !Number.isFinite(sewagePoint110Rub) || sewagePoint110Rub < 0) {
    issues.push(`${path}.sewagePoint110Rub: требуется неотрицательное конечное число`);
  }
  const sewerMainPerMeterRub = value.sewerMainPerMeterRub;
  if (
    typeof sewerMainPerMeterRub !== "number" ||
    !Number.isFinite(sewerMainPerMeterRub) ||
    sewerMainPerMeterRub < 0
  ) {
    issues.push(`${path}.sewerMainPerMeterRub: требуется неотрицательное конечное число`);
  }
  const standpipeRub = value.standpipeRub;
  if (
    typeof standpipeRub !== "number" ||
    !Number.isFinite(standpipeRub) ||
    standpipeRub < 0
  ) {
    issues.push(`${path}.standpipeRub: требуется неотрицательное конечное число`);
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
    sewagePoint50Rub: sewagePoint50Rub as number,
    sewagePoint110Rub: sewagePoint110Rub as number,
    sewerMainPerMeterRub: sewerMainPerMeterRub as number,
    standpipeRub: standpipeRub as number,
    markupPercent,
  };
}

export function parseSewageWorkPricesDraft(value: unknown, path = "workPrices"): SewageWorkPricesDraft {
  if (!record(value)) {
    throw new InputValidationError([`${path}: требуется объект { baseRevision, ...prices }`]);
  }
  const issues: string[] = [];
  const baseRevision = value.baseRevision;
  if (typeof baseRevision !== "number" || !Number.isSafeInteger(baseRevision) || baseRevision < 0) {
    issues.push(`${path}.baseRevision: требуется неотрицательное целое`);
  }
  const prices = parseSewageWorkPrices(value, path);
  if (issues.length > 0) throw new InputValidationError(issues);
  return { baseRevision: baseRevision as number, prices };
}
