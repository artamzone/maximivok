import type { HeatSource, HeatingInput, RoomInput } from "./types.js";

const heatSources = new Set<HeatSource>(["gas", "electric", "solid_fuel", "pellet", "unknown"]);

export class InputValidationError extends Error {
  public constructor(public readonly issues: string[]) {
    super(`Некорректные входные данные:\n- ${issues.join("\n- ")}`);
    this.name = "InputValidationError";
  }
}

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

function requireBoolean(value: unknown, path: string, issues: string[]): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "boolean") {
    issues.push(`${path}: требуется true или false`);
    return false;
  }
  return value;
}

function requireNumber(
  value: unknown,
  path: string,
  issues: string[],
  options: { min: number; integer?: boolean },
): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push(`${path}: требуется конечное число`);
    return options.min;
  }
  if (value < options.min) issues.push(`${path}: значение должно быть не меньше ${options.min}`);
  if (options.integer === true && !Number.isInteger(value)) issues.push(`${path}: требуется целое число`);
  return value;
}

function parseRoom(value: unknown, index: number, issues: string[]): RoomInput {
  const path = `rooms[${index}]`;
  if (!isRecord(value)) {
    issues.push(`${path}: требуется объект`);
    return {
      id: "",
      name: "",
      areaM2: 0,
      ceilingHeightM: 0,
      hasStandardWindows: false,
      hasPanoramicWindows: false,
      floorHeatingAreaM2: 0,
      hasRadiator: false,
    };
  }

  const areaM2 = requireNumber(value.areaM2, `${path}.areaM2`, issues, { min: 0.01 });
  const floorHeatingAreaM2 = requireNumber(
    value.floorHeatingAreaM2,
    `${path}.floorHeatingAreaM2`,
    issues,
    { min: 0 },
  );
  if (floorHeatingAreaM2 !== null && areaM2 !== null && floorHeatingAreaM2 > areaM2) {
    issues.push(`${path}.floorHeatingAreaM2: площадь тёплого пола не может превышать площадь помещения`);
  }

  return {
    id: requireString(value.id, `${path}.id`, issues),
    name: requireString(value.name, `${path}.name`, issues),
    areaM2,
    ceilingHeightM: requireNumber(value.ceilingHeightM, `${path}.ceilingHeightM`, issues, { min: 0.01 }),
    hasStandardWindows: requireBoolean(value.hasStandardWindows, `${path}.hasStandardWindows`, issues),
    hasPanoramicWindows: requireBoolean(value.hasPanoramicWindows, `${path}.hasPanoramicWindows`, issues),
    floorHeatingAreaM2,
    hasRadiator: requireBoolean(value.hasRadiator, `${path}.hasRadiator`, issues),
  };
}

export function parseHeatingInput(value: unknown): HeatingInput {
  const issues: string[] = [];
  if (!isRecord(value)) throw new InputValidationError(["корневое значение должно быть объектом"]);

  const rooms = value.rooms === undefined || value.rooms === null
    ? []
    : Array.isArray(value.rooms)
      ? value.rooms.map((room, index) => parseRoom(room, index, issues))
      : (issues.push("rooms: требуется массив помещений"), []);

  const heatSource = typeof value.heatSource === "string" && heatSources.has(value.heatSource as HeatSource)
    ? (value.heatSource as HeatSource)
    : value.heatSource === null || value.heatSource === undefined
      ? "unknown"
      : (issues.push("heatSource: допустимы gas, electric, solid_fuel, pellet, unknown"), "unknown");

  let availableElectricPowerKw: number | null = null;
  if (value.availableElectricPowerKw !== null) {
    availableElectricPowerKw = requireNumber(
      value.availableElectricPowerKw,
      "availableElectricPowerKw",
      issues,
      { min: 0 },
    );
  }

  const result: HeatingInput = {
    houseAreaM2: requireNumber(value.houseAreaM2, "houseAreaM2", issues, { min: 0.01 }),
    rooms,
    heatSource,
    availableElectricPowerKw,
    residents: requireNumber(value.residents, "residents", issues, { min: 0, integer: true }),
    baths: requireNumber(value.baths, "baths", issues, { min: 0, integer: true }),
    showers: requireNumber(value.showers, "showers", issues, { min: 0, integer: true }),
    includeIndirectWaterHeater: requireBoolean(
      value.includeIndirectWaterHeater,
      "includeIndirectWaterHeater",
      issues,
    ),
    ...(value.circuitLengthM === undefined
      ? {}
      : {
          circuitLengthM: requireNumber(value.circuitLengthM, "circuitLengthM", issues, {
            min: 0.01,
          }),
        }),
  };

  const roomArea = rooms.reduce((sum, room) => sum + (room.areaM2 ?? 0), 0);
  if (result.houseAreaM2 !== null && roomArea > result.houseAreaM2 + 0.001) {
    issues.push("rooms: суммарная площадь помещений не может превышать площадь дома");
  }

  const ids = rooms.map((room) => room.id);
  if (new Set(ids).size !== ids.length) issues.push("rooms: идентификаторы помещений должны быть уникальными");

  if (issues.length > 0) throw new InputValidationError(issues);
  return result;
}
