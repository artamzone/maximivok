import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { MaterialStore } from "./materials-storage.js";
import { WorkStore } from "./works-storage.js";
import type { CalculationStatus, HeatingReport, PlumbingReport, SewageReport } from "./types.js";
import {
  LOCAL_ORGANIZATION_ID,
  type CalculationDraft,
  type ClientDraft,
  type CreateObjectDraft,
  type ObjectDetails,
  type ObjectDraft,
  type ObjectSummary,
  type ParameterMetadataDraft,
  type ParameterVerificationStatus,
  type PlumbingCalculationDraft,
  type ProjectRepository,
  type SavedCalculation,
  type SavedParameterMetadata,
  type SavedPlumbingCalculation,
  type SavedSewageCalculation,
  type SewageCalculationDraft,
} from "./projects.js";

const schema = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS client_objects (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    client_id TEXT NOT NULL REFERENCES clients(id),
    address TEXT NOT NULL,
    name TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS calculations (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    object_id TEXT NOT NULL REFERENCES client_objects(id),
    input_json TEXT NOT NULL,
    report_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    block TEXT NOT NULL DEFAULT 'heating' CHECK (block IN ('heating', 'plumbing', 'sewage')),
    work_prices_json TEXT
  );

  CREATE TABLE IF NOT EXISTS calculation_parameters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    calculation_id TEXT NOT NULL REFERENCES calculations(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('input', 'output')),
    path TEXT NOT NULL,
    source TEXT NOT NULL,
    verification_status TEXT NOT NULL,
    UNIQUE(calculation_id, kind, path)
  );

  CREATE INDEX IF NOT EXISTS idx_clients_organization ON clients(organization_id);
  CREATE INDEX IF NOT EXISTS idx_objects_organization ON client_objects(organization_id);
  CREATE INDEX IF NOT EXISTS idx_calculations_object ON calculations(object_id, created_at DESC);
  -- idx_calculations_object_block создаётся в #migrate() после добавления колонки block,
  -- чтобы на старых БД индекс не падал на отсутствующей колонке.
  CREATE INDEX IF NOT EXISTS idx_parameters_calculation ON calculation_parameters(calculation_id);
