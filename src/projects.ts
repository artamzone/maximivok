import type { CalculationStatus, HeatingInput, HeatingReport } from "./types.js";

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
}

export interface ProjectRepository {
  listObjects(): ObjectSummary[];
  getObject(objectId: string): ObjectDetails | null;
  createObject(draft: CreateObjectDraft, report: HeatingReport | null): ObjectDetails;
  updateObject(objectId: string, client: ClientDraft, object: ObjectDraft): ObjectDetails | null;
  addCalculation(objectId: string, draft: CalculationDraft, report: HeatingReport): SavedCalculation | null;
  close(): void;
}
