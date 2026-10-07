import { InputValidationError } from "./validation.js";

export const CATALOG_PAGE_SIZE = 50;

export interface CatalogQuery {
  query: string;
  category: string;
  page: number;
}

export function parseCatalogQuery(params: URLSearchParams): CatalogQuery {
  const issues: string[] = [];
  for (const key of new Set(params.keys())) {
    if (!["query", "category", "page"].includes(key)) issues.push(`Неизвестный параметр: ${key}`);
    if (params.getAll(key).length > 1) issues.push(`Параметр ${key} передан несколько раз`);
  }
  const query = (params.get("query") ?? "").trim();
  const category = (params.get("category") ?? "").trim();
  const rawPage = params.get("page") ?? "1";
  const page = Number(rawPage);
  if (query.length > 200) issues.push("Поисковая строка не должна превышать 200 символов");
  if (category.length > 1000) issues.push("Категория не должна превышать 1000 символов");
  if (!/^[1-9]\d*$/.test(rawPage) || !Number.isSafeInteger(page) || !Number.isSafeInteger((page - 1) * CATALOG_PAGE_SIZE)) {
    issues.push("Номер страницы должен быть положительным целым числом в допустимом диапазоне");
  }
  if (issues.length > 0) throw new InputValidationError(issues);
  return { query, category, page };
}