`;

type ObjectRow = {
  id: string;
  organization_id: string;
  client_id: string;
  client_name: string;
  client_phone: string | null;
  client_email: string | null;
  client_notes: string | null;
  address: string;
  object_name: string | null;
  object_notes: string | null;
  created_at: string;
  updated_at: string;
};

type CalculationRow = {
  id: string;
  organization_id: string;
  object_id: string;
  input_json: string;
  report_json: string;
  created_at: string;
  block: string;
  work_prices_json: string | null;
};

type ParameterRow = {
  kind: "input" | "output";
  path: string;
  source: SavedParameterMetadata["source"];
  verification_status: ParameterVerificationStatus;
};

type SummaryRow = {
  id: string;
  organization_id: string;
  client_name: string;
  object_name: string | null;
  address: string;
  updated_at: string;
  latest_calculation_at: string | null;
  latest_calculation_status: CalculationStatus | null;
};

function leafPaths(value: unknown, prefix: string): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => leafPaths(item, `${prefix}[${index}]`));
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, item]) => leafPaths(item, prefix === "" ? key : `${prefix}.${key}`));
  }
  return [prefix];
}

function isCalculationStatus(value: unknown): value is CalculationStatus {
  return value === "calculated" || value === "requires_engineer_review" || value === "impossible";
}

export class PlumbingRevisionConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PlumbingRevisionConflictError";
  }
}

export class SewageRevisionConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SewageRevisionConflictError";
  }
}

function outputParameters(
  value: unknown,
  prefix: string,
  inheritedStatus: CalculationStatus,
): SavedParameterMetadata[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => outputParameters(item, `${prefix}[${index}]`, inheritedStatus));
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const status = isCalculationStatus(record.status) ? record.status : inheritedStatus;
    return Object.entries(record).flatMap(([key, item]) => {
      if (prefix === "report" && key === "input") return [];
      return outputParameters(item, `${prefix}.${key}`, status);
    });
  }
  return [{ kind: "output", path: prefix, source: "calculation", verificationStatus: inheritedStatus }];
}

function inputParameters(draft: CalculationDraft): SavedParameterMetadata[] {
  const overrides = new Map<string, ParameterMetadataDraft>(draft.parameterMetadata.map((item) => [item.path, item]));
  return leafPaths(draft.input, "input").map((path) => {
    const metadata = overrides.get(path);
    return {
      kind: "input",
      path,
      source: metadata?.source ?? "engineer",
      verificationStatus: metadata?.verificationStatus ?? "unverified",
    };
  });
}

function mapParameter(row: ParameterRow): SavedParameterMetadata {
  return {
    kind: row.kind,
    path: row.path,
    source: row.source,
    verificationStatus: row.verification_status,
  };
}

export class SqliteProjectRepository implements ProjectRepository {
  public readonly materials: MaterialStore;
  public readonly works: WorkStore;
  readonly #database: DatabaseSync;
  #closed = false;

  public constructor(databasePath: string) {
    if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
    this.#database = new DatabaseSync(databasePath);
    this.materials = new MaterialStore(this.#database);
    this.works = new WorkStore(this.#database);
    this.#database.exec(schema);
    this.#migrate();
    this.#database.prepare("INSERT OR IGNORE INTO organizations (id, name) VALUES (?, ?)").run(
      LOCAL_ORGANIZATION_ID,
      "Локальная организация ИВОК",
    );
  }

  /** Совместимость со старой схемой: добавляет block/work_prices_json, если их нет. */
  #migrate(): void {
    const calculationsColumns = this.#database.prepare("PRAGMA table_info(calculations)").all() as Array<{ name: string }>;
    const names = new Set(calculationsColumns.map((column) => column.name));
    let needsBlockIndex = false;
    if (!names.has("block")) {
      this.#database.exec("ALTER TABLE calculations ADD COLUMN block TEXT NOT NULL DEFAULT 'heating'");
      needsBlockIndex = true;
    }
    if (!names.has("work_prices_json")) {
      this.#database.exec("ALTER TABLE calculations ADD COLUMN work_prices_json TEXT");
    }
    if (needsBlockIndex) {
      this.#database.exec("CREATE INDEX IF NOT EXISTS idx_calculations_object_block ON calculations(object_id, block, created_at DESC)");
    }
    // Расширение CHECK: для новых БД (созданных по schema) уже 'heating'|'plumbing'|'sewage'.
    // Для существующих БД ограничение могло быть 'heating'|'plumbing' — пересоздаём таблицу через 12-шаговый процесс.
    this.#expandBlockCheck();
  }

  /** Расширяет CHECK на calculations.block до 'sewage', если ограничение старое. */
  #expandBlockCheck(): void {
    const row = this.#database.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'calculations'",
    ).get() as { sql: string } | undefined;
    if (row === undefined) return;
    if (row.sql.includes("'sewage'")) return;
    // Сохраняем существующие блоки и добавляем 'sewage' к CHECK.
    this.#database.exec("PRAGMA foreign_keys = OFF");
    try {
      this.#database.exec("BEGIN");
      this.#database.exec(`
        CREATE TABLE calculations_new (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL REFERENCES organizations(id),
          object_id TEXT NOT NULL REFERENCES client_objects(id),
          input_json TEXT NOT NULL,
          report_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          block TEXT NOT NULL DEFAULT 'heating' CHECK (block IN ('heating', 'plumbing', 'sewage')),
          work_prices_json TEXT
        )
      `);
      this.#database.exec(`
        INSERT INTO calculations_new (id, organization_id, object_id, input_json, report_json, created_at, block, work_prices_json)
        SELECT id, organization_id, object_id, input_json, report_json, created_at, block, work_prices_json
        FROM calculations
      `);
      this.#database.exec("DROP TABLE calculations");
      this.#database.exec("ALTER TABLE calculations_new RENAME TO calculations");
      this.#database.exec(`
        CREATE INDEX IF NOT EXISTS idx_calculations_object
        ON calculations(object_id, created_at DESC)
      `);
      this.#database.exec(`
        CREATE INDEX IF NOT EXISTS idx_calculations_object_block
        ON calculations(object_id, block, created_at DESC)
      `);
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      this.#database.exec("PRAGMA foreign_keys = ON");
      throw error;
    }
    this.#database.exec("PRAGMA foreign_keys = ON");
  }

  public listObjects(): ObjectSummary[] {
    const rows = this.#database.prepare(`
      SELECT o.id, o.organization_id, c.name AS client_name, o.name AS object_name,
             o.address, o.updated_at,
             (SELECT cal.created_at FROM calculations cal
              WHERE cal.object_id = o.id AND cal.organization_id = o.organization_id
              ORDER BY cal.created_at DESC, cal.rowid DESC LIMIT 1) AS latest_calculation_at,
             (SELECT json_extract(cal.report_json, '$.status') FROM calculations cal
              WHERE cal.object_id = o.id AND cal.organization_id = o.organization_id
              ORDER BY cal.created_at DESC, cal.rowid DESC LIMIT 1) AS latest_calculation_status
      FROM client_objects o
      JOIN clients c ON c.id = o.client_id AND c.organization_id = o.organization_id
      WHERE o.organization_id = ?
      ORDER BY o.updated_at DESC, o.id DESC
    `).all(LOCAL_ORGANIZATION_ID) as SummaryRow[];
    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      clientName: row.client_name,
      objectName: row.object_name,
      address: row.address,
      updatedAt: row.updated_at,
      latestCalculationAt: row.latest_calculation_at,
      latestCalculationStatus: row.latest_calculation_status,
    }));
  }

  public getObject(objectId: string): ObjectDetails | null {
    const row = this.#database.prepare(`
      SELECT o.id, o.organization_id, o.client_id, c.name AS client_name,
             c.phone AS client_phone, c.email AS client_email, c.notes AS client_notes,
             o.address, o.name AS object_name, o.notes AS object_notes,
             o.created_at, o.updated_at
      FROM client_objects o
      JOIN clients c ON c.id = o.client_id AND c.organization_id = o.organization_id
      WHERE o.id = ? AND o.organization_id = ?
    `).get(objectId, LOCAL_ORGANIZATION_ID) as ObjectRow | undefined;
    if (row === undefined) return null;
    const allCalculations = this.#database.prepare(`
      SELECT id, organization_id, object_id, input_json, report_json, created_at, block, work_prices_json
      FROM calculations
      WHERE object_id = ? AND organization_id = ?
      ORDER BY created_at DESC, rowid DESC
    `).all(objectId, LOCAL_ORGANIZATION_ID) as CalculationRow[];
    const calculations: SavedCalculation[] = [];
    const plumbingCalculations: SavedPlumbingCalculation[] = [];
    const sewageCalculations: SavedSewageCalculation[] = [];
    for (const rowCalc of allCalculations) {
      if (rowCalc.block === "plumbing") plumbingCalculations.push(this.#mapPlumbingCalculation(rowCalc));
      else if (rowCalc.block === "sewage") sewageCalculations.push(this.#mapSewageCalculation(rowCalc));
      else calculations.push(this.#mapCalculation(rowCalc));
    }
    return {
      id: row.id,
      organizationId: row.organization_id,
      client: {
        id: row.client_id,
        name: row.client_name,
        phone: row.client_phone,
        email: row.client_email,
        notes: row.client_notes,
      },
      object: { address: row.address, name: row.object_name, notes: row.object_notes },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      calculations,
      plumbingCalculations,
      sewageCalculations,
    };
  }

  public createObject(draft: CreateObjectDraft, report: HeatingReport | null): ObjectDetails {
    const clientId = randomUUID();
    const objectId = randomUUID();
    const now = new Date().toISOString();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database.prepare(`
        INSERT INTO clients (id, organization_id, name, phone, email, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(clientId, LOCAL_ORGANIZATION_ID, draft.client.name, draft.client.phone, draft.client.email, draft.client.notes, now, now);
      this.#database.prepare(`
        INSERT INTO client_objects (id, organization_id, client_id, address, name, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(objectId, LOCAL_ORGANIZATION_ID, clientId, draft.object.address, draft.object.name, draft.object.notes, now, now);
      if (draft.calculation !== null && report !== null) {
        this.#insertCalculation(objectId, draft.calculation, report, now);
      }
      this.#database.exec("COMMIT");
    } catch (error: unknown) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
    const result = this.getObject(objectId);
    if (result === null) throw new Error("Созданный объект не найден");
    return result;
  }

  public updateObject(objectId: string, client: ClientDraft, object: ObjectDraft): ObjectDetails | null {
    const row = this.#database.prepare(`
      SELECT client_id FROM client_objects WHERE id = ? AND organization_id = ?
    `).get(objectId, LOCAL_ORGANIZATION_ID) as { client_id: string } | undefined;
    if (row === undefined) return null;
    const now = new Date().toISOString();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database.prepare(`
        UPDATE clients SET name = ?, phone = ?, email = ?, notes = ?, updated_at = ?
        WHERE id = ? AND organization_id = ?
      `).run(client.name, client.phone, client.email, client.notes, now, row.client_id, LOCAL_ORGANIZATION_ID);
      this.#database.prepare(`
        UPDATE client_objects SET address = ?, name = ?, notes = ?, updated_at = ?
        WHERE id = ? AND organization_id = ?
      `).run(object.address, object.name, object.notes, now, objectId, LOCAL_ORGANIZATION_ID);
      this.#database.exec("COMMIT");
    } catch (error: unknown) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
    return this.getObject(objectId);
  }

  public addCalculation(objectId: string, draft: CalculationDraft, report: HeatingReport): SavedCalculation | null {
    const exists = this.#database.prepare(`
      SELECT 1 AS found FROM client_objects WHERE id = ? AND organization_id = ?
    `).get(objectId, LOCAL_ORGANIZATION_ID);
    if (exists === undefined) return null;
    const now = new Date().toISOString();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const calculation = this.#insertCalculation(objectId, draft, report, now);
      this.#database.prepare(`
        UPDATE client_objects SET updated_at = ? WHERE id = ? AND organization_id = ?
      `).run(now, objectId, LOCAL_ORGANIZATION_ID);
      this.#database.exec("COMMIT");
      return calculation;
    } catch (error: unknown) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  public addPlumbingCalculation(
    objectId: string,
    draft: PlumbingCalculationDraft,
    report: PlumbingReport,
  ): SavedPlumbingCalculation | null {
    const exists = this.#database.prepare(`
      SELECT 1 AS found FROM client_objects WHERE id = ? AND organization_id = ?
    `).get(objectId, LOCAL_ORGANIZATION_ID);
    if (exists === undefined) return null;
    const now = new Date().toISOString();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const currentRevision = this.works.getPlumbingPrices().revision;
      if (currentRevision !== draft.baseRevision) {
        throw new PlumbingRevisionConflictError(
          "Снимок цен работ устарел; загрузите актуальный справочник и повторите сохранение.",
        );
      }
      const saved = this.#insertPlumbingCalculation(objectId, draft, report, now);
      this.#database.prepare(`
        UPDATE client_objects SET updated_at = ? WHERE id = ? AND organization_id = ?
      `).run(now, objectId, LOCAL_ORGANIZATION_ID);
      this.#database.exec("COMMIT");
      return saved;
    } catch (error: unknown) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  public addSewageCalculation(
    objectId: string,
    draft: SewageCalculationDraft,
    report: SewageReport,
  ): SavedSewageCalculation | null {
    const exists = this.#database.prepare(`
      SELECT 1 AS found FROM client_objects WHERE id = ? AND organization_id = ?
    `).get(objectId, LOCAL_ORGANIZATION_ID);
    if (exists === undefined) return null;
    const now = new Date().toISOString();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const currentRevision = this.works.getSewagePrices().revision;
      if (currentRevision !== draft.baseRevision) {
        throw new SewageRevisionConflictError(
          "Снимок цен канализационных работ устарел; загрузите актуальный справочник и повторите сохранение.",
        );
      }
      const saved = this.#insertSewageCalculation(objectId, draft, report, now);
      this.#database.prepare(`
        UPDATE client_objects SET updated_at = ? WHERE id = ? AND organization_id = ?
      `).run(now, objectId, LOCAL_ORGANIZATION_ID);
      this.#database.exec("COMMIT");
      return saved;
    } catch (error: unknown) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  public close(): void {
    if (this.#closed) return;
    this.#database.close();
    this.#closed = true;
  }

  #insertCalculation(objectId: string, draft: CalculationDraft, report: HeatingReport, createdAt: string): SavedCalculation {
    const calculationId = randomUUID();
    this.#database.prepare(`
      INSERT INTO calculations (id, organization_id, object_id, input_json, report_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      calculationId,
      LOCAL_ORGANIZATION_ID,
      objectId,
      JSON.stringify(draft.input),
      JSON.stringify(report),
      createdAt,
    );
    const parameters = [
      ...inputParameters(draft),
      ...outputParameters(report, "report", report.status),
    ];
    const insertParameter = this.#database.prepare(`
      INSERT INTO calculation_parameters
        (organization_id, calculation_id, kind, path, source, verification_status)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const parameter of parameters) {
      insertParameter.run(
        LOCAL_ORGANIZATION_ID,
        calculationId,
        parameter.kind,
        parameter.path,
        parameter.source,
        parameter.verificationStatus,
      );
    }
    return {
      id: calculationId,
      organizationId: LOCAL_ORGANIZATION_ID,
      objectId,
      input: draft.input,
      report,
      parameters,
      createdAt,
    };
  }

  #insertPlumbingCalculation(
    objectId: string,
    draft: PlumbingCalculationDraft,
    report: PlumbingReport,
    createdAt: string,
  ): SavedPlumbingCalculation {
    const calculationId = randomUUID();
    this.#database.prepare(`
      INSERT INTO calculations (id, organization_id, object_id, input_json, report_json, created_at, block, work_prices_json)
      VALUES (?, ?, ?, ?, ?, ?, 'plumbing', ?)
    `).run(
      calculationId,
      LOCAL_ORGANIZATION_ID,
      objectId,
      JSON.stringify(draft.input),
      JSON.stringify(report),
      createdAt,
      JSON.stringify(draft.workPrices),
    );
    const inputLeaves = leafPaths(draft.input, "input").map((path) => {
      const override = draft.parameterMetadata.find((item) => item.path === path);
      return {
        kind: "input" as const,
        path,
        source: override?.source ?? "engineer" as const,
        verificationStatus: override?.verificationStatus ?? ("unverified" as const),
      };
    });
    const outputLeaves = outputParameters(report, "report", report.status);
    const parameters = [...inputLeaves, ...outputLeaves];
    const insertParameter = this.#database.prepare(`
      INSERT INTO calculation_parameters
        (organization_id, calculation_id, kind, path, source, verification_status)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const parameter of parameters) {
      insertParameter.run(
        LOCAL_ORGANIZATION_ID,
        calculationId,
        parameter.kind,
        parameter.path,
        parameter.source,
        parameter.verificationStatus,
      );
    }
    return {
      id: calculationId,
      organizationId: LOCAL_ORGANIZATION_ID,
      objectId,
      block: "plumbing",
      input: draft.input,
      report,
      workPrices: draft.workPrices,
      parameters,
      createdAt,
    };
  }

  #mapCalculation(row: CalculationRow): SavedCalculation {
    const parameters = this.#database.prepare(`
      SELECT kind, path, source, verification_status
      FROM calculation_parameters
      WHERE calculation_id = ? AND organization_id = ?
      ORDER BY kind, path
    `).all(row.id, LOCAL_ORGANIZATION_ID) as ParameterRow[];
    return {
      id: row.id,
      organizationId: row.organization_id,
      objectId: row.object_id,
      input: JSON.parse(row.input_json) as SavedCalculation["input"],
      report: JSON.parse(row.report_json) as SavedCalculation["report"],
      parameters: parameters.map(mapParameter),
      createdAt: row.created_at,
    };
  }

  #mapPlumbingCalculation(row: CalculationRow): SavedPlumbingCalculation {
    const parameters = this.#database.prepare(`
      SELECT kind, path, source, verification_status
      FROM calculation_parameters
      WHERE calculation_id = ? AND organization_id = ?
      ORDER BY kind, path
    `).all(row.id, LOCAL_ORGANIZATION_ID) as ParameterRow[];
    const workPricesJson = row.work_prices_json;
    if (typeof workPricesJson !== "string" || workPricesJson === "") {
      throw new Error("Сохранённый расчёт водоснабжения без снимка цен повреждён");
    }
    return {
      id: row.id,
      organizationId: row.organization_id,
      objectId: row.object_id,
      block: "plumbing",
      input: JSON.parse(row.input_json) as SavedPlumbingCalculation["input"],
      report: JSON.parse(row.report_json) as SavedPlumbingCalculation["report"],
      workPrices: JSON.parse(workPricesJson) as SavedPlumbingCalculation["workPrices"],
      parameters: parameters.map(mapParameter),
      createdAt: row.created_at,
    };
  }

  #insertSewageCalculation(
    objectId: string,
    draft: SewageCalculationDraft,
    report: SewageReport,
    createdAt: string,
  ): SavedSewageCalculation {
    const calculationId = randomUUID();
    this.#database.prepare(`
      INSERT INTO calculations (id, organization_id, object_id, input_json, report_json, created_at, block, work_prices_json)
      VALUES (?, ?, ?, ?, ?, ?, 'sewage', ?)
    `).run(
      calculationId,
      LOCAL_ORGANIZATION_ID,
      objectId,
      JSON.stringify(draft.input),
      JSON.stringify(report),
      createdAt,
      JSON.stringify(draft.workPrices),
    );
    const inputLeaves = leafPaths(draft.input, "input").map((path) => {
      const override = draft.parameterMetadata.find((item) => item.path === path);
      return {
        kind: "input" as const,
        path,
        source: override?.source ?? ("engineer" as const),
        verificationStatus: override?.verificationStatus ?? ("unverified" as const),
      };
    });
    const outputLeaves = outputParameters(report, "report", report.status);
    const parameters = [...inputLeaves, ...outputLeaves];
    const insertParameter = this.#database.prepare(`
      INSERT INTO calculation_parameters
        (organization_id, calculation_id, kind, path, source, verification_status)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const parameter of parameters) {
      insertParameter.run(
        LOCAL_ORGANIZATION_ID,
        calculationId,
        parameter.kind,
        parameter.path,
        parameter.source,
        parameter.verificationStatus,
      );
    }
    return {
      id: calculationId,
      organizationId: LOCAL_ORGANIZATION_ID,
      objectId,
      block: "sewage",
      input: draft.input,
      report,
      workPrices: draft.workPrices,
      parameters,
      createdAt,
    };
  }

  #mapSewageCalculation(row: CalculationRow): SavedSewageCalculation {
    const parameters = this.#database.prepare(`
      SELECT kind, path, source, verification_status
      FROM calculation_parameters
      WHERE calculation_id = ? AND organization_id = ?
      ORDER BY kind, path
    `).all(row.id, LOCAL_ORGANIZATION_ID) as ParameterRow[];
    const workPricesJson = row.work_prices_json;
    if (typeof workPricesJson !== "string" || workPricesJson === "") {
      throw new Error("Сохранённый расчёт канализации без снимка цен повреждён");
    }
    return {
      id: row.id,
      organizationId: row.organization_id,
      objectId: row.object_id,
      block: "sewage",
      input: JSON.parse(row.input_json) as SavedSewageCalculation["input"],
      report: JSON.parse(row.report_json) as SavedSewageCalculation["report"],
      workPrices: JSON.parse(workPricesJson) as SavedSewageCalculation["workPrices"],
      parameters: parameters.map(mapParameter),
      createdAt: row.created_at,
    };
  }
}
