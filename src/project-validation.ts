import type {
  CalculationDraft,
  ClientDraft,
  CreateObjectDraft,
  ObjectDraft,
  ParameterMetadataDraft,
  ParameterSource,
} from "./projects.js";
import { InputValidationError, parseHeatingInput } from "./validation.js";

const inputSources = new Set<ParameterSource>(["", "client", "engineer", "project_document"]);
const inputStatuses = new Set(["unverified", "confirmed", "requires_engineer_review"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, path: string, issues: string[], maxLength: number): string {
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(`${path}: требуется непустая строка`);
    return "";
  }
  const result = value.trim();
  if (result.length > maxLength) issues.push(`${path}: длина не должна превышать ${maxLength} символов`);
  return result;
}

function optionalString(value: unknown, path: string, issues: string[], maxLength: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    issues.push(`${path}: ожидается строка`);
    return null;
  }
  const result = value.trim();
  if (result === "") return null;
  if (result.length > maxLength) issues.push(`${path}: длина не должна превышать ${maxLength} символов`);
  return result;
}

function parseClient(value: unknown, issues: string[]): ClientDraft {
  if (!isRecord(value)) {
    issues.push("client: ожидается объект");
    value = {};
  }
  const record = value as Record<string, unknown>;
  return {
    name: requiredString(record.name, "client.name", issues, 200),
    phone: optionalString(record.phone, "client.phone", issues, 100),
    email: optionalString(record.email, "client.email", issues, 200),
    notes: optionalString(record.notes, "client.notes", issues, 2_000),
  };
}

function parseObject(value: unknown, issues: string[]): ObjectDraft {
  if (!isRecord(value)) {
    issues.push("object: ожидается объект");
    value = {};
  }
  const record = value as Record<string, unknown>;
  return {
    address: requiredString(record.address, "object.address", issues, 500),
    name: optionalString(record.name, "object.name", issues, 200),
    notes: optionalString(record.notes, "object.notes", issues, 2_000),
  };
}

function parseParameterMetadata(value: unknown, issues: string[]): ParameterMetadataDraft[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issues.push("calculation.parameterMetadata: ожидается массив");
    return [];
  }
  const result: ParameterMetadataDraft[] = [];
  const paths = new Set<string>();
  value.forEach((item, index) => {
    const path = `calculation.parameterMetadata[${index}]`;
    if (!isRecord(item)) {
      issues.push(`${path}: ожидается объект`);
      return;
    }
    const parameterPath = requiredString(item.path, `${path}.path`, issues, 500);
    const source = item.source;
    const verificationStatus = item.verificationStatus;
    if (typeof source !== "string" || !inputSources.has(source as ParameterSource)) {
      issues.push(`${path}.source: неизвестный источник`);
      return;
    }
    if (typeof verificationStatus !== "string" || !inputStatuses.has(verificationStatus)) {
      issues.push(`${path}.verificationStatus: неизвестный статус`);
      return;
    }
    if (paths.has(parameterPath)) {
      issues.push(`${path}.path: путь параметра должен быть уникальным`);
      return;
    }
    paths.add(parameterPath);
    result.push({
      path: parameterPath,
      source: source as ParameterMetadataDraft["source"],
      verificationStatus: verificationStatus as ParameterMetadataDraft["verificationStatus"],
    });
  });
  return result;
}

function leafPaths(value: unknown, prefix: string): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => leafPaths(item, `${prefix}[${index}]`));
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, item]) => leafPaths(item, `${prefix}.${key}`));
  }
  return [prefix];
}

function parseCalculation(value: unknown, issues: string[]): CalculationDraft {
  if (!isRecord(value)) {
    issues.push("calculation: ожидается объект");
    value = {};
  }
  const record = value as Record<string, unknown>;
  let input;
  try {
    input = parseHeatingInput(record.input);
  } catch (error: unknown) {
    if (error instanceof InputValidationError) issues.push(...error.issues.map((issue) => `calculation.input.${issue}`));
    else throw error;
  }
  const parameterMetadata = parseParameterMetadata(record.parameterMetadata, issues);
  if (input !== undefined) {
    const validPaths = new Set(leafPaths(input, "input"));
    for (const metadata of parameterMetadata) {
      if (!validPaths.has(metadata.path)) {
        issues.push(`calculation.parameterMetadata: параметр ${metadata.path} отсутствует во входных данных`);
      }
    }
  }
  if (input === undefined) {
    input = parseHeatingInput({
      houseAreaM2: 1,
      rooms: [{ id: "invalid", name: "invalid", areaM2: 1, ceilingHeightM: 1, hasStandardWindows: false, hasPanoramicWindows: false, floorHeatingAreaM2: 0, hasRadiator: false }],
      heatSource: "unknown",
      availableElectricPowerKw: null,
      residents: 0,
      baths: 0,
      showers: 0,
      includeIndirectWaterHeater: false,
    });
  }
  return { input, parameterMetadata };
}

export function parseCreateObjectDraft(value: unknown): CreateObjectDraft {
  const issues: string[] = [];
  if (!isRecord(value)) throw new InputValidationError(["ожидается JSON-объект"]);
  const result = {
    client: parseClient(value.client, issues),
    object: parseObject(value.object, issues),
    calculation: value.calculation === undefined ? null : parseCalculation(value.calculation, issues),
  };
  if (issues.length > 0) throw new InputValidationError(issues);
  return result;
}

export function parseObjectCardDraft(value: unknown): { client: ClientDraft; object: ObjectDraft } {
  const issues: string[] = [];
  if (!isRecord(value)) throw new InputValidationError(["ожидается JSON-объект"]);
  const result = { client: parseClient(value.client, issues), object: parseObject(value.object, issues) };
  if (issues.length > 0) throw new InputValidationError(issues);
  return result;
}

export function parseCalculationDraft(value: unknown): CalculationDraft {
  const issues: string[] = [];
  const result = parseCalculation(value, issues);
  if (issues.length > 0) throw new InputValidationError(issues);
  return result;
}
