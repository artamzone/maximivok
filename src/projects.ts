import type {
  CalculationStatus,
  HeatingInput,
  HeatingReport,
  PlumbingInput,
  PlumbingReport,
  PlumbingWorkPrices,
  SewageInput,
  SewageReport,
  SewageWorkPrices,
} from "./types.js";

export const LOCAL_ORGANIZATION_ID = "org-local";

export type ParameterSource = "" | "client" | "engineer" | "project_document" | "calculation";
export type ParameterVerificationStatus =
  | "unverified"
  | "confirmed"
  | CalculationStatus;

export interface ClientDraft {
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
}

export interface ObjectDraft {
  address: string;
  name: string | null;
  notes: string | null;
}

export interface ParameterMetadataDraft {
  path: string;
  source: Exclude<ParameterSource, "calculation">;
  verificationStatus: "unverified" | "confirmed" | "requires_engineer_review";
}

export interface CalculationDraft {
  input: HeatingInput;
  parameterMetadata: ParameterMetadataDraft[];
}

export interface CreateObjectDraft {
  client: ClientDraft;
  object: ObjectDraft;
  calculation: CalculationDraft | null;
}

export interface SavedParameterMetadata {
  kind: "input" | "output";
  path: string;
  source: ParameterSource;
  verificationStatus: ParameterVerificationStatus;
}

export interface SavedCalculation {
  id: string;
  organizationId: string;
  objectId: string;
  input: HeatingInput;
  report: HeatingReport;
  parameters: SavedParameterMetadata[];
  createdAt: string;
}

export type CalculationBlock = "heating" | "plumbing" | "sewage";

export interface PlumbingCalculationDraft {
  input: PlumbingInput;
  parameterMetadata: ParameterMetadataDraft[];
  workPrices: PlumbingWorkPrices;
  /** Редакция справочника, на которой собран снимок. Конфликт 409 если не совпадает с текущей. */
  baseRevision: number;
}

export interface SavedPlumbingCalculation {
  id: string;
  organizationId: string;
  objectId: string;
  block: "plumbing";
  input: PlumbingInput;
  report: PlumbingReport;
  workPrices: PlumbingWorkPrices;
  parameters: SavedParameterMetadata[];
  createdAt: string;
}

export interface SewageCalculationDraft {
  input: SewageInput;
  parameterMetadata: ParameterMetadataDraft[];
  workPrices: SewageWorkPrices;
  /** Редакция справочника, на которой собран снимок. Конфликт 409 если не совпадает с текущей. */
  baseRevision: number;
}

export interface SavedSewageCalculation {
  id: string;
  organizationId: string;
  objectId: string;
  block: "sewage";
  input: SewageInput;
  report: SewageReport;
  workPrices: SewageWorkPrices;
  parameters: SavedParameterMetadata[];
  createdAt: string;
}

export interface ObjectSummary {
  id: string;
  organizationId: string;
  clientName: string;
  objectName: string | null;
  address: string;
  updatedAt: string;
  latestCalculationAt: string | null;
  latestCalculationStatus: CalculationStatus | null;
}

export interface ObjectDetails {
  id: string;
  organizationId: string;
  client: ClientDraft & { id: string };
  object: ObjectDraft;
  createdAt: string;
  updatedAt: string;
  calculations: SavedCalculation[];
  plumbingCalculations: SavedPlumbingCalculation[];
  sewageCalculations: SavedSewageCalculation[];
}

export interface ProjectRepository {
  listObjects(): ObjectSummary[];
  getObject(objectId: string): ObjectDetails | null;
  createObject(draft: CreateObjectDraft, report: HeatingReport | null): ObjectDetails;
  updateObject(objectId: string, client: ClientDraft, object: ObjectDraft): ObjectDetails | null;
  addCalculation(objectId: string, draft: CalculationDraft, report: HeatingReport): SavedCalculation | null;
  addPlumbingCalculation(objectId: string, draft: PlumbingCalculationDraft, report: PlumbingReport): SavedPlumbingCalculation | null;
  addSewageCalculation(objectId: string, draft: SewageCalculationDraft, report: SewageReport): SavedSewageCalculation | null;
  close(): void;
}
