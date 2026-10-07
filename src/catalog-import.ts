import { readSheet } from "read-excel-file/node";

const headers = ["Категория", "Название", "Артикул", "Цена, ₽", "Единица", "URL"];

export class CatalogFormatError extends Error {}

export interface CatalogProductPreview {
  row: number;
  category: string;
  name: string;
  article: string | null;
  priceRub: number | null;
  unit: string;
  url: string;
}

export interface CatalogIssue {
  row: number;
  column: string;
  code: string;
  message: string;
}

export interface CatalogPreview {
  source: "san-baza.ru";
  rowCount: number;
  products: CatalogProductPreview[];
  issues: CatalogIssue[];
  missingArticleCount: number;
  missingPriceCount: number;
  zeroPriceCount: number;
  repeatedArticleCount: number;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function empty(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

function isProductUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "san-baza.ru" && url.port === ""
      && url.username === "" && url.password === "" && url.search === "" && url.hash === ""
      && url.pathname.startsWith("/catalog/") && url.pathname.length > "/catalog/".length;
  } catch {
    return false;
  }
}

/** Read-only format check, not engineering approval or permission to import. */
export async function previewSanBazaCatalog(filePath: string): Promise<CatalogPreview> {
  let rows;
  try {
    rows = await readSheet(filePath, "Каталог", { trim: false });
  } catch (error: unknown) {
    // Keep filesystem failures distinct from an unsupported workbook.
    if (error instanceof Error && "code" in error && ["ENOENT", "EACCES", "EPERM", "EISDIR"].includes(String(error.code))) {
      throw error;
    }
    throw new CatalogFormatError("Не удалось прочитать XLSX с листом «Каталог».", { cause: error });
  }
  const header = rows[3];
  if (!header || headers.some((value, index) => text(header[index]) !== value)
    || header.slice(headers.length).some((value) => !empty(value))) {
    throw new CatalogFormatError(`Ожидаются колонки в строке 4: ${headers.join("; ")}.`);
  }

  const products: CatalogProductPreview[] = [];
  const issues: CatalogIssue[] = [];
  const urlRows = new Map<string, number[]>();
  let rowCount = 0;
  for (const [index, cells] of rows.entries()) {
    if (index < 4 || cells.every(empty)) continue;
    rowCount++;
    const row = index + 1;
    const addIssue = (column: string, code: string, message: string): void => {
      issues.push({ row, column, code, message });
    };
    const before = issues.length;
    for (const [column, position] of [["A", 0], ["B", 1], ["E", 4]] as const) {
      if (text(cells[position]) === "") addIssue(column, "REQUIRED_TEXT", "Нужно непустое текстовое значение.");
    }
    if (!empty(cells[2]) && typeof cells[2] !== "string") {
      addIssue("C", "INVALID_ARTICLE", "Артикул должен быть текстом: числовая ячейка может терять ведущие нули.");
    }
    const price = cells[3];
    if (!empty(price) && (typeof price !== "number" || !Number.isFinite(price) || price < 0)) {
      addIssue("D", "INVALID_PRICE", "Цена должна быть числовой ячейкой с конечным значением ≥ 0 либо пустой.");
    }
    const url = text(cells[5]);
    if (!isProductUrl(url)) {
      addIssue("F", "INVALID_URL", "Нужна HTTPS-ссылка на товар san-baza.ru/catalog/ без параметров и учётных данных.");
    } else {
      const key = new URL(url).href;
      const occurrences = urlRows.get(key) ?? [];
      occurrences.push(row);
      urlRows.set(key, occurrences);
    }
    if (cells.slice(headers.length).some((value) => !empty(value))) {
      addIssue("G+", "EXTRA_COLUMNS", "Есть данные за пределами согласованного формата A–F.");
    }
    if (issues.length === before) {
      products.push({
        row,
        category: text(cells[0]),
        name: text(cells[1]),
        article: text(cells[2]) || null,
        priceRub: typeof price === "number" ? price : null,
        unit: text(cells[4]),
        url,
      });
    }
  }
  if (rowCount === 0) throw new CatalogFormatError("На листе «Каталог» нет товаров после строки 4.");

  const conflictingRows = new Set<number>();
  for (const occurrences of urlRows.values()) {
    if (occurrences.length < 2) continue;
    for (const row of occurrences) {
      conflictingRows.add(row);
      issues.push({ row, column: "F", code: "DUPLICATE_URL", message: "URL повторяется в файле; ни одна из конфликтующих строк не выбрана." });
    }
  }
  const validProducts = products.filter((product) => !conflictingRows.has(product.row));
  const articleCounts = new Map<string, number>();
  for (const product of validProducts) {
    if (product.article !== null) articleCounts.set(product.article, (articleCounts.get(product.article) ?? 0) + 1);
  }
  return {
    source: "san-baza.ru",
    rowCount,
    products: validProducts,
    issues: issues.sort((left, right) => left.row - right.row || left.column.localeCompare(right.column)),
    missingArticleCount: validProducts.filter((product) => product.article === null).length,
    missingPriceCount: validProducts.filter((product) => product.priceRub === null).length,
    zeroPriceCount: validProducts.filter((product) => product.priceRub === 0).length,
    repeatedArticleCount: [...articleCounts.values()].filter((count) => count > 1).length,
  };
}
