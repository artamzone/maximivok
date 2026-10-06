export type CalculationStatus = "calculated" | "requires_engineer_review" | "impossible";

export type HeatSource = "gas" | "electric" | "solid_fuel" | "pellet" | "unknown";

export interface RoomInput {
  id: string;
  name: string;
  areaM2: number | null;
  ceilingHeightM: number | null;
  hasStandardWindows: boolean | null;
  hasPanoramicWindows: boolean | null;
  floorHeatingAreaM2: number | null;
  hasRadiator: boolean | null;
}

export interface HeatingInput {
  houseAreaM2: number | null;
  rooms: RoomInput[];
  heatSource: HeatSource;
  availableElectricPowerKw: number | null;
  residents: number | null;
  baths: number | null;
  showers: number | null;
  includeIndirectWaterHeater: boolean | null;
  circuitLengthM?: number | null;
}

export interface AppliedRule {
  code: string;
  description: string;
}

export interface ReportMessage {
  code: string;
  message: string;
}

export interface FloorHeatingResult {
  status: CalculationStatus;
  areaM2: number | null;
  pipeLengthM: number | null;
  circuitLengthM: number | null;
  circuitCount: number | null;
  averageCircuitLengthM: number | null;
  collectors: number[];
  mixingUnitCount: number | null;
  installationCostRub: number | null;
  insulationInstallationCostRub: number | null;
  missingParameters?: string[];
}

export interface RadiatorRoomResult {
  roomId: string;
  roomName: string;
  status: CalculationStatus;
  requiredPowerW: number | null;
  reductionPercent: number | null;
  warnings: ReportMessage[];
  missingParameters?: string[];
}

export interface BoilerResult {
  status: CalculationStatus;
  missingParameters?: string[];
  recommendedPowerKw: number | null;
  note: string;
}

export interface WaterHeaterResult {
  status: CalculationStatus;
  missingParameters?: string[];
  recommendedVolumeL: number | null;
  note: string;
}

export type BoilerRoomTemplateCode =
  | "HEAT_SOURCE_FLOOR_ONLY"
  | "HEAT_SOURCE_FLOOR_AND_RADIATORS"
  | "HEAT_SOURCE_RADIATORS_ONLY"
  | "NO_HEATING_EMITTERS";

export interface BoilerRoomResult {
  status: CalculationStatus;
  templateCode: BoilerRoomTemplateCode | null;
  includesIndirectWaterHeater: boolean | null;
  missingParameters?: string[];
  note: string;
}

export interface HeatingReport {
  status: CalculationStatus;
  input: HeatingInput;
  floorHeating: FloorHeatingResult;
  radiators: RadiatorRoomResult[];
  boiler: BoilerResult;
  waterHeater: WaterHeaterResult;
  boilerRoom: BoilerRoomResult;
  appliedRules: AppliedRule[];
  warnings: ReportMessage[];
  errors: ReportMessage[];
}
