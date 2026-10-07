import { InputValidationError } from "./validation.js";

export interface MaterialSelection {
  productId: string;
  quantity: number;
  expectedUnit: string;
}

export interface MaterialsDraft {
  baseVersionId: string | null;
  items: MaterialSelection[];
}

export interface MaterialLine {
  productId: string;
  quantity: number;
  name: string;
  category: string;
  article: string | null;
  unit: string;
  priceRub: number | null;
  source: string;
  url: string;
  catalogUpdatedAt: string;
  catalogImportId: string;
  lineTotalKopecks: number | null;
}

export interface MaterialVersion {
  id: string;
  organizationId: string;
  objectId: string;
  baseVersionId: string | null;
  versionNumber: number;
  createdAt: string;
  items: MaterialLine[];
  knownTotalKopecks: number;
  unpricedCount: number;
  zeroPriceCount: number;
}

export type MaterialVersionSummary = {
  id: string;
  versionNumber: number;
  createdAt: string;
  itemCount: number;
  knownTotalKopecks: number;
  unpricedCount: number;
  zeroPriceCount: number;
};

export interface MaterialCollection {
  object: { id: string; name: string | null; address: string; clientName: string };
  versions: MaterialVersionSummary[];
  latest: MaterialVersion | null;
}

export class MaterialConflictError extends Error {}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && value.length <= 100;
}

export function parseMaterialsDraft(value: unknown): MaterialsDraft {
  if (!record(value)) throw new InputValidationError(["Материалы должны быть JSON-объектом"]);
  const issues: string[] = [];
  if (Object.keys(value).some((key) => !["baseVersionId", "items"].includes(key))) issues.push("Неизвестные поля материалов; цены и суммы задаёт только сервер");
  if (value.baseVersionId !== null && !validId(value.baseVersionId)) issues.push("baseVersionId должен быть ID версии или null");
  if (!Array.isArray(value.items) || value.items.length > 500) throw new InputValidationError([...issues, "items должен быть массивом не более 500 строк"]);
  const items: MaterialSelection[] = [];
  const seen = new Set<string>();
  value.items.forEach((item: unknown, index) => {
    const prefix = `items[${index}]`;
    if (!record(item)) { issues.push(`${prefix}: нужна строка материалов`); return; }
    if (Object.keys(item).some((key) => !["productId", "quantity", "expectedUnit"].includes(key))) issues.push(`${prefix}: неизвестные поля; цены и суммы задаёт только сервер`);
    if (!validId(item.productId)) issues.push(`${prefix}.productId: нужен ID товара`);
    if (typeof item.quantity !== "number" || !Number.isFinite(item.quantity) || item.quantity <= 0) issues.push(`${prefix}.quantity: нужно конечное число больше нуля`);
    if (typeof item.expectedUnit !== "string" || item.expectedUnit.trim() === "" || item.expectedUnit.length > 1000) issues.push(`${prefix}.expectedUnit: нужна исходная единица товара`);
    if (validId(item.productId)) {
      if (seen.has(item.productId)) issues.push(`${prefix}: товар повторяется; измените количество в одной строке`);
      seen.add(item.productId);
    }
    if (validId(item.productId) && typeof item.quantity === "number" && typeof item.expectedUnit === "string") {
      items.push({ productId: item.productId, quantity: item.quantity, expectedUnit: item.expectedUnit });
    }
  });
  if (issues.length > 0) throw new InputValidationError(issues);
  return { baseVersionId: value.baseVersionId as string | null, items };
}

export { lineTotalKopecks } from "./money.js";
