import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { basename, dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { previewSanBazaCatalog, type CatalogPreview, type CatalogIssue } from "./catalog-import.js";
import { LOCAL_ORGANIZATION_ID } from "./projects.js";
import { CATALOG_PAGE_SIZE, type CatalogQuery } from "./catalog-query.js";

// The organizations table has the same definition as the existing project store.
// Only new catalog tables are added; project tables and reports are not migrated.
const schema = `
  CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS catalog_imports (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    imported_at TEXT NOT NULL,
    report_json TEXT NOT NULL CHECK (json_valid(report_json)),
    UNIQUE(id, organization_id)
  );
  CREATE TABLE IF NOT EXISTS catalog_products (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    source TEXT NOT NULL,
    source_url TEXT NOT NULL,
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    article TEXT,
    price_rub REAL CHECK (price_rub IS NULL OR price_rub >= 0),
    unit TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_import_id TEXT NOT NULL,
    UNIQUE(organization_id, source, source_url),
    FOREIGN KEY(last_import_id, organization_id) REFERENCES catalog_imports(id, organization_id)
  );
  CREATE INDEX IF NOT EXISTS idx_catalog_imports_organization
    ON catalog_imports(organization_id, imported_at DESC);
`;

export interface SavedCatalogImport {
  id: string;
  organizationId: string;
  source: "san-baza.ru";
  fileName: string;
  importedAt: string;
  rowCount: number;
  importedRows: number;
  skippedRows: number;
  insertedRows: number;
  updatedRows: number;
  missingArticleCount: number;
  missingPriceCount: number;
  zeroPriceCount: number;
  repeatedArticleCount: number;
  issues: CatalogIssue[];
}

export interface SavedCatalogProduct {
  id: string;
  organizationId: string;
  source: string;
  url: string;
  category: string;
  name: string;
  article: string | null;
  priceRub: number | null;
  unit: string;
  updatedAt: string;
  lastImportId: string;
}

type ProductRow = {
  id: string;
  organization_id: string;
  source: string;
  source_url: string;
  category: string;
  name: string;
  article: string | null;
  price_rub: number | null;
  unit: string;
  updated_at: string;
  last_import_id: string;
};

type ImportRow = { report_json: string };

export interface CatalogPage {
  products: SavedCatalogProduct[];
  total: number;
  catalogTotal: number;
  categories: string[];
  page: number;
  pageSize: number;
}

function mapProduct(row: ProductRow): SavedCatalogProduct {
  return {
    id: row.id,
    organizationId: row.organization_id,
    source: row.source,
    url: row.source_url,
    category: row.category,
    name: row.name,
    article: row.article,
    priceRub: row.price_rub,
    unit: row.unit,
    updatedAt: row.updated_at,
    lastImportId: row.last_import_id,
  };
}

export class SqliteCatalogRepository {
  readonly #database: DatabaseSync;
  #closed = false;

  public constructor(databasePath: string, options: { readOnly?: boolean } = {}) {
    if (!options.readOnly && databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
    this.#database = new DatabaseSync(databasePath, { readOnly: options.readOnly ?? false });
    try {
      this.#database.exec("PRAGMA foreign_keys = ON;");
      // SQLite's built-in lower()/NOCASE do not fold Cyrillic characters.
      this.#database.function("catalog_lower", { deterministic: true }, (value) =>
        typeof value === "string" ? value.toLowerCase() : "");
      if (!options.readOnly) {
        this.#database.exec(schema);
        this.#database.prepare("INSERT OR IGNORE INTO organizations (id, name) VALUES (?, ?)")
          .run(LOCAL_ORGANIZATION_ID, "Локальная организация ИВОК");
      }
    } catch (error: unknown) {
      this.#database.close();
      throw error;
    }
  }

  /** Receives validated rows only. CLI/file callers must use importSanBazaCatalog. */
  public saveImport(preview: CatalogPreview, fileName: string): SavedCatalogImport {
    const report: SavedCatalogImport = {
      id: randomUUID(),
      organizationId: LOCAL_ORGANIZATION_ID,
      source: preview.source,
      fileName: basename(fileName),
      importedAt: new Date().toISOString(),
      rowCount: preview.rowCount,
      importedRows: preview.products.length,
      skippedRows: preview.rowCount - preview.products.length,
      insertedRows: 0,
      updatedRows: 0,
      missingArticleCount: preview.missingArticleCount,
      missingPriceCount: preview.missingPriceCount,
      zeroPriceCount: preview.zeroPriceCount,
      repeatedArticleCount: preview.repeatedArticleCount,
      issues: preview.issues,
    };
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database.prepare(`
        INSERT INTO catalog_imports (id, organization_id, imported_at, report_json) VALUES (?, ?, ?, ?)
      `).run(report.id, report.organizationId, report.importedAt, JSON.stringify(report));
      const findProduct = this.#database.prepare(`
        SELECT id FROM catalog_products WHERE organization_id = ? AND source = ? AND source_url = ?
      `);
      const upsert = this.#database.prepare(`
        INSERT INTO catalog_products
          (id, organization_id, source, source_url, category, name, article, price_rub, unit, updated_at, last_import_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(organization_id, source, source_url) DO UPDATE SET
          category = excluded.category, name = excluded.name, article = excluded.article,
          price_rub = excluded.price_rub, unit = excluded.unit, updated_at = excluded.updated_at,
          last_import_id = excluded.last_import_id
      `);
      for (const product of preview.products) {
        const url = new URL(product.url).href;
        const exists = findProduct.get(LOCAL_ORGANIZATION_ID, preview.source, url) !== undefined;
        upsert.run(
          randomUUID(), LOCAL_ORGANIZATION_ID, preview.source, url, product.category,
          product.name, product.article, product.priceRub, product.unit, report.importedAt, report.id,
        );
        if (exists) report.updatedRows++;
        else report.insertedRows++;
      }
      this.#database.prepare("UPDATE catalog_imports SET report_json = ? WHERE id = ? AND organization_id = ?")
        .run(JSON.stringify(report), report.id, LOCAL_ORGANIZATION_ID);
      this.#database.exec("COMMIT");
      return report;
    } catch (error: unknown) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  public getProduct(url: string): SavedCatalogProduct | null {
    const row = this.#database.prepare(`
      SELECT * FROM catalog_products WHERE organization_id = ? AND source = ? AND source_url = ?
    `).get(LOCAL_ORGANIZATION_ID, "san-baza.ru", new URL(url).href) as ProductRow | undefined;
    return row ? mapProduct(row) : null;
  }

  /** Validated HTTP query; browsing never creates or migrates catalog tables. */
  public searchProducts(query: CatalogQuery): CatalogPage {
    const result: CatalogPage = {
      products: [], total: 0, catalogTotal: 0, categories: [], page: query.page, pageSize: CATALOG_PAGE_SIZE,
    };
    this.#database.exec("BEGIN");
    try {
      const exists = this.#database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'catalog_products'").get();
      if (exists) {
        const categoryRows = this.#database.prepare(`
          SELECT category, COUNT(*) AS count FROM catalog_products
          WHERE organization_id = ? AND source = ? GROUP BY category ORDER BY catalog_lower(category), category
        `).all(LOCAL_ORGANIZATION_ID, "san-baza.ru") as { category: string; count: number }[];
        result.categories = categoryRows.map((row) => row.category);
        result.catalogTotal = categoryRows.reduce((sum, row) => sum + row.count, 0);
        const where = `organization_id = ? AND source = ? AND (? = '' OR category = ?)
          AND (? = '' OR instr(catalog_lower(name), ?) > 0 OR instr(catalog_lower(article), ?) > 0)`;
        const needle = query.query.toLowerCase();
        const args = [LOCAL_ORGANIZATION_ID, "san-baza.ru", query.category, query.category, needle, needle, needle];
        result.total = (this.#database.prepare(`SELECT COUNT(*) AS count FROM catalog_products WHERE ${where}`)
          .get(...args) as { count: number }).count;
        const rows = this.#database.prepare(`SELECT * FROM catalog_products WHERE ${where}
          ORDER BY catalog_lower(name), source_url LIMIT ? OFFSET ?`)
          .all(...args, CATALOG_PAGE_SIZE, (query.page - 1) * CATALOG_PAGE_SIZE) as ProductRow[];
        result.products = rows.map(mapProduct);
      }
      this.#database.exec("COMMIT");
      return result;
    } catch (error: unknown) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  public countProducts(): number {
    const row = this.#database.prepare("SELECT COUNT(*) AS count FROM catalog_products WHERE organization_id = ?")
      .get(LOCAL_ORGANIZATION_ID) as { count: number };
    return row.count;
  }

  public getImport(id: string): SavedCatalogImport | null {
    const row = this.#database.prepare("SELECT report_json FROM catalog_imports WHERE id = ? AND organization_id = ?")
      .get(id, LOCAL_ORGANIZATION_ID) as ImportRow | undefined;
    return row ? JSON.parse(row.report_json) as SavedCatalogImport : null;
  }

  public listImports(): SavedCatalogImport[] {
    const rows = this.#database.prepare(`
      SELECT report_json FROM catalog_imports WHERE organization_id = ? ORDER BY imported_at DESC, rowid DESC
    `).all(LOCAL_ORGANIZATION_ID) as ImportRow[];
    return rows.map((row) => JSON.parse(row.report_json) as SavedCatalogImport);
  }

  public close(): void {
    if (!this.#closed) {
      this.#database.close();
      this.#closed = true;
    }
  }
}

/** Validate before opening the database so an unreadable file cannot create a database. */
export async function importSanBazaCatalog(filePath: string, databasePath: string): Promise<SavedCatalogImport> {
  const preview = await previewSanBazaCatalog(filePath);
  const repository = new SqliteCatalogRepository(databasePath);
  try {
    return repository.saveImport(preview, basename(filePath));
  } finally {
    repository.close();
  }
}
