import type { CatalogPreview } from "../../src/catalog-import.js";

/** Synthetic records for HTTP and browser tests, not engineering reference data. */
export function searchCatalogFixture(): CatalogPreview {
  return {
    source: "san-baza.ru",
    rowCount: 55,
    products: Array.from({ length: 55 }, (_, index) => ({
      row: index + 5,
      category: index % 2 === 0 ? "Отопление" : "Котлы",
      name: index === 0
        ? 'Труба 100%_ <img src=x onerror="globalThis.catalogInjected=true">'
        : `Радиатор ${String(index).padStart(2, "0")}`,
      article: index === 0 ? "АРТ-АБВ" : index === 1 ? null : `R-${index}`,
      priceRub: index === 1 ? null : index === 2 ? 0 : 2.5,
      unit: index === 0 ? "м.п." : "шт",
      url: `https://san-baza.ru/catalog/test/${index}/`,
    })),
    issues: [],
    missingArticleCount: 1,
    missingPriceCount: 1,
    zeroPriceCount: 1,
    repeatedArticleCount: 0,
  };
}
