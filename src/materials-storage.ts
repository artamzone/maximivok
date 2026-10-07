import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { LOCAL_ORGANIZATION_ID } from "./projects.js";
import { InputValidationError } from "./validation.js";
import {
  lineTotalKopecks, MaterialConflictError,
  type MaterialCollection, type MaterialLine, type MaterialsDraft, type MaterialVersion, type MaterialVersionSummary,
} from "./materials.js";

const schema = `CREATE TABLE IF NOT EXISTS object_material_versions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  object_id TEXT NOT NULL REFERENCES client_objects(id),
  version_number INTEGER NOT NULL CHECK(version_number > 0),
  created_at TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  UNIQUE(organization_id, object_id, version_number)
)`;

type SnapshotRow = { snapshot_json: string };
type ProductRow = {
  id: string; name: string; category: string; article: string | null; unit: string;
  price_rub: number | null; source: string; source_url: string; updated_at: string; last_import_id: string;
};

/** Shares the project connection, so object checks and snapshots use one transaction. */
export class MaterialStore {
  public constructor(private readonly database: DatabaseSync) {}

  #hasTable(name: string): boolean {
    return this.database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;
  }

  #object(objectId: string): MaterialCollection["object"] | null {
    const row = this.database.prepare(`
      SELECT o.id, o.name, o.address, c.name AS clientName FROM client_objects o
      JOIN clients c ON c.id = o.client_id AND c.organization_id = o.organization_id
      WHERE o.id = ? AND o.organization_id = ?
    `).get(objectId, LOCAL_ORGANIZATION_ID) as MaterialCollection["object"] | undefined;
    return row ?? null;
  }

  #latest(objectId: string): MaterialVersion | null {
    if (!this.#hasTable("object_material_versions")) return null;
    const row = this.database.prepare(`SELECT snapshot_json FROM object_material_versions
      WHERE object_id = ? AND organization_id = ? ORDER BY version_number DESC LIMIT 1`)
      .get(objectId, LOCAL_ORGANIZATION_ID) as SnapshotRow | undefined;
    return row ? JSON.parse(row.snapshot_json) as MaterialVersion : null;
  }

  public getCollection(objectId: string): MaterialCollection | null {
    const object = this.#object(objectId);
    if (object === null) return null;
    const versions = this.#hasTable("object_material_versions") ? this.database.prepare(`
      SELECT id, version_number AS versionNumber, created_at AS createdAt,
        json_array_length(snapshot_json, '$.items') AS itemCount,
        json_extract(snapshot_json, '$.knownTotalKopecks') AS knownTotalKopecks,
        json_extract(snapshot_json, '$.unpricedCount') AS unpricedCount,
        json_extract(snapshot_json, '$.zeroPriceCount') AS zeroPriceCount
      FROM object_material_versions WHERE object_id = ? AND organization_id = ? ORDER BY version_number DESC
    `).all(objectId, LOCAL_ORGANIZATION_ID) as MaterialVersionSummary[] : [];
    return { object, latest: this.#latest(objectId), versions };
  }

  public getVersion(objectId: string, versionId: string): MaterialVersion | null {
    if (this.#object(objectId) === null || !this.#hasTable("object_material_versions")) return null;
    const row = this.database.prepare(`SELECT snapshot_json FROM object_material_versions
      WHERE id = ? AND object_id = ? AND organization_id = ?`)
      .get(versionId, objectId, LOCAL_ORGANIZATION_ID) as SnapshotRow | undefined;
    return row ? JSON.parse(row.snapshot_json) as MaterialVersion : null;
  }

  /** Receives a validated draft. All product attributes and prices come from SQLite, not the client. */
  public save(objectId: string, draft: MaterialsDraft): MaterialVersion | null {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (this.#object(objectId) === null) {
        this.database.exec("ROLLBACK");
        return null;
      }
      const previous = this.#latest(objectId);
      if ((previous?.id ?? null) !== draft.baseVersionId) {
        throw new MaterialConflictError("Материалы уже изменены в другой вкладке. Загрузите последнюю версию; ваш черновик пока сохранён на экране.");
      }
      const hasCatalog = this.#hasTable("catalog_products");
      const find = hasCatalog ? this.database.prepare(`SELECT * FROM catalog_products
        WHERE id = ? AND organization_id = ? AND source = 'san-baza.ru'`) : null;
      const items: MaterialLine[] = draft.items.map((item, index) => {
        const product = find?.get(item.productId, LOCAL_ORGANIZATION_ID) as ProductRow | undefined;
        if (!product) throw new InputValidationError([`items[${index}]: товар не найден в каталоге организации`]);
        if (product.unit !== item.expectedUnit) throw new MaterialConflictError("Единица одного из товаров изменилась. Удалите его из черновика и выберите заново, проверив количество.");
        return {
          productId: product.id, quantity: item.quantity, name: product.name, category: product.category,
          article: product.article, unit: product.unit, priceRub: product.price_rub, source: product.source,
          url: product.source_url, catalogUpdatedAt: product.updated_at, catalogImportId: product.last_import_id,
          lineTotalKopecks: product.price_rub === null ? null : lineTotalKopecks(product.price_rub, item.quantity),
        };
      });
      const knownTotal = items.reduce((sum, item) => sum + BigInt(item.lineTotalKopecks ?? 0), 0n);
      if (knownTotal > BigInt(Number.MAX_SAFE_INTEGER)) throw new InputValidationError(["Итоговая стоимость превышает допустимый диапазон"]);
      const version: MaterialVersion = {
        id: randomUUID(), organizationId: LOCAL_ORGANIZATION_ID, objectId, baseVersionId: draft.baseVersionId,
        versionNumber: (previous?.versionNumber ?? 0) + 1, createdAt: new Date().toISOString(), items,
        knownTotalKopecks: Number(knownTotal), unpricedCount: items.filter((item) => item.priceRub === null).length,
        zeroPriceCount: items.filter((item) => item.priceRub === 0).length,
      };
      this.database.exec(schema);
      this.database.prepare(`INSERT INTO object_material_versions
        (id, organization_id, object_id, version_number, created_at, snapshot_json) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(version.id, LOCAL_ORGANIZATION_ID, objectId, version.versionNumber, version.createdAt, JSON.stringify(version));
      this.database.exec("COMMIT");
      return version;
    } catch (error: unknown) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}
