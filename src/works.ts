import { workDefinitions } from "./config.js";
import { lineTotalKopecks } from "./money.js";
import { InputValidationError } from "./validation.js";

export type WorkId = typeof workDefinitions[number]["id"];
export interface WorkPriceDraft {
  baseRevision: number;
  prices: { id: WorkId; priceRub: number }[];
}
export class WorkPriceConflictError extends Error {}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function parseWorkPriceDraft(value: unknown): WorkPriceDraft {
  if (!record(value) || Object.keys(value).some((key) => !["baseRevision", "prices"].includes(key)) ||
      typeof value.baseRevision !== "number" || !Number.isSafeInteger(value.baseRevision) || value.baseRevision < 0 ||
      !Array.isArray(value.prices) || value.prices.length !== workDefinitions.length) {
    throw new InputValidationError(["Укажите версию справочника и цены всех пяти работ"]);
  }
  const seen = new Set<string>();
  const prices = value.prices.map((item: unknown) => {
    if (!record(item) || Object.keys(item).some((key) => !["id", "priceRub"].includes(key)) ||
        typeof item.id !== "string" || !workDefinitions.some((work) => work.id === item.id) || seen.has(item.id)) {
      throw new InputValidationError(["Неизвестная или повторяющаяся работа; можно изменять только цены"]);
    }
    if (typeof item.priceRub !== "number" || !Number.isFinite(item.priceRub) || item.priceRub < 0 ||
        !/^\d+(\.\d{1,2})?$/.test(String(item.priceRub))) {
      throw new InputValidationError(["Цена должна быть неотрицательным числом с точностью до копейки"]);
    }
    if (lineTotalKopecks(item.priceRub, 1) / 100 !== item.priceRub) {
      throw new InputValidationError(["Цена превышает точный денежный диапазон"]);
    }
    seen.add(item.id);
    return { id: item.id as WorkId, priceRub: item.priceRub };
  });
  return { baseRevision: value.baseRevision, prices };
}
