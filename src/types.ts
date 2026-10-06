export type CalculationStatus = "calculated" | "requires_engineer_review" | "impossible";

export type HeatSource = "gas" | "electric" | "solid_fuel" | "pellet" | "unknown";

export interface RoomInput {
  id: string;
  name: string;
  areaM2: number;
  ceilingHeightM: number;
  hasStandardWindows: boolean;
  hasPanoramicWindows: boolean;
  floorHeatingAreaM2: number;
  hasRadiator: boolean;
}

export interface HeatingInput {
  houseAreaM2: number;
  rooms: RoomInput[];
  heatSource: HeatSource;
  availableElectricPowerKw: number | null;
  residents: number;
  baths: number;
  showers: number;
  includeIndirectWaterHeater: boolean;
  circuitLengthM?: number;
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
  areaM2: number;
  pipeLengthM: number;
  circuitLengthM: number;
  circuitCount: number;
  averageCircuitLengthM: number;
  collectors: number[];
  mixingUnitCount: number;
  installationCostRub: number;
  insulationInstallationCostRub: number;
}

export interface RadiatorRoomResult {
  roomId: string;
  roomName: string;
  status: CalculationStatus;
  requiredPowerW: number | null;
  reductionPercent: number;
  warnings: ReportMessage[];
}

export interface BoilerResult {
  status: CalculationStatus;
  recommendedPowerKw: number | null;
  note: string;
}

export interface WaterHeaterResult {
  status: CalculationStatus;
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
  templateCode: BoilerRoomTemplateCode;
  includesIndirectWaterHeater: boolean;
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
