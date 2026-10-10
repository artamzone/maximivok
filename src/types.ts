export type CalculationStatus = "calculated" | "requires_engineer_review" | "impossible";

export type HeatSource = "gas" | "electric" | "solid_fuel" | "pellet" | "unknown";

export interface RoomInput {
  id: string;
  name: string;
  areaM2: number | null;
  ceilingHeightM: number | null;
  /** True: effective height is taken from houseCeilingHeightM. Absent in legacy inputs. */
  useHouseCeilingHeight?: boolean;
  standardWindowCount?: number | null;
  panoramicWindowCount?: number | null;
  radiatorCount?: number | null;
  hasStandardWindows: boolean | null;
  hasPanoramicWindows: boolean | null;
  floorHeatingAreaM2: number | null;
  hasRadiator: boolean | null;
}

export interface HeatingInput {
  houseAreaM2: number | null;
  houseCeilingHeightM?: number | null;
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
  radiatorCount?: number | null;
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

export type PlumbingFixtureType =
  | "bath"
  | "shower_cabin"
  | "sink"
  | "hygiene_shower"
  | "toilet"
  | "washing_machine"
  | "dishwasher"
  | "kitchen_sink";

export type HotWaterSource =
  | "two_loop_boiler"
  | "gas_boiler"
  | "indirect_boiler"
  | "electric_boiler"
  | "gas_column"
  | "none"
  | "unknown";

export interface PlumbingFixtureEntry {
  type: PlumbingFixtureType;
  count: number;
  /**
   * Длина трассы подачи ХВС+ГВС к прибору, в метрах.
   * Сохраняется в снимке версии для будущего расчёта (D+); в E2/B в costLines не участвует.
   * null или отсутствие — длина неизвестна.
   */
  lengthM?: number | null;
  /** Свободный комментарий инженера. На расчёт не влияет. */
  comment?: string | null;
}

export interface PlumbingRoomInput {
  roomId: string;
  fixtures: PlumbingFixtureEntry[];
  /** null = инженер ещё не решил. */
  hasRecirculation: boolean | null;
}

export interface PlumbingInput {
  rooms: PlumbingRoomInput[];
  hotWaterSource: HotWaterSource;
  /**
   * Длина петли рециркуляции ГВС одной трубой (бойлер → приборы ГВС → бойлер), в метрах.
   * null/0/отсутствие — петля не проложена, стоимость не считается.
   * В E2/B строка plumbing_recirculation × lengthM × ivokPriceRub(recirculationPerMeterRub, markup).
   */
  recirculationLengthM?: number | null;
}

export interface PlumbingRoomReport {
  roomId: string;
  coldWaterPoints: number;
  hotWaterPoints: number;
  recirculationPoints: number | null;
  status: CalculationStatus;
  missingParameters?: string[];
}

export interface PlumbingReport {
  status: CalculationStatus;
  input: PlumbingInput;
  rooms: PlumbingRoomReport[];
  coldWaterPoints: number;
  hotWaterPoints: number;
  recirculationPoints: number | null;
  blockStatus: {
    coldWater: CalculationStatus;
    hotWater: CalculationStatus;
    recirculation: CalculationStatus;
  };
  /** Базовые (до наценки) цены работ по снимку. Без снимка — пусто. */
  workPrices?: PlumbingWorkPrices;
  costStatus: CalculationStatus;
  /** Сумма по всем строкам, в копейках. Без снимка или при ошибке — null. */
  costSubtotalKopecks: number | null;
  costLines: PlumbingCostLine[];
  costWarnings: ReportMessage[];
  costAppliedRules: AppliedRule[];
  missingParameters: string[];
  appliedRules: AppliedRule[];
  warnings: ReportMessage[];
  errors: ReportMessage[];
}

export interface PlumbingWorkPrices {
  readonly revision: number;
  /** Базовая цена до наценки за одну точку ХВС+ГВС. */
  readonly waterHotPointRub: number;
  /** Базовая цена за метр рециркуляции ГВС. */
  readonly recirculationPerMeterRub: number;
  /** Базовая цена за штуку монтажа трапа. */
  readonly trapInstallRub: number;
  /** Наценка в процентах, применённая к итоговой цене за единицу. */
  readonly markupPercent: number;
}

export interface PlumbingCostLine {
  code: string;
  name: string;
  quantity: number;
  unit: string;
  unitPriceRub: number;
  totalKopecks: number;
}

export interface HeatingWorkPrices {
  readonly revision: number;
  readonly floorHeatingRubPerM2: number;
  readonly insulationRubPerM2: number;
}

export interface HeatingReport {
  /** Present for web calculations using a versioned work price catalog; absent in legacy reports. */
  workPrices?: HeatingWorkPrices;
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

/** Канализационный диаметр. Согласованный набор для D1. */
export type SewageDiameter = 50 | 110;

/** Идентификатор работы в справочнике. Используется для флагов уже выполненных закладных. */
export type WorkId = string;

/** Снимок цен для расчёта канализации. Передаётся как отдельный аргумент. */
export interface SewageWorkPrices {
  readonly revision: number;
  /** Базовая цена за одну точку стока Ø50. Сюда же идёт монтаж трапа (он входит в цену точки Ø50). */
  readonly sewagePoint50Rub: number;
  /** Базовая цена за одну точку стока Ø110 (унитаз). */
  readonly sewagePoint110Rub: number;
  /** Базовая цена за метр лежака. */
  readonly sewerMainPerMeterRub: number;
  /** Базовая цена за штуку фанового стояка. */
  readonly standpipeRub: number;
  /** Наценка в процентах, применяется к итоговой цене за единицу. */
  readonly markupPercent: number;
}

/** Лежак канализации: связывает набор комнат с общей трассой, заданной метражом. */
export interface SewerMain {
  /** Идентификатор лежака — нужен для alreadyExecuted и ссылок из отчёта. */
  readonly id: string;
  /** Идентификаторы комнат, которые обслуживает этот лежак. Должны существовать в plumbing.rooms. */
  readonly fromRoomIds: readonly string[];
  /** Длина лежака в метрах. Неотрицательное число. */
  readonly lengthM: number;
  /** Лежак уже выполнен заказчиком и не идёт в смету. */
  readonly alreadyExecuted: boolean;
}

export interface SewageInput {
  /** Канализационная часть. Счёт точек 50/110, трапов, лежаков, стояков и уже выполненных закладных. */
  sewer: {
    /** Количество трапов, явно заданных инженером. null — трапы не переданы, строки исключаются из сметы. */
    trapCount: number | null;
    /** WorkId уже выполненных закладных — эти работы не должны попасть в смету. */
    alreadyExecuted: WorkId[];
    /** Лежаки канализации. Каждая комната с канализационными точками должна быть указана хотя бы в одном лежаке. */
    sewerMains: readonly SewerMain[];
    /** Количество фановых стояков (целое ≥ 0). Отсутствие = 0. */
    standpipes?: number;
  };
  /** Подсчёт ведётся по тем же приборам, что и водоснабжение. Передаём полный PlumbingInput, чтобы не дублировать матрицу. */
  plumbing: PlumbingInput;
}

export interface SewageCostLine {
  code: string;
  name: string;
  quantity: number;
  unit: string;
  unitPriceRub: number;
  totalKopecks: number;
}

export interface SewageReport {
  status: CalculationStatus;
  input: SewageInput;
  /** Суммарное число стоков Ø50 по всем приборам. */
  points50: number;
  /** Суммарное число стоков Ø110 (унитаз) по всем приборам. */
  points110: number;
  /** Количество трапов, явно заданное инженером. */
  trapCount: number | null;
  /** Суммарная длина канализационных лежаков в метрах (все, включая alreadyExecuted). 0 — лежаки не переданы. */
  lengthM: number;
  /** Лежаки, переданные в расчёт. */
  sewerMains: readonly SewerMain[];
  /** WorkId, исключённые из сметы как уже выполненные. */
  alreadyExecuted: WorkId[];
  workPrices?: SewageWorkPrices;
  costStatus: CalculationStatus;
  costSubtotalKopecks: number | null;
  costLines: SewageCostLine[];
  costWarnings: ReportMessage[];
  costAppliedRules: AppliedRule[];
  appliedRules: AppliedRule[];
  warnings: ReportMessage[];
  errors: ReportMessage[];
  missingParameters: string[];
}
