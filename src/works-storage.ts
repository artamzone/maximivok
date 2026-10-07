import type { DatabaseSync } from "node:sqlite";
import type { HeatingWorkPrices } from "./types.js";
import { workDefinitions } from "./config.js";
import { LOCAL_ORGANIZATION_ID } from "./projects.js";
import { parseWorkPriceDraft, WorkPriceConflictError, type WorkPriceDraft } from "./works.js";

export interface WorkCatalog {
  revision: number;
  items: { id: string; name: string; unit: string; priceRub: number; appliedToHeating: boolean }[];
}

export class WorkStore {
  public constructor(private readonly database: DatabaseSync) {}

  public save(value: WorkPriceDraft): WorkCatalog {
    const draft = parseWorkPriceDraft(value);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const current = this.getCatalog();
      if (current.revision !== draft.baseRevision) {
        throw new WorkPriceConflictError("Цены уже изменены в другой вкладке. Загрузите актуальный справочник и повторите изменения.");
      }
      if (draft.prices.every((price) => current.items.find((item) => item.id === price.id)?.priceRub === price.priceRub)) {
        this.database.exec("COMMIT");
        return current;
      }
      this.database.exec(`CREATE TABLE IF NOT EXISTS work_price_versions (
        organization_id TEXT NOT NULL REFERENCES organizations(id),
        revision INTEGER NOT NULL CHECK (revision > 0),
        prices_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (organization_id, revision)
      )`);
      this.database.prepare("INSERT INTO work_price_versions (organization_id, revision, prices_json, created_at) VALUES (?, ?, ?, ?)")
        .run(LOCAL_ORGANIZATION_ID, current.revision + 1, JSON.stringify(draft.prices), new Date().toISOString());
      const result = this.getCatalog();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  public getHeatingPrices(): HeatingWorkPrices {
    const catalog = this.getCatalog();
    return {
      revision: catalog.revision,
      floorHeatingRubPerM2: catalog.items.find((item) => item.id === "floor_heating")!.priceRub,
      insulationRubPerM2: catalog.items.find((item) => item.id === "insulation")!.priceRub,
    };
  }

  public getCatalog(): WorkCatalog {
    const exists = this.database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='work_price_versions'").get();
    const row = exists === undefined ? undefined : this.database.prepare(
      "SELECT revision, prices_json FROM work_price_versions WHERE organization_id = ? ORDER BY revision DESC LIMIT 1",
    ).get(LOCAL_ORGANIZATION_ID) as { revision: number; prices_json: string } | undefined;
    let prices: Record<string, number> | null = null;
    if (row !== undefined) {
      try {
        const draft = parseWorkPriceDraft({ baseRevision: row.revision, prices: JSON.parse(row.prices_json) });
        prices = Object.fromEntries(draft.prices.map((item) => [item.id, item.priceRub]));
      } catch (cause) { throw new Error("Повреждена сохранённая версия цен работ", { cause }); }
    }
    return {
      revision: row?.revision ?? 0,
      items: workDefinitions.map((work) => ({ ...work, priceRub: prices === null ? work.priceRub : prices[work.id]! })),
    };
  }
}
